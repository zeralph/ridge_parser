"use strict";

var MapDecode = {
	parse: function(buffer) {
		var data = new DataView(buffer);
		if (data.byteLength < 4)
			throw new Error("En-tête MAP.RRM incomplet.");
		var count = data.getUint16(0, true);
		if (!count || count > Math.floor((data.byteLength - 4) / 8))
			throw new Error("Nombre de blocs MAP.RRM invalide.");
		var position = 4 + count * 8;
		var sectors = [];
		for (var sector = 0; sector < count; sector++) {
			var header = 4 + sector * 8;
			var counts = [];
			for (var column = 0; column < 4; column++)
				counts.push(data.getUint16(header + column * 2, true));
			if (counts[3] !== 0)
				throw new Error("Quatrième compteur MAP.RRM non pris en charge dans le bloc " + sector + ".");
			var primitiveCount = counts[0] + counts[1] + counts[2];
			if (primitiveCount > Math.floor((data.byteLength - position) / 40))
				throw new Error("Primitives tronquées dans le bloc " + sector + ".");
			var primitives = [];
			for (var primitive = 0; primitive < primitiveCount; primitive++) {
				var vertices = [];
				var uvs = [];
				for (var corner = 0; corner < 4; corner++) {
					var vertex = position + corner * 6;
					vertices.push([data.getInt16(vertex, true), data.getInt16(vertex + 2, true), data.getInt16(vertex + 4, true)]);
					uvs.push([data.getUint8(position + 24 + corner * 4), data.getUint8(position + 25 + corner * 4)]);
				}
				primitives.push({
					vertices: vertices,
					uvs: uvs,
					clut: data.getUint16(position + 26, true),
					tpage: data.getUint16(position + 30, true),
					depthBias: data.getUint16(position + 34, true),
					flags: data.getUint16(position + 38, true),
					type: primitive < counts[0] ? "A" : primitive < counts[0] + counts[1] ? "B" : "C"
				});
				position += 40;
			}
			sectors.push({ id: sector, counts: counts, primitives: primitives });
		}
		if (position !== data.byteLength)
			throw new Error("Données supplémentaires non reconnues à la fin de MAP.RRM.");
		return sectors;
	},

	placeSections: function(sectors, buffer) {
		var data = new DataView(buffer);
		if (data.byteLength !== 32 * 32 * 2)
			throw new Error("IDX.HED doit contenir exactement 2 048 octets.");
		var origins = new Array(sectors.length);
		for (var slot = 0; slot < 32 * 32; slot++) {
			var id = data.getInt16(slot * 2, true);
			if (id === -1)
				continue;
			if (id < 0 || id >= sectors.length)
				throw new Error("Indice de section invalide dans IDX.HED à la case " + slot + ".");
			if (origins[id])
				throw new Error("Section " + id + " dupliquée dans IDX.HED.");
			origins[id] = [(30 - slot % 32) * 2048, Math.floor(slot / 32) * 2048];
		}
		for (var section = 0; section < sectors.length; section++) {
			if (!origins[section])
				throw new Error("Section " + section + " absente de IDX.HED.");
		}
		return sectors.map(function(item, index) {
			return { id: item.id, counts: item.counts, primitives: item.primitives, origin: origins[index] };
		});
	},

	worldVertex: function(origin, point) {
		return [61440 - (origin[0] + point[0] / 4), -point[1] / 4, origin[1] + point[2] / 4];
	},

	findImages: function(primitive, images) {
		var clutX = (primitive.clut & 63) * 16;
		var clutY = (primitive.clut >> 6) & 511;
		var pageX = (primitive.tpage & 15) * 64;
		var pageY = ((primitive.tpage >> 4) & 1) * 256;
		if (((primitive.tpage >> 7) & 3) !== 0)
			return [];
		return images.filter(function(image) {
			return image.clutX === clutX && image.clutY === clutY &&
				primitive.uvs.every(function(uv) {
					var x = pageX + Math.floor(uv[0] / 4);
					var y = pageY + uv[1];
					return x >= image.x && x < image.x + image.widthWords &&
						y >= image.y && y < image.y + image.height;
				});
		});
	},

	imageUvs: function(primitive, image) {
		var pageX = (primitive.tpage & 15) * 64;
		var pageY = ((primitive.tpage >> 4) & 1) * 256;
		return primitive.uvs.map(function(uv) {
			return [((pageX - image.x) * 4 + uv[0] + 0.5) / image.width,
				(pageY - image.y + uv[1] + 0.5) / image.height];
		});
	}
};
