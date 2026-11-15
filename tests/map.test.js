"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const context = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(root, "MapDecode.js"), "utf8"), context);
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const script = html.match(/<script>\s*([\s\S]*?)<\/script>/);
assert.ok(script, "Script principal introuvable");
vm.runInContext(script[1].replace(/\bstart\(\);\s*$/, ""), context);

function arrayBuffer(file) {
	const bytes = fs.readFileSync(path.join(root, file));
	return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

const map = arrayBuffer("ridge_racer/MAP.RRM");
const sectors = context.MapDecode.parse(map);
assert.equal(sectors.length, 258);
assert.equal(sectors.reduce((total, sector) => total + sector.primitives.length, 0), 6737);
assert.deepEqual(["A", "B", "C"].map(type => sectors.reduce((total, sector) => total + sector.primitives.filter(p => p.type === type).length, 0)), [622, 5420, 695]);
assert.throws(() => context.MapDecode.parse(map.slice(0, -1)), /tronquées/);
assert.throws(() => context.MapDecode.parse(new ArrayBuffer(3)), /incomplet/);
const paddedHeader = map.slice(0);
new DataView(paddedHeader).setUint16(2, 0x1234, true);
assert.equal(context.MapDecode.parse(paddedHeader).length, 258);
const nonzeroFourthCount = map.slice(0);
new DataView(nonzeroFourthCount).setUint16(10, 1, true);
assert.throws(() => context.MapDecode.parse(nonzeroFourthCount), /Quatrième compteur/);

const idx = arrayBuffer("ridge_racer/IDX.HED");
const placed = context.MapDecode.placeSections(sectors, idx);
assert.deepEqual(Array.from(placed[0].origin), [40960, 2048]);
assert.deepEqual(Array.from(placed[1].origin), [49152, 4096]);
assert.deepEqual(Array.from(placed[100].origin), [34816, 20480]);
assert.deepEqual(Array.from(placed[257].origin), [26624, 40960]);
assert.equal(placed.length, 258);
assert.deepEqual(Array.from(context.MapDecode.worldVertex(placed[0].origin, placed[0].primitives[0].vertices[0])), [22464, -0, 3723.5]);
function positions(section) {
	return new Set(section.primitives.flatMap(primitive =>
		primitive.vertices.map(vertex => JSON.stringify(context.MapDecode.worldVertex(section.origin, vertex)))));
}
const firstSeam = positions(placed[31]);
const secondSeam = positions(placed[32]);
const sharedSeam = [...firstSeam].filter(vertex => secondSeam.has(vertex));
assert.equal(sharedSeam.length, 2, "Les sections 31 et 32 doivent partager les deux sommets de leur jonction");
assert.deepEqual(sharedSeam.sort(), [
	JSON.stringify([18435.25, 1099.75, 11926.75]),
	JSON.stringify([18450.5, 1100.25, 12103.75])
].sort());
assert.throws(() => context.MapDecode.placeSections(sectors, idx.slice(0, -2)), /2 048 octets/);
const duplicateIndex = idx.slice(0);
new DataView(duplicateIndex).setInt16(70 * 2, 0, true);
assert.throws(() => context.MapDecode.placeSections(sectors, duplicateIndex), /dupliquée/);
const missingIndex = idx.slice(0);
new DataView(missingIndex).setInt16(42 * 2, -1, true);
assert.throws(() => context.MapDecode.placeSections(sectors, missingIndex), /absente/);
const invalidIndex = idx.slice(0);
new DataView(invalidIndex).setInt16(42 * 2, 258, true);
assert.throws(() => context.MapDecode.placeSections(sectors, invalidIndex), /invalide/);

const exe = arrayBuffer("ridge_racer/SCUS-943.00");
const track = context.MapDecode.parseTrack(exe);
assert.equal(crypto.createHash("sha256").update(Buffer.from(map)).digest("hex"), context.MapDecode.trackMapHash);
assert.equal(crypto.createHash("sha256").update(Buffer.from(idx)).digest("hex"), context.MapDecode.trackIndexHash);
assert.equal(track.length, 256);
assert.deepEqual(Array.from(track[0]), [7934.23876953125, 0, 28264.210876464844]);
assert.deepEqual(Array.from(track[120]), [26316.45526123047, 681, 24684.58673095703]);
assert.throws(() => context.MapDecode.parseTrack(exe.slice(0, 0x48564 + 256 * 20 - 1)), /tronqué/);
const triangles = placed.flatMap(section => section.primitives.flatMap(primitive =>
	[[0, 1, 2], [2, 1, 3]].map(indices => {
		const [a, b, c] = indices.map(index => context.MapDecode.worldVertex(section.origin, primitive.vertices[index]));
		const determinant = (b[2] - c[2]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[2] - c[2]);
		return { a, b, c, determinant,
			minX: Math.min(a[0], b[0], c[0]), maxX: Math.max(a[0], b[0], c[0]),
			minZ: Math.min(a[2], b[2], c[2]), maxZ: Math.max(a[2], b[2], c[2]) };
	}))).filter(triangle => triangle.determinant !== 0);
track.forEach((start, index) => {
	const end = track[(index + 1) % track.length];
	assert.ok(Math.hypot(end[0] - start[0], end[2] - start[2]) < 540,
		`Discontinuité du tracé au point ${index}`);
	for (const fraction of [0, 0.25, 0.5, 0.75]) {
		const [x, y, z] = start.map((value, axis) => value + (end[axis] - value) * fraction);
		assert.ok(triangles.some(({ a, b, c, determinant, minX, maxX, minZ, maxZ }) => {
			if (x < minX || x > maxX || z < minZ || z > maxZ)
				return false;
			const u = ((b[2] - c[2]) * (x - c[0]) + (c[0] - b[0]) * (z - c[2])) / determinant;
			const v = ((c[2] - a[2]) * (x - c[0]) + (a[0] - c[0]) * (z - c[2])) / determinant;
			const w = 1 - u - v;
			return u >= -1e-8 && v >= -1e-8 && w >= -1e-8 && Math.abs(u * a[1] + v * b[1] + w * c[1] - y) <= 8;
		}), `Chaussée manquante sous le tracé au point ${index}, fraction ${fraction}`);
	}
});

const images = [];
for (let bank = 0; bank < 5; bank++) {
	const buffer = arrayBuffer("ridge_racer/TEX" + bank + ".TMS");
	for (const image of context.readTmsImages(buffer)) {
		image.bank = bank;
		images.push(image);
	}
}

const example = sectors[1].primitives[0];
assert.equal(example.clut, 0x7800);
assert.equal(example.tpage, 0x16);
assert.equal(example.type, "B");
assert.equal(example.depthBias, 50);
assert.equal(example.flags, 0x0202);
assert.deepEqual(Array.from(example.uvs, uv => Array.from(uv)), [[0, 128], [127, 128], [0, 255], [127, 255]]);
const matches = context.MapDecode.findImages(example, images);
assert.equal(matches.length, 1);
assert.equal(matches[0].bank, 0);
assert.equal(matches[0].index, 32);
assert.deepEqual(Array.from(context.MapDecode.imageUvs(example, matches[0]), uv => Array.from(uv)), [
	[0.5 / 128, 0.5 / 128], [127.5 / 128, 0.5 / 128],
	[0.5 / 128, 127.5 / 128], [127.5 / 128, 127.5 / 128]
]);
assert.equal(context.MapDecode.findImages({ ...example, tpage: 0x96 }, images).length, 0);

const totals = [0, 0, 0];
for (const sector of sectors) {
	for (const primitive of sector.primitives) {
		const count = context.MapDecode.findImages(primitive, images).length;
		totals[count === 0 ? 0 : count === 1 ? 1 : 2]++;
	}
}
assert.deepEqual(totals, [3677, 3060, 0]);

vm.runInContext(fs.readFileSync(path.join(root, "MapView.js"), "utf8"), context);
context.ObjDecode = { executableHash: crypto.createHash("sha256").update(Buffer.from(exe)).digest("hex") };
context.window = { crypto: crypto.webcrypto };
let fetchCount = 0;
context.fetch = async () => { fetchCount++; return { ok: true, arrayBuffer: async () => exe }; };
const flyStatus = {};
context.document = { getElementById() { return flyStatus; } };
const group = {};
context.m_object = group;
context.m_sourceType = "map";
let flyPath;
context.m_viewer = { setFlyPath(points, direction) { flyPath = { points, direction }; } };
context.syncRr4FlyButton = function() {};
async function checkMapFlyLoading() {
	await context.loadMapFlyPath(group, map, idx);
	assert.equal(flyPath.points.length, 256);
	assert.equal(flyPath.direction, 1);
	assert.match(flyStatus.textContent, /256 points/);
	assert.equal(fetchCount, 1);
	context.m_object = {};
	flyPath = null;
	await context.loadMapFlyPath(group, map, idx);
	assert.equal(flyPath, null, "Un chargement périmé ne doit pas changer la caméra");
	assert.equal(fetchCount, 1);
	context.m_object = group;
	await context.loadMapFlyPath(group, map.slice(0, -1), idx);
	assert.match(flyStatus.textContent, /MAP.RRM ou IDX.HED non reconnue/);
	context.m_mapExecutablePromise = null;
	context.fetch = async () => ({ ok: true, arrayBuffer: async () => exe.slice(0, -1) });
	await context.loadMapFlyPath(group, map, idx);
	assert.match(flyStatus.textContent, /SCUS-943.00 non reconnue/);
	assert.equal(context.m_mapExecutablePromise, null);
}
checkMapFlyLoading().then(() => {
	console.log("MAP.RRM : placement, textures et trajectoire native vérifiés.");
}).catch(error => {
	console.error(error);
	process.exitCode = 1;
});
