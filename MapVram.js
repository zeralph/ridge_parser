"use strict";

var MapVram = {
	mapBanks: ["TEX0.TMS", "TEX1.TMS", "TEX2.TMS", "TEX4.TMS"],
	objectBanks: ["TEX0.TMS", "TEX1.TMS", "TEX4.TMS"],

	create: function() {
		return { words: new Uint16Array(1024 * 512), written: new Uint8Array(1024 * 512) };
	},

	loadTms: function(vram, buffer, name) {
		var data = new DataView(buffer);
		var position = 4;
		var records = 0;
		function invalid(message) {
			throw new Error(name + " : " + message + " à l'offset 0x" + position.toString(16) + ".");
		}
		function blit(block, end, label) {
			if (block + 12 > end)
				invalid("en-tête " + label + " tronqué");
			var x = data.getInt16(block + 4, true);
			var y = data.getInt16(block + 6, true);
			var width = data.getUint16(block + 8, true);
			var height = data.getUint16(block + 10, true);
			var byteCount = width * height * 2;
			if (x < 0 || y < 0 || x + width > 1024 || y + height > 512 || block + 12 + byteCount > end)
				invalid("rectangle " + label + " invalide ou tronqué");
			for (var row = 0; row < height; row++) {
				for (var col = 0; col < width; col++) {
					var destination = (y + row) * 1024 + x + col;
					vram.words[destination] = data.getUint16(block + 12 + (row * width + col) * 2, true);
					vram.written[destination] = 1;
				}
			}
		}
		if (data.byteLength < 8)
			invalid("en-tête TMS tronqué");
		while (position + 4 <= data.byteLength) {
			var skip = data.getInt32(position, true);
			if (skip === 0)
				break;
			if (skip < 0 || position + 12 > data.byteLength)
				invalid("longueur de bloc invalide");
			var next = position + (skip & ~3) + 4;
			if (next > data.byteLength || next <= position + 12 || data.getUint32(position + 4, true) !== 16)
				invalid("bloc TIM invalide");
			var flags = data.getUint32(position + 8, true);
			if ((flags & 7) !== 0 || !(flags & 8))
				invalid("format TIM non pris en charge");
			var block = position + 12;
			if (block + 12 > next)
				invalid("palette tronquée");
			var paletteSize = data.getUint32(block, true);
			if (paletteSize < 12 || block + paletteSize > next)
				invalid("taille de palette invalide");
			blit(block, block + paletteSize, "CLUT");
			block += paletteSize;
			blit(block, next, "image");
			position = next;
			records++;
		}
		if (!records)
			throw new Error(name + " : aucune image TMS reconnue.");
		return records;
	},

	page: function(vram, tpage, clut, window) {
		if (((tpage >> 7) & 3) !== 0)
			throw new Error("Profondeur de texture autre que 4-bpp non prise en charge.");
		var x = (tpage & 15) * 64;
		var y = ((tpage >> 4) & 1) * 256;
		var clutX = (clut & 63) * 16;
		var clutY = (clut >> 6) & 511;
		var palettePresent = true;
		for (var colorIndex = 0; colorIndex < 16; colorIndex++)
			palettePresent = palettePresent && !!vram.written[clutY * 1024 + clutX + colorIndex];
		var pixels = new Uint8Array(256 * 256 * 4);
		var coverage = new Uint8Array(64 * 256);
		var maskU = 0, maskV = 0, offsetU = 0, offsetV = 0;
		if (window) {
			var width = window[2], height = window[3];
			if (width < 8 || width > 256 || height < 8 || height > 256 ||
				(width & (width - 1)) || (height & (height - 1)) ||
				window[0] < 0 || window[0] > 255 || window[1] < 0 || window[1] > 255)
				throw new Error("Fenêtre de texture PS1 non prise en charge.");
			maskU = (256 - width) & 248;
			maskV = (256 - height) & 248;
			offsetU = window[0] & maskU;
			offsetV = window[1] & maskV;
		}
		for (var row = 0; row < 256; row++) {
			for (var wordX = 0; wordX < 64; wordX++) {
				var sampleRow = (row & ~maskV) | offsetV;
				var sampleWord = (((wordX * 4) & ~maskU) | offsetU) >> 2;
				var address = (y + sampleRow) * 1024 + x + sampleWord;
				var present = palettePresent && !!vram.written[address];
				coverage[row * 64 + wordX] = present ? 1 : 0;
				var word = vram.words[address];
				for (var nibble = 0; nibble < 4; nibble++) {
					var pixel = (row * 256 + wordX * 4 + nibble) * 4;
					if (!present) {
						pixels[pixel] = 255;
						pixels[pixel + 2] = 255;
						pixels[pixel + 3] = 255;
						continue;
					}
					var index = (word >> (nibble * 4)) & 15;
					var color = vram.words[clutY * 1024 + clutX + index];
					pixels[pixel] = Math.round((color & 31) * 255 / 31);
					pixels[pixel + 1] = Math.round(((color >> 5) & 31) * 255 / 31);
					pixels[pixel + 2] = Math.round(((color >> 10) & 31) * 255 / 31);
					pixels[pixel + 3] = color === 0 ? 0 : 255;
				}
			}
		}
		return { pixels: pixels, coverage: coverage, palettePresent: palettePresent };
	},

	sky: function(vram) {
		var page = this.page(vram, 0x15, 0x7983);
		if (!this.covered(page, [[0, 0], [255, 255]]))
			throw new Error("Texture du ciel TEX0.TMS incomplète.");
		var pixels = new Uint8Array(512 * 256 * 4);
		for (var y = 0; y < 128; y++) {
			for (var half = 0; half < 2; half++) {
				var source = (half * 128 + y) * 256 * 4;
				var destination = (y * 512 + half * 256) * 4;
				pixels.set(page.pixels.subarray(source, source + 256 * 4), destination);
			}
		}
		var horizon = [0, 0, 0];
		for (var x = 0; x < 512; x++)
			for (var channel = 0; channel < 3; channel++)
				horizon[channel] += pixels[(127 * 512 + x) * 4 + channel];
		for (var row = 128; row < 256; row++) {
			for (var col = 0; col < 512; col++) {
				var index = (row * 512 + col) * 4;
				for (var component = 0; component < 3; component++)
					pixels[index + component] = Math.round(horizon[component] / 512);
				pixels[index + 3] = 255;
			}
		}
		return pixels;
	},

	covered: function(page, uvs) {
		var minU = 255, minV = 255, maxU = 0, maxV = 0;
		uvs.forEach(function(uv) {
			minU = Math.min(minU, uv[0]); maxU = Math.max(maxU, uv[0]);
			minV = Math.min(minV, uv[1]); maxV = Math.max(maxV, uv[1]);
		});
		for (var v = minV; v <= maxV; v++)
			for (var u = minU >> 2; u <= (maxU >> 2); u++)
				if (!page.coverage[v * 64 + u])
					return false;
		return true;
	}
};
