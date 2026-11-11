"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.join(__dirname, "..");
const context = vm.createContext({});
for (const file of ["MapDecode.js", "MapVram.js"])
	vm.runInContext(fs.readFileSync(path.join(root, file), "utf8"), context);

function buffer(name) {
	const bytes = fs.readFileSync(path.join(root, name));
	return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

const vram = context.MapVram.create();
const counts = [143, 120, 102, 163];
assert.deepEqual(Array.from(context.MapVram.mapBanks), ["TEX0.TMS", "TEX1.TMS", "TEX2.TMS", "TEX4.TMS"]);
const sectors = context.MapDecode.parse(buffer("ridge_racer/MAP.RRM"));
let beforeTex4;
for (const [i, bank] of Array.from(context.MapVram.mapBanks).entries()) {
	if (bank === "TEX4.TMS")
		beforeTex4 = { words: vram.words.slice(), written: vram.written.slice() };
	const name = `ridge_racer/${bank}`;
	assert.equal(context.MapVram.loadTms(vram, buffer(name), name), counts[i]);
}
assert.throws(() => context.MapVram.loadTms(context.MapVram.create(), new ArrayBuffer(7), "test"), /tronqué/);
const truncated = buffer("ridge_racer/TEX0.TMS").slice(0, 100);
assert.throws(() => context.MapVram.loadTms(context.MapVram.create(), truncated, "test"), /invalide|tronqué/);

function imageBlock(file, index) {
	const data = new DataView(buffer(file));
	let offset = 4;
	for (let i = 0; i < index; i++)
		offset += (data.getInt32(offset, true) & ~3) + 4;
	const palette = offset + 12;
	const image = palette + data.getUint32(palette, true);
	return {
		data,
		offset: image + 12,
		x: data.getInt16(image + 4, true),
		y: data.getInt16(image + 6, true),
		width: data.getUint16(image + 8, true),
		height: data.getUint16(image + 10, true)
	};
}

// These TEX2 blocks are the building and grass obscured by TEX3 menu art.
const blocks = [imageBlock("ridge_racer/TEX2.TMS", 81), imageBlock("ridge_racer/TEX2.TMS", 52)];
assert.deepEqual(blocks.map(({ x, y, width, height }) => [x, y, width, height]), [
	[832, 256, 16, 64], [800, 384, 32, 128]
]);
const menuVram = { words: vram.words.slice(), written: vram.written.slice() };
context.MapVram.loadTms(menuVram, buffer("ridge_racer/TEX3.TMS"), "TEX3.TMS");
for (const block of blocks) {
	let overwritten = 0;
	for (let y = 0; y < block.height; y++) {
		for (let x = 0; x < block.width; x++) {
			const address = (block.y + y) * 1024 + block.x + x;
			const expected = block.data.getUint16(block.offset + (y * block.width + x) * 2, true);
			assert.equal(vram.words[address], expected);
			if (menuVram.words[address] !== expected)
				overwritten++;
		}
	}
	assert.ok(overwritten > 0, "TEX3 must demonstrate the menu overwrite");
}

const pages = new Map();
const pagesBeforeTex4 = new Map();
let covered = 0;
let missingBeforeTex4 = 0;
for (const sector of sectors) {
	for (const primitive of sector.primitives) {
		const key = `${primitive.tpage}:${primitive.clut}`;
		if (!pages.has(key))
			pages.set(key, context.MapVram.page(vram, primitive.tpage, primitive.clut));
		if (!pagesBeforeTex4.has(key))
			pagesBeforeTex4.set(key, context.MapVram.page(beforeTex4, primitive.tpage, primitive.clut));
		if (context.MapVram.covered(pages.get(key), primitive.uvs))
			covered++;
		if (!context.MapVram.covered(pagesBeforeTex4.get(key), primitive.uvs))
			missingBeforeTex4++;
	}
}
assert.equal(pages.size, 98);
assert.equal(covered, 6737);
assert.equal(missingBeforeTex4, 297);
const primitive = sectors[1].primitives[0];
const page = pages.get(`${primitive.tpage}:${primitive.clut}`);
const u = primitive.uvs[0][0], v = primitive.uvs[0][1];
const address = (((primitive.tpage >> 4) & 1) * 256 + v) * 1024 + (primitive.tpage & 15) * 64 + (u >> 2);
const index = (vram.words[address] >> ((u & 3) * 4)) & 15;
const clutAddress = ((primitive.clut >> 6) & 511) * 1024 + (primitive.clut & 63) * 16;
const color = vram.words[clutAddress + index];
const pixel = (v * 256 + u) * 4;
assert.deepEqual(Array.from(page.pixels.slice(pixel, pixel + 4)), [
	Math.round((color & 31) * 255 / 31),
	Math.round(((color >> 5) & 31) * 255 / 31),
	Math.round(((color >> 10) & 31) * 255 / 31),
	color === 0 ? 0 : 255
]);
const empty = context.MapVram.page(context.MapVram.create(), 0, 0);
assert.deepEqual(Array.from(empty.pixels.slice(0, 4)), [255, 0, 255, 255]);
assert.equal(context.MapVram.covered(empty, [[0, 0], [1, 0], [0, 1], [1, 1]]), false);
assert.throws(() => context.MapVram.page(vram, 0x80, 0), /4-bpp/);
const skyVram = context.MapVram.create();
context.MapVram.loadTms(skyVram, buffer("ridge_racer/TEX0.TMS"), "TEX0.TMS");
const skyPage = context.MapVram.page(skyVram, 0x15, 0x7983);
const sky = context.MapVram.sky(skyVram);
assert.equal(sky.length, 512 * 256 * 4);
assert.throws(() => context.MapVram.sky(context.MapVram.create()), /incomplète/);
for (const [x, y] of [[0, 0], [255, 127], [256, 0], [511, 127], [300, 75]]) {
	const dst = (y * 512 + x) * 4;
	const src = ((y + (x >= 256 ? 128 : 0)) * 256 + x % 256) * 4;
	assert.deepEqual(Array.from(sky.slice(dst, dst + 4)), Array.from(skyPage.pixels.slice(src, src + 4)));
}
assert.ok(new Set(Array.from(sky)).size > 16);
assert.deepEqual(Array.from(sky.slice(128 * 512 * 4, 128 * 512 * 4 + 4)), Array.from(sky.slice((255 * 512 + 511) * 4, (255 * 512 + 512) * 4)));
console.log("VRAM circuit : 528 blocs TMS, 98 pages/CLUT et 6 737 primitives couvertes.");
