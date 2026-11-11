"use strict";

var ObjDecode = {
	executableHash: "bde353330bf4032d8c4b86a04dbcc78c95e6b2c5aa17dc15b79de613b52cf8c5",
	buildingListOffset: 0x5f2fc,
	buildingCount: 59,
	sceneryListOffset: 0x5f1ac,
	sceneryCount: 6,

	parseModels: function(buffer) {
		var data = new DataView(buffer);
		var sizes = [40, 48, 32, 64, 72, 56];
		if (data.byteLength < 4)
			throw new Error("En-tête OBJ.RRO tronqué.");
		var count = data.getUint32(0, true);
		if (!count || count > Math.floor((data.byteLength - 4) / 16))
			throw new Error("Répertoire OBJ.RRO invalide.");
		var position = 4 + count * 16;
		var models = [];
		for (var id = 0; id < count; id++) {
			var counts = [];
			var primitives = [];
			for (var type = 0; type < sizes.length; type++)
				counts.push(data.getUint16(4 + id * 16 + type * 2, true));
			for (var kind = 0; kind < sizes.length; kind++) {
				var bytes = counts[kind] * sizes[kind];
				if (position + bytes > data.byteLength)
					throw new Error("Modèle OBJ.RRO " + id + " tronqué.");
				if (kind === 0 || kind === 1 || kind === 3 || kind === 4) {
					for (var record = 0; record < counts[kind]; record++) {
						var offset = position + record * sizes[kind];
						var textureOffset = offset + (kind >= 3 ? 48 : 24);
						var vertices = [], uvs = [];
						for (var corner = 0; corner < 4; corner++) {
							var vertex = offset + corner * 6;
							vertices.push([data.getInt16(vertex, true), data.getInt16(vertex + 2, true), data.getInt16(vertex + 4, true)]);
							uvs.push([data.getUint8(textureOffset + corner * 4), data.getUint8(textureOffset + 1 + corner * 4)]);
						}
						var window = null;
						if (kind === 1 || kind === 4) {
							window = [];
							for (var w = 0; w < 4; w++)
								window.push(data.getInt16(textureOffset + 16 + w * 2, true));
						}
						primitives.push({
							vertices: vertices, uvs: uvs,
							clut: data.getUint16(textureOffset + 2, true),
							tpage: data.getUint16(textureOffset + 6, true), window: window
						});
					}
				}
				position += bytes;
			}
			models.push({ id: id, counts: counts, primitives: primitives });
		}
		if (position !== data.byteLength)
			throw new Error("Données supplémentaires non reconnues dans OBJ.RRO.");
		return models;
	},

	parseBuildings: function(buffer, models) {
		var data = new DataView(buffer);
		var buildings = [];
		function readList(start, count, scenery) {
			if (data.byteLength < start + (count + 1) * 24)
				throw new Error("Liste des immeubles tronquée dans l'exécutable.");
			for (var i = 0; i < count; i++) {
				var offset = start + i * 24;
				var id = data.getInt16(offset, true);
				var model = models[id];
				if (!model || !model.primitives.length || model.counts[2] !== 0 || model.counts[5] !== 0 ||
					data.getUint16(offset + 2, true) !== 0 || data.getInt32(offset + 16, true) !== 0 ||
					data.getUint16(offset + 22, true) !== 0)
					throw new Error("Entrée de décor non prise en charge à l'indice " + i + ".");
				var rotation = data.getInt16(offset + 20, true);
				if (rotation < 0 || rotation >= 4096)
					throw new Error("Rotation de décor invalide à l'indice " + i + ".");
				buildings.push({
					model: model, position: [data.getInt32(offset + 4, true), data.getInt32(offset + 8, true), data.getInt32(offset + 12, true)],
					rotation: rotation, textureBank: scenery && i < 3 ? "scenery" : "objects"
				});
			}
			if (data.getInt16(start + count * 24, true) !== -1)
				throw new Error("Fin de liste des immeubles invalide.");
		}
		readList(this.buildingListOffset, this.buildingCount);
		readList(this.sceneryListOffset, this.sceneryCount, true);
		return buildings;
	},

	worldVertex: function(building, point) {
		var angle = building.rotation * Math.PI * 2 / 4096;
		var cos = Math.cos(angle), sin = Math.sin(angle), position = building.position;
		return [61440 - position[0] - (point[0] * cos - point[2] * sin) / 4,
			-position[1] - point[1] / 4,
			position[2] + (point[0] * sin + point[2] * cos) / 4];
	}
};
