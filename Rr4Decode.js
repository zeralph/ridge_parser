"use strict";

var Rr4Decode = {
	sectorSize: 2048,
	courseCount: 8,
	trackResourceBase: 751,

	worldVertex: function(x, y, z) {
		return [x, -y, -z];
	},

	parseTrackResource: function(buffer) {
		var data = new DataView(buffer);
		if (data.byteLength < 20 || data.getUint32(0, true) !== 4)
			throw new Error("En-tête de ressource de tracé R4 invalide.");
		var lookupOffset = data.getUint32(4, true);
		var laneOffset = data.getUint32(8, true);
		var startNodeOffset = data.getUint32(12, true);
		var workspaceOffset = data.getUint32(16, true);
		if (lookupOffset !== 20 || laneOffset <= lookupOffset ||
			startNodeOffset <= laneOffset || workspaceOffset <= startNodeOffset ||
			workspaceOffset > data.byteLength || (startNodeOffset - laneOffset) % 8 !== 0 ||
			(workspaceOffset - startNodeOffset) % 4 !== 0)
			throw new Error("Répertoire de tracé R4 invalide.");
		return {
			sampleCount: (startNodeOffset - laneOffset) / 8,
			laneOffset: laneOffset,
			startNodeOffset: startNodeOffset,
			workspaceOffset: workspaceOffset
		};
	},

	parseSky: function(data, start, end) {
		if (start + 4 > end)
			throw new Error("En-tête de ciel R4 incomplet.");
		var count = data.getUint32(start, true);
		if (count > Math.floor((end - start - 4) / 12))
			throw new Error("Table de ciel R4 invalide.");
		var layers = [];
		var sizes = { 1: 28, 7: 20, 8: 28, 11: 32 };
		for (var layer = 0; layer < count; layer++) {
			var entry = start + 4 + layer * 12;
			var vertexOffset = start + data.getUint32(entry, true);
			var vertexCount = data.getUint32(entry + 4, true);
			var position = start + data.getUint32(entry + 8, true);
			if (vertexOffset < start || vertexOffset + vertexCount * 8 > end || position < start || position + 4 > end)
				throw new Error("Données de ciel R4 hors limites.");
			var vertices = [];
			for (var vertex = 0; vertex < vertexCount; vertex++) {
				var offset = vertexOffset + vertex * 8;
				vertices.push([data.getInt16(offset, true), data.getInt16(offset + 2, true), data.getInt16(offset + 4, true)]);
			}
			var primitives = [];
			var terminated = false;
			while (position + 4 <= end) {
				var header = data.getUint32(position, true);
				position += 4;
				if (header === 0) {
					terminated = true;
					break;
				}
				var type = header & 0xffff, primitiveCount = header >>> 16;
				var size = sizes[type];
				if (!size || !primitiveCount || position + primitiveCount * size > end)
					throw new Error("Commande de ciel R4 invalide ou non prise en charge : " + type + ".");
				for (var item = 0; item < primitiveCount; item++) {
					var primitive = position + item * size;
					var corners = type === 1 || type === 8 ? 4 : 3;
					var indices = [], colors = [], uvs = [];
					var uvOffset = type === 1 ? 12 : 20;
					for (var corner = 0; corner < corners; corner++) {
						var index = data.getUint16(primitive + corner * 2, true);
						if (index >= vertexCount)
							throw new Error("Sommet de ciel R4 hors limites.");
						indices.push(index);
						var colorOffset = primitive + 8 + (type === 1 ? 0 : corner * 4);
						colors.push([data.getUint8(colorOffset), data.getUint8(colorOffset + 1), data.getUint8(colorOffset + 2)]);
						if (type === 1 || type === 11) {
							var uv = primitive + uvOffset + (corner === 3 ? 10 : corner * 4);
							uvs.push([data.getUint8(uv), data.getUint8(uv + 1)]);
						}
					}
					primitives.push({
						type: type, indices: indices, colors: colors, uvs: uvs,
						clut: uvs.length ? data.getUint16(primitive + uvOffset + 2, true) : null,
						tpage: uvs.length ? data.getUint16(primitive + uvOffset + 6, true) : null
					});
				}
				position += primitiveCount * size;
			}
			if (!terminated)
				throw new Error("Liste de ciel R4 sans terminateur.");
			layers.push({ vertices: vertices, primitives: primitives });
		}
		if (!layers.length)
			throw new Error("Ciel R4 absent.");
		return layers;
	},

	parseCourse: function(buffer) {
		var data = new DataView(buffer);
		if (data.byteLength < 24)
			throw new Error("En-tête de circuit R4 incomplet.");
		var type = data.getUint32(0, true);
		var firstDataOffset = data.getUint32(4, true);
		var pointerCount = firstDataOffset / 4 - 1;
		if ((type !== 10 && type !== 11) || firstDataOffset % 4 !== 0 ||
			pointerCount < 6 || firstDataOffset > data.byteLength)
			throw new Error("Répertoire de circuit R4 invalide.");
		var offsets = [];
		var previousOffset = -1;
		for (var pointer = 0; pointer < pointerCount; pointer++) {
			var offset = data.getUint32(4 + pointer * 4, true);
			if (offset < firstDataOffset || offset >= data.byteLength || offset <= previousOffset)
				throw new Error("Offset de données de circuit R4 invalide à l'entrée " + pointer + ".");
			offsets.push(offset);
			previousOffset = offset;
		}
		var lightingOffset = offsets[5];
		var lightingEnd = offsets.length > 6 ? offsets[6] : data.byteLength;
		if (lightingOffset + 0x2c > lightingEnd)
			throw new Error("Données d'éclairage R4 tronquées.");
		var ambient = [data.getUint8(lightingOffset + 0x28), data.getUint8(lightingOffset + 0x29),
			data.getUint8(lightingOffset + 0x2a)];
		var trackOffset = offsets[4];
		if (trackOffset + 0x808 > data.byteLength)
			throw new Error("Données de chaussée R4 tronquées.");
		var sampleCount = data.getUint32(trackOffset + 0x804, true);
		var samplesOffset = trackOffset + 0x808;
		var samplesEnd = samplesOffset + sampleCount * 0x3c;
		if (!sampleCount || sampleCount > 2000 ||
			samplesEnd > data.byteLength ||
			(offsets.length > 5 && samplesEnd > offsets[5]))
			throw new Error("Nombre ou plage d'échantillons de chaussée R4 invalide.");
		var samples = [];
		for (var index = 0; index < sampleCount; index++) {
			var sample = samplesOffset + index * 0x3c;
			samples.push({
				right: [data.getInt16(sample, true), data.getInt16(sample + 2, true)],
				left: [data.getInt16(sample + 4, true), data.getInt16(sample + 6, true)],
				x: data.getInt32(sample + 8, true),
				z: data.getInt32(sample + 12, true),
				height: data.getInt16(sample + 16, true),
				segmentLength: data.getInt16(sample + 28, true)
			});
		}
		var relativeOffset = offsets[0];
		var relativeEnd = offsets[1];
		if (relativeOffset + 0x50 > relativeEnd)
			throw new Error("En-tête de géométrie de circuit R4 incomplet.");
		var sections = [];
		var previousSection = 0x50;
		for (var section = 0; section < 16; section++) {
			var sectionOffset = data.getUint32(relativeOffset + 0x10 + section * 4, true);
			if (sectionOffset < previousSection || relativeOffset + sectionOffset > relativeEnd)
				throw new Error("Répertoire de géométrie de circuit R4 invalide.");
			sections.push(sectionOffset);
			previousSection = sectionOffset;
		}
		var decorations = [];
		var strides = [64, 68, 48, 52];
		var xyOffsets = [0, 8, 12, 20];
		var zOffsets = [4, 6, 16, 18];
		for (var stream = 4; stream <= 7; stream++) {
			var start = relativeOffset + sections[stream];
			var end = relativeOffset + sections[stream + 1];
			var stride = strides[stream - 4];
			if ((end - start) % stride !== 0)
				throw new Error("Flux de géométrie de circuit R4 tronqué : " + stream + ".");
			for (var primitive = start; primitive < end; primitive += stride) {
				var vertices = [];
				for (var vertex = 0; vertex < 4; vertex++) {
					vertices.push([
						data.getInt16(primitive + xyOffsets[vertex], true) + 32768,
						data.getInt16(primitive + xyOffsets[vertex] + 2, true),
						data.getInt16(primitive + zOffsets[vertex], true) + 32768
					]);
				}
				var window = null;
				if (stream === 5 || stream === 7) {
					var command = data.getUint32(primitive + stride - 4, true);
					if ((command >>> 24) !== 0xe2)
						throw new Error("Fenêtre de texture R4 invalide.");
					window = [
						((command >>> 10) & 31) * 8,
						((command >>> 15) & 31) * 8,
						256 - (command & 31) * 8,
						256 - ((command >>> 5) & 31) * 8
					];
				}
				var colorOffsets = stream < 6 ? [48, 52, 56, 60] : [44, 44, 44, 44];
				decorations.push({
					vertices: vertices,
					colors: colorOffsets.map(function(offset) {
						return [data.getUint8(primitive + offset), data.getUint8(primitive + offset + 1),
							data.getUint8(primitive + offset + 2)];
					}),
					uvs: [24, 28, 32, 34].map(function(offset) {
						return [data.getUint8(primitive + offset), data.getUint8(primitive + offset + 1)];
					}),
					clut: data.getUint16(primitive + 26, true),
					tpage: data.getUint16(primitive + 30, true),
					window: window
				});
			}
		}
		if (!decorations.length)
			throw new Error("Géométrie fixe de circuit R4 absente.");
		return { type: type, samples: samples, decorations: decorations, ambient: ambient,
			sky: this.parseSky(data, offsets[1], offsets[2]) };
	},

	parse: function(buffer) {
		var data = new DataView(buffer);
		if (data.byteLength < 4)
			throw new Error("En-tête R4.BIN incomplet.");
		if (data.byteLength % this.sectorSize !== 0)
			throw new Error("La taille de R4.BIN doit être un multiple de 2 048 octets.");
		var count = data.getUint32(0, true);
		if (!count || count > Math.floor((data.byteLength - 4) / 4))
			throw new Error("Nombre de ressources R4.BIN invalide.");
		var totalSectors = data.byteLength / this.sectorSize;
		var firstDataSector = Math.ceil((4 + count * 4) / this.sectorSize);
		var resources = [];
		var previousSector = -1;
		for (var id = 0; id < count; id++) {
			var startSector = data.getUint32(4 + id * 4, true);
			if (startSector < firstDataSector || startSector >= totalSectors || startSector <= previousSector)
				throw new Error("Offset de ressource invalide dans R4.BIN à l'indice " + id + ".");
			var endSector = id + 1 < count ? data.getUint32(8 + id * 4, true) : totalSectors;
			var start = startSector * this.sectorSize;
			var end = endSector * this.sectorSize;
			resources.push({
				id: id,
				start: start,
				end: end,
				size: end - start,
				type: end - start >= 4 ? data.getUint32(start, true) : null
			});
			previousSector = startSector;
		}
		return resources;
	},

	extract: function(buffer, resources, id) {
		if (!Number.isInteger(id) || id < 0 || id >= resources.length)
			throw new Error("Indice de ressource R4 invalide.");
		var resource = resources[id];
		return buffer.slice(resource.start, resource.end);
	}
};
