"use strict";

var RevolutionDecode = {
	courses: {
		"CRS_EASY.DAT": "EASY_PCT.DAT",
		"CRS_MID.DAT": "MID_PCT.DAT",
		"CRS_HIGH.DAT": "HIGH_PCT.DAT",
		"CRS_OLDE.DAT": "OLD_PCT.DAT",
		"CRS_OLDH.DAT": "OLD_PCT.DAT"
	},

	parseTrack: function(buffer) {
		var data = new DataView(buffer);
		if (data.byteLength < 24)
			throw new Error("En-tête de circuit Revolution tronqué.");
		var base = data.getUint32(20, true);
		if (base < 24 || base + 84 > data.byteLength)
			throw new Error("Répertoire de tracé Revolution invalide ou tronqué.");
		var relative = data.getUint32(base + 80, true);
		if (relative < 84 || base + relative + 4 > data.byteLength)
			throw new Error("Offset de tracé Revolution invalide.");
		var start = base + relative;
		var count = data.getUint32(start, true);
		if (count < 2 || count > Math.floor((data.byteLength - start - 4) / 20))
			throw new Error("Tracé Revolution invalide ou tronqué.");
		var points = [];
		for (var i = 0; i < count; i++) {
			var offset = start + 4 + i * 20;
			points.push([data.getInt32(offset, true) / 16384, data.getInt16(offset + 8, true) / 2,
				data.getInt32(offset + 4, true) / 16384]);
		}
		return points;
	},

	parse: function(buffer) {
		var data = new DataView(buffer);
		if (data.byteLength < 0x818)
			throw new Error("En-tête de circuit Revolution tronqué.");
		var offsets = [];
		for (var i = 0; i < 6; i++)
			offsets.push(data.getUint32(i * 4, true));
		if (offsets[0] !== 0x818 || offsets[5] > data.byteLength ||
			offsets.some(function(offset, index) { return index && offset <= offsets[index - 1]; }))
			throw new Error("Répertoire de circuit Revolution invalide.");
		if (offsets[3] - offsets[2] !== 0x30000 || offsets[4] - offsets[3] !== 0x30000)
			throw new Error("Pages de textures Revolution invalides.");
		var base = offsets[0], end = offsets[1];
		var count = data.getUint32(base, true);
		if (!count || count > Math.floor((end - base - 4) / 4))
			throw new Error("Nombre de sections Revolution invalide.");
		var starts = [];
		for (var section = 0; section < count; section++) {
			var start = data.getUint32(base + 4 + section * 4, true);
			if (start < 4 + count * 4 || base + start >= end ||
				(section && start <= starts[section - 1]))
				throw new Error("Offset de section Revolution invalide : " + section + ".");
			starts.push(start);
		}
		var sectors = [];
		for (var id = 0; id < count; id++) {
			var position = base + starts[id];
			var limit = id + 1 < count ? base + starts[id + 1] : end;
			var primitives = [], counts = [0, 0, 0], terminated = false;
			while (position + 4 <= limit) {
				var type = data.getUint16(position, true);
				var length = data.getUint16(position + 2, true);
				position += 4;
				if (type === 0 && length === 0) {
					terminated = true;
					break;
				}
				if (type > 2 || !length || position + length * 40 > limit)
					throw new Error("Flux de primitives Revolution invalide : section " + id + ".");
				counts[type] += length;
				for (var primitive = 0; primitive < length; primitive++) {
					var vertices = [], uvs = [];
					for (var corner = 0; corner < 4; corner++) {
						vertices.push([data.getInt16(position + corner * 4, true),
							data.getInt16(position + corner * 4 + 2, true),
							data.getInt16(position + 16 + corner * 2, true)]);
						uvs.push([data.getUint8(position + 24 + corner * 4),
							data.getUint8(position + 25 + corner * 4)]);
					}
					primitives.push({
						vertices: vertices, uvs: uvs,
						clut: data.getUint16(position + 26, true),
						tpage: data.getUint16(position + 30, true),
						depthBias: data.getInt16(position + 34, true),
						flags: data.getUint16(position + 38, true),
						type: ["A", "B", "C"][type]
					});
					position += 40;
				}
			}
			if (!terminated || position !== limit)
				throw new Error("Fin de section Revolution invalide : " + id + ".");
			sectors.push({ id: id, counts: counts, primitives: primitives });
		}
		var models = this.parseModels(data, offsets[1], offsets[2]);
		return { sectors: MapDecode.placeSections(sectors, buffer.slice(24, 0x818)),
			textureOffset: offsets[2], buildings: this.parseBuildings(data, offsets[4], offsets[5], models) };
	},

	parseModels: function(data, base, end) {
		var sizes = [40, 48, 32, 64, 72, 56];
		var count = data.getUint32(base, true);
		if (!count || count > Math.floor((end - base - 4) / 4))
			throw new Error("Répertoire des modèles Revolution invalide.");
		var starts = [];
		for (var i = 0; i < count; i++) {
			var start = data.getUint32(base + 4 + i * 4, true);
			if (start < 4 + count * 4 || base + start >= end || (i && start <= starts[i - 1]))
				throw new Error("Offset de modèle Revolution invalide : " + i + ".");
			starts.push(start);
		}
		var models = [];
		for (var id = 0; id < count; id++) {
			var position = base + starts[id];
			var limit = id + 1 < count ? base + starts[id + 1] : end;
			var primitives = [], omitted = 0, terminated = false;
			while (position + 4 <= limit) {
				var type = data.getUint16(position, true);
				var length = data.getUint16(position + 2, true);
				position += 4;
				if (type === 0 && length === 0) {
					terminated = true;
					break;
				}
				if (type >= sizes.length || !length || position + length * sizes[type] > limit)
					throw new Error("Flux de modèle Revolution invalide : " + id + ".");
				for (var record = 0; record < length; record++) {
					if (type === 2 || type === 5) {
						omitted++;
						position += sizes[type];
						continue;
					}
					var texture = position + (type >= 3 ? 48 : 24);
					var vertices = [], uvs = [];
					for (var corner = 0; corner < 4; corner++) {
						vertices.push([data.getInt16(position + corner * 4, true),
							data.getInt16(position + corner * 4 + 2, true),
							data.getInt16(position + 16 + corner * 2, true)]);
						uvs.push([data.getUint8(texture + corner * 4), data.getUint8(texture + 1 + corner * 4)]);
					}
					var window = null;
					if (type === 1 || type === 4) {
						window = [];
						for (var w = 0; w < 4; w++)
							window.push(data.getInt16(texture + 16 + w * 2, true));
					}
					primitives.push({ vertices: vertices, uvs: uvs,
						clut: data.getUint16(texture + 2, true),
						tpage: data.getUint16(texture + 6, true), window: window });
					position += sizes[type];
				}
			}
			if (!terminated || position !== limit)
				throw new Error("Fin de modèle Revolution invalide : " + id + ".");
			models.push({ id: id, primitives: primitives, omitted: omitted });
		}
		return models;
	},

	parseBuildings: function(data, start, end, models) {
		if ((end - start) % 20)
			throw new Error("Table de placements Revolution tronquée.");
		var group = 0, found = 0, buildings = [], seen = new Set();
		for (var position = start; position < end; position += 20) {
			var code = data.getInt16(position, true);
			if (code === -3) { group = 1; found |= 1; continue; }
			if (code === -65) { group = 2; found |= 2; continue; }
			if (code === -64) { group = 0; found |= 4; continue; }
			if (!group || code === 32767)
				continue;
			if (code < 0 || (code & ~0x1fff) !== 0 || (code & 0xfff) >= models.length)
				throw new Error("Placement de décor Revolution invalide à l'offset " + (position - start) + ".");
			var id = code & 0xfff, rotation = data.getInt16(position + 2, true) & 4095;
			var coordinates = [data.getInt32(position + 4, true), data.getInt32(position + 8, true),
				data.getInt32(position + 12, true)];
			var key = [id, rotation].concat(coordinates).join(":");
			if (seen.has(key))
				continue;
			seen.add(key);
			var old = models.length === 134;
			var objectBank = group === 2 || (old ? id === 2 || id === 3 || id === 4 : id === 27 || id === 37);
			buildings.push({ model: models[id], position: coordinates, rotation: rotation,
				textureBank: objectBank ? "objects" : "map" });
		}
		if (found !== 7)
			throw new Error("Listes de décor Revolution incomplètes.");
		return buildings;
	}
};
