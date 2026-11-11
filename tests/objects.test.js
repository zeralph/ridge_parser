"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.join(__dirname, "..");
const context = vm.createContext({});
for (const file of ["ObjDecode.js", "MapVram.js"])
	vm.runInContext(fs.readFileSync(path.join(root, file), "utf8"), context);
function bytes(name) {
	const b = fs.readFileSync(path.join(root, "ridge_racer", name));
	return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
}

const exe = bytes("SCUS-943.00");
assert.equal(crypto.createHash("sha256").update(Buffer.from(exe)).digest("hex"), context.ObjDecode.executableHash);
const models = context.ObjDecode.parseModels(bytes("OBJ.RRO"));
assert.equal(models.length, 319);
assert.throws(() => context.ObjDecode.parseModels(bytes("OBJ.RRO").slice(0, -1)), /tronqué/);
const buildings = context.ObjDecode.parseBuildings(exe, models);
assert.equal(buildings.length, 65);
assert.equal(buildings[13].model.id, 125);
assert.deepEqual(Array.from(buildings[13].position), [38144, 1188, 37632]);
assert.equal(buildings[13].rotation, 3200);
assert.equal(buildings[15].model.id, 84);
assert.deepEqual(Array.from(buildings[15].position), [36700, 1856, 37268]);
assert.deepEqual(Array.from(buildings.slice(59), item => item.model.id), [176, 177, 179, 64, 62, 63]);
assert.deepEqual(Array.from(buildings[62].position), [47192, 144, 39638]);
assert.equal(buildings[62].rotation, 0);
assert.deepEqual(Array.from(models[64].counts), [0, 29, 0, 49, 30, 0]);
assert.equal(models[64].primitives.length, 108);
assert.equal(models[62].primitives.length, 8);
assert.equal(models[63].primitives.length, 14);
assert.deepEqual(Array.from(models[64].primitives[78].window), [160, 32, 16, 16]);
assert.throws(() => context.ObjDecode.parseBuildings(exe.slice(0, 100), models), /tronquée/);
const origin = context.ObjDecode.worldVertex({ position: [36700, 1856, 37268], rotation: 0 }, [400, -800, 1200]);
assert.deepEqual(Array.from(origin), [24640, -1656, 37568]);
const rotated = context.ObjDecode.worldVertex({ position: [36700, 1856, 37268], rotation: 1024 }, [400, 0, 0]);
assert.ok(Math.abs(rotated[0] - 24740) < 1e-8);
assert.ok(Math.abs(rotated[2] - 37368) < 1e-8);

const map = context.MapVram.create();
const objects = context.MapVram.create();
for (const name of Array.from(context.MapVram.mapBanks)) {
	context.MapVram.loadTms(map, bytes(name), name);
	if (context.MapVram.objectBanks.includes(name))
		context.MapVram.loadTms(objects, bytes(name), name);
}
assert.notEqual(map.words[256 * 1024 + 768], objects.words[256 * 1024 + 768]);
const pages = new Map();
let total = 0, covered = 0;
for (const building of buildings) {
	for (const primitive of building.model.primitives) {
		const key = [building.textureBank, primitive.tpage, primitive.clut, ...(primitive.window || [])].join(":");
		if (!pages.has(key))
			pages.set(key, context.MapVram.page(building.textureBank === "scenery" ? map : objects, primitive.tpage, primitive.clut, primitive.window));
		total++;
		if (context.MapVram.covered(pages.get(key), primitive.uvs))
			covered++;
	}
}
assert.equal(total, 753);
assert.equal(covered, 753);
const p = models[85].primitives[0];
assert.deepEqual(Array.from(p.window), [128, 0, 128, 32]);
const windowed = context.MapVram.page(objects, p.tpage, p.clut, p.window);
const normal = context.MapVram.page(objects, p.tpage, p.clut);
for (const [u, v] of [[0, 0], [127, 31], [20, 45], [100, 62]]) {
	const destination = (v * 256 + u) * 4;
	const source = ((v % 32) * 256 + 128 + u) * 4;
	assert.deepEqual(Array.from(windowed.pixels.slice(destination, destination + 4)), Array.from(normal.pixels.slice(source, source + 4)));
}
assert.throws(() => context.MapVram.page(objects, 0, 0, [0, 0, 24, 32]), /Fenêtre/);
console.log("OBJ.RRO : 65 éléments placés, 753 primitives et fenêtres PS1 vérifiés.");
