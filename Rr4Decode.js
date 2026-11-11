"use strict";

var Rr4Decode = {
	sectorSize: 2048,
	courseCount: 8,
	trackResourceBase: 751,

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

	parseCourse: function(buffer) {
		var data = new DataView(buffer);
		if (data.byteLength < 24)
			throw new Error("En-tête de circuit R4 incomplet.");
		var type = data.getUint32(0, true);
		var firstDataOffset = data.getUint32(4, true);
		var pointerCount = firstDataOffset / 4 - 1;
		if ((type !== 10 && type !== 11) || firstDataOffset % 4 !== 0 ||
			pointerCount < 5 || firstDataOffset > data.byteLength)
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
		return { type: type, samples: samples };
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
