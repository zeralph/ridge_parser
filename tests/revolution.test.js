"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.join(__dirname, "..");
const context = vm.createContext({});
for (const file of ["MapDecode.js", "ObjDecode.js", "RevolutionDecode.js", "MapVram.js"])
	vm.runInContext(fs.readFileSync(path.join(root, file), "utf8"), context);

function buffer(name) {
	const bytes = fs.readFileSync(path.join(root, name));
	return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

const cases = [
	["CRS_EASY.DAT", 147, 6434, 264],
	["CRS_MID.DAT", 178, 6737, 383],
	["CRS_HIGH.DAT", 213, 7190, 418],
	["CRS_OLDE.DAT", 258, 6737, 256],
	["CRS_OLDH.DAT", 258, 6737, 368]
];
const big1 = new DataView(buffer("ridge_racer_revolution/BIG1.TMS"));
const textureReferences = context.MapVram.revolutionReferences(["BIG0.TMS", "BIG1.TMS", "BIG2.TMS", "BIG3.TMS", "BIG4.TMS"]
	.map(name => ({ name, buffer: buffer("ridge_racer_revolution/" + name) })));
let wallRecord = 4;
for (let i = 0; i < 8; i++)
	wallRecord += 4 + (big1.getInt32(wallRecord, true) & ~3);
const wallClut = wallRecord + 12;
const wallImage = wallClut + big1.getUint32(wallClut, true);
function checkTrack(sectors, points, name) {
	const bins = new Map();
	for (const section of sectors) {
		for (const primitive of section.primitives) {
			for (const indices of [[0, 1, 2], [2, 1, 3]]) {
				const [a, b, c] = indices.map(i => context.MapDecode.worldVertex(section.origin, primitive.vertices[i]));
				const determinant = (b[2] - c[2]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[2] - c[2]);
				if (!determinant)
					continue;
				const minX = Math.min(a[0], b[0], c[0]), maxX = Math.max(a[0], b[0], c[0]);
				const minZ = Math.min(a[2], b[2], c[2]), maxZ = Math.max(a[2], b[2], c[2]);
				const triangle = { a, b, c, determinant, minX, maxX, minZ, maxZ };
				for (let x = Math.floor(minX / 2048); x <= Math.floor(maxX / 2048); x++) {
					for (let z = Math.floor(minZ / 2048); z <= Math.floor(maxZ / 2048); z++) {
						const key = `${x},${z}`;
						if (!bins.has(key))
							bins.set(key, []);
						bins.get(key).push(triangle);
					}
				}
			}
		}
	}
	points.forEach((start, index) => {
		const end = points[(index + 1) % points.length];
		assert.ok(Math.hypot(end[0] - start[0], end[2] - start[2]) < 540, `${name}: discontinuité au point ${index}`);
		for (const fraction of [0, 0.25, 0.5, 0.75]) {
			const [x, y, z] = start.map((value, axis) => value + (end[axis] - value) * fraction);
			const triangles = bins.get(`${Math.floor(x / 2048)},${Math.floor(z / 2048)}`) || [];
			assert.ok(triangles.some(({ a, b, c, determinant, minX, maxX, minZ, maxZ }) => {
				if (x < minX || x > maxX || z < minZ || z > maxZ)
					return false;
				const u = ((b[2] - c[2]) * (x - c[0]) + (c[0] - b[0]) * (z - c[2])) / determinant;
				const v = ((c[2] - a[2]) * (x - c[0]) + (a[0] - c[0]) * (z - c[2])) / determinant;
				return u >= -1e-8 && v >= -1e-8 && u + v <= 1 + 1e-8 &&
					Math.abs(u * a[1] + v * b[1] + (1 - u - v) * c[1] - y) <= 32;
			}), `${name}: chaussée absente sous le tracé au point ${index}, fraction ${fraction}`);
		}
	});
}
let oldEasy;
for (const [name, sectionCount, primitiveCount, trackCount] of cases) {
	const crs = buffer("ridge_racer_revolution/" + name);
	const course = context.RevolutionDecode.parse(crs);
	assert.equal(course.sectors.length, sectionCount);
	assert.equal(course.sectors.reduce((sum, section) => sum + section.primitives.length, 0), primitiveCount);
	const track = context.RevolutionDecode.parseTrack(crs);
	assert.equal(track.length, trackCount);
	checkTrack(course.sectors, track, name);
	const pct = buffer("ridge_racer_revolution/" + context.RevolutionDecode.courses[name]);
	const vram = context.MapVram.loadRevolution(crs, course.textureOffset + 0x30000, pct);
	const objectVram = context.MapVram.loadRevolution(crs, course.textureOffset, pct);
	const vrams = { map: vram, objects: objectVram };
	const selections = new Map();
	function select(primitive, fallback) {
		const key = JSON.stringify([primitive.tpage, primitive.clut, primitive.window, primitive.uvs, fallback]);
		if (!selections.has(key))
			selections.set(key, context.MapVram.revolutionTexture(primitive, vrams, textureReferences, fallback));
		return selections.get(key);
	}
	if (!name.includes("OLD")) {
		const walls = course.sectors.flatMap(section => section.primitives)
			.filter(primitive => primitive.tpage === 0x1b && primitive.clut === 0x7d4b &&
				primitive.uvs.every(uv => uv[0] < 128 && uv[1] >= 128));
		assert.ok(walls.length > 0, `${name}: murs absents`);
		assert.ok(walls.every(primitive => select(primitive, "map").bank === "objects" &&
			select(primitive, "map").verified), `${name}: mauvaise banque des murs`);
		const building = course.buildings.find(item => item.model.id === 19);
		assert.ok(building, `${name}: bâtiment côtier absent`);
		const facade = building.model.primitives.filter(primitive => primitive.tpage === 0x1b &&
			primitive.clut === 0x7f48 && primitive.window && primitive.window[0] === 128 && primitive.window[1] === 96);
		assert.ok(facade.length > 0, `${name}: façade absente`);
		assert.ok(facade.every(primitive => select(primitive, building.textureBank).bank === "map" &&
			select(primitive, building.textureBank).verified), `${name}: mauvaise banque de la façade`);
		assert.equal(big1.getUint16(wallImage + 4, true), 704);
		assert.equal(big1.getUint16(wallImage + 6, true), 384);
		assert.equal(big1.getUint16(wallImage + 8, true), 32);
		assert.equal(big1.getUint16(wallImage + 10, true), 128);
		assert.equal(big1.getUint16(wallClut + 4, true), 176);
		assert.equal(big1.getUint16(wallClut + 6, true), 501);
		let overwritten = false;
		for (let y = 0; y < 128; y++) {
			for (let x = 0; x < 32; x++) {
				const source = big1.getUint16(wallImage + 12 + (y * 32 + x) * 2, true);
				const address = (384 + y) * 1024 + 704 + x;
				assert.equal(objectVram.words[address], source, `${name}: texture de mur incorrecte`);
				if (vram.words[address] !== source)
					overwritten = true;
			}
		}
		for (let color = 0; color < 16; color++)
			assert.equal(objectVram.words[501 * 1024 + 176 + color], big1.getUint16(wallClut + 12 + color * 2, true));
		assert.ok(overwritten, `${name}: la seconde banque ne doit pas servir pour ces murs`);
	}
	const pages = new Map();
	for (const section of course.sectors) {
		for (const primitive of section.primitives) {
			const bank = select(primitive, "map").bank;
			const key = `${bank}:${primitive.tpage}:${primitive.clut}`;
			if (!pages.has(key))
				pages.set(key, context.MapVram.page(vrams[bank], primitive.tpage, primitive.clut));
			assert.ok(context.MapVram.covered(pages.get(key), primitive.uvs), `${name}, section ${section.id}: texture incomplete`);
		}
	}
	for (const building of course.buildings) {
		for (const primitive of building.model.primitives) {
			const bank = select(primitive, building.textureBank).bank;
			const key = `${bank}:${primitive.tpage}:${primitive.clut}:${primitive.window}`;
			if (!pages.has(key))
				pages.set(key, context.MapVram.page(vrams[bank], primitive.tpage, primitive.clut, primitive.window));
			assert.ok(context.MapVram.covered(pages.get(key), primitive.uvs), `${name}: texture de décor incomplete`);
		}
	}
	const sky = context.MapVram.sky(vram, 0x7b85, [104, 168, 224]);
	assert.equal(sky.length, 512 * 256 * 4);
	if (name === "CRS_OLDE.DAT")
		oldEasy = course;
}

const rr1Buildings = context.ObjDecode.parseBuildings(buffer("ridge_racer/SCUS-943.00"),
	context.ObjDecode.parseModels(buffer("ridge_racer/OBJ.RRO")));
function buildingKey(building) {
	return JSON.stringify([building.position, building.rotation, building.model.primitives.map(primitive => primitive.vertices)]);
}
const originalBuildings = new Map(rr1Buildings.map(building => [buildingKey(building), building]));
assert.equal(oldEasy.buildings.length, rr1Buildings.length);
for (const building of oldEasy.buildings) {
	const original = originalBuildings.get(buildingKey(building));
	assert.ok(original, `Décor OLDE ${building.model.id} absent de RR1`);
	assert.equal(building.textureBank, original.textureBank === "scenery" ? "map" : "objects");
}

const rr1 = context.MapDecode.placeSections(
	context.MapDecode.parse(buffer("ridge_racer/MAP.RRM")), buffer("ridge_racer/IDX.HED"));
assert.equal(JSON.stringify(context.RevolutionDecode.parseTrack(buffer("ridge_racer_revolution/CRS_OLDE.DAT"))),
	JSON.stringify(context.MapDecode.parseTrack(buffer("ridge_racer/SCUS-943.00"))));
for (const [index, section] of oldEasy.sectors.entries()) {
	assert.deepEqual(Array.from(section.origin), Array.from(rr1[index].origin));
	assert.equal(section.primitives.length, rr1[index].primitives.length);
	section.primitives.forEach((primitive, i) => {
		assert.equal(JSON.stringify(primitive.vertices), JSON.stringify(rr1[index].primitives[i].vertices));
	});
}

const crs = buffer("ridge_racer_revolution/CRS_EASY.DAT");
const pct = buffer("ridge_racer_revolution/EASY_PCT.DAT");
const course = context.RevolutionDecode.parse(crs);
const objectVram = context.MapVram.loadRevolution(crs, course.textureOffset, pct);
const mapVram = context.MapVram.loadRevolution(crs, course.textureOffset + 0x30000, pct);
const noMatch = context.MapVram.revolutionTexture({ tpage: 0x1b, clut: 0, uvs: [[0, 0]], window: null },
	{ map: mapVram, objects: objectVram }, textureReferences, "objects");
assert.equal(noMatch.bank, "objects");
assert.equal(noMatch.verified, false);
const wall = course.sectors.flatMap(section => section.primitives)
	.find(primitive => primitive.tpage === 0x1b && primitive.clut === 0x7d4b);
const sameSnapshots = context.MapVram.revolutionTexture(wall,
	{ map: objectVram, objects: objectVram }, textureReferences, "map");
assert.equal(sameSnapshots.bank, "map");
assert.equal(sameSnapshots.verified, true);
const wrongPalette = { words: objectVram.words.slice(), written: objectVram.written.slice() };
wrongPalette.words[501 * 1024 + 176] ^= 1;
const mismatchedPalette = context.MapVram.revolutionTexture(wall,
	{ map: mapVram, objects: wrongPalette }, textureReferences, "map");
assert.equal(mismatchedPalette.bank, "map");
assert.equal(mismatchedPalette.verified, false);
function verifyBank(name, vram, width, height) {
	const tim = new DataView(buffer("ridge_racer_revolution/" + name));
	const image = 16 + tim.getUint32(16, true);
	assert.equal(tim.getUint16(image + 4, true), 640);
	assert.equal(tim.getUint16(image + 6, true), 256);
	assert.equal(tim.getUint16(image + 8, true), width);
	assert.equal(tim.getUint16(image + 10, true), height);
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++)
			assert.equal(vram.words[(256 + y) * 1024 + 640 + x], tim.getUint16(image + 12 + (y * width + x) * 2, true));
	}
}
verifyBank("BIG1.TMS", objectVram, 4, 16);
verifyBank("BIG2.TMS", mapVram, 24, 64);
const skyPage = context.MapVram.page(mapVram, 0x15, 0x7b85);
const sky = context.MapVram.sky(mapVram, 0x7b85, [104, 168, 224]);
const transparent = skyPage.pixels.findIndex((value, i) => i % 4 === 3 && value === 0);
assert.ok(transparent >= 0);
const sourcePixel = (transparent - 3) / 4;
const destinationPixel = Math.floor(sourcePixel / (256 * 128)) * 256 + Math.floor(sourcePixel / 256) % 128 * 512 + sourcePixel % 256;
assert.deepEqual(Array.from(sky.slice(destinationPixel * 4, destinationPixel * 4 + 4)), [104, 168, 224, 255]);
assert.throws(() => context.RevolutionDecode.parse(crs.slice(0, 0x817)), /tronqué/);
assert.throws(() => context.RevolutionDecode.parseTrack(crs.slice(0, 23)), /En-tête.*tronqué/);
assert.throws(() => context.RevolutionDecode.parseTrack(crs.slice(0, -1)), /tronqué/);
const badTrack = crs.slice(0);
const badTrackData = new DataView(badTrack);
const trackBase = badTrackData.getUint32(20, true);
const trackOffset = badTrackData.getUint32(trackBase + 80, true);
badTrackData.setUint32(20, crs.byteLength - 80, true);
assert.throws(() => context.RevolutionDecode.parseTrack(badTrack), /Répertoire/);
badTrackData.setUint32(20, trackBase, true);
badTrackData.setUint32(trackBase + 80, 0, true);
assert.throws(() => context.RevolutionDecode.parseTrack(badTrack), /Offset/);
badTrackData.setUint32(trackBase + 80, trackOffset, true);
badTrackData.setUint32(trackBase + trackOffset, 1, true);
assert.throws(() => context.RevolutionDecode.parseTrack(badTrack), /Tracé.*invalide/);
badTrackData.setUint32(trackBase + trackOffset, 0xffffffff, true);
assert.throws(() => context.RevolutionDecode.parseTrack(badTrack), /tronqué/);
const badOffsets = crs.slice(0);
new DataView(badOffsets).setUint32(4, 0x818, true);
assert.throws(() => context.RevolutionDecode.parse(badOffsets), /Répertoire/);
const badSection = crs.slice(0);
new DataView(badSection).setUint32(0x81c, 0, true);
assert.throws(() => context.RevolutionDecode.parse(badSection), /Offset de section/);
const badPrimitive = crs.slice(0);
const data = new DataView(badPrimitive);
const firstSection = 0x818 + data.getUint32(0x81c, true);
data.setUint16(firstSection, 3, true);
assert.throws(() => context.RevolutionDecode.parse(badPrimitive), /Flux de primitives/);
const badModel = crs.slice(0);
const modelBase = new DataView(badModel).getUint32(4, true);
new DataView(badModel).setUint32(modelBase + 4, 0, true);
assert.throws(() => context.RevolutionDecode.parse(badModel), /Offset de modèle/);
assert.throws(() => context.MapVram.loadRevolution(crs, course.textureOffset, pct.slice(0, -1)), /Fin de fichier/);
assert.throws(() => context.MapVram.loadRevolution(crs.slice(0, course.textureOffset + 2), course.textureOffset, pct), /Rectangle VRAM/);
const badPct = pct.slice(0);
new DataView(badPct).setUint16(4, 1024, true);
assert.throws(() => context.MapVram.loadRevolution(crs, course.textureOffset, badPct), /Rectangle VRAM/);

const script = fs.readFileSync(path.join(root, "index.html"), "utf8").match(/<script>\s*([\s\S]*?)<\/script>/);
assert.ok(script);
vm.runInContext(script[1].replace(/\bstart\(\);\s*$/, ""), context);
const elements = { sourceMode: { value: "revolution" }, course: { value: "CRS_MID.DAT" } };
context.document = { getElementById(id) { return elements[id]; } };
let rendered = 0;
context.loadMapSelection = () => { rendered++; };
const shown = [];
context.showCourse = (mode, course, render) => { shown.push([mode, course]); return render(); };
const requests = [];
context.fetch = url => new Promise(resolve => requests.push({ url, resolve }));

async function checkLoading() {
	context.m_sourceRequest = 1;
	const first = context.loadSource(crs, "CRS_EASY.DAT", 1, "revolution");
	context.m_sourceRequest = 2;
	const secondCrs = buffer("ridge_racer_revolution/CRS_MID.DAT");
	const second = context.loadSource(secondCrs, "CRS_MID.DAT", 2, "revolution");
	assert.equal(requests[0].url, "ridge_racer_revolution/EASY_PCT.DAT");
	assert.equal(requests[1].url, "ridge_racer_revolution/MID_PCT.DAT");
	requests[1].resolve({ ok: true, arrayBuffer: async () => buffer("ridge_racer_revolution/MID_PCT.DAT") });
	await second;
	assert.equal(context.m_mapSectors.length, 178);
	assert.equal(elements.course.value, "CRS_MID.DAT");
	requests[0].resolve({ ok: true, arrayBuffer: async () => pct });
	await first;
	assert.equal(context.m_mapSectors.length, 178, "Un chargement périmé ne doit pas remplacer le circuit");
	assert.equal(rendered, 1);
	assert.deepEqual(shown, [["revolution", "CRS_MID.DAT"]]);
	context.fetch = async () => ({ ok: false, status: 404 });
	await assert.rejects(context.loadSource(crs, "CRS_EASY.DAT", 2, "revolution"), /EASY_PCT\.DAT.*404/);
	await assert.rejects(context.loadSource(crs, "AUTRE.DAT", 2, "revolution"), /non reconnu/);

	let cleared = 0, loaded;
	context.m_viewer = { clearRr4FlyPath() { cleared++; } };
	context.syncRr4FlyButton = () => {};
	context.loadPath = (path, mode) => { loaded = [path, mode]; };
	elements.course.value = "CRS_OLDH.DAT";
	context.loadSelectedCourse();
	assert.deepEqual(loaded, ["ridge_racer_revolution/CRS_OLDH.DAT", "revolution"]);
	assert.equal(cleared, 1);
	elements.sourceMode.value = "rr4";
	elements.course.value = "7";
	context.m_sourceType = "rr4";
	context.m_rr4Resources = [{}];
	let renderedRr4 = 0;
	context.loadRr4Course = () => { renderedRr4++; };
	const request = context.m_sourceRequest;
	context.loadSelectedCourse();
	assert.equal(renderedRr4, 1);
	assert.equal(context.m_sourceRequest, request + 1);
	assert.equal(cleared, 2);
	let error;
	context.setStatus = message => { error = message; };
	elements.course.value = "8";
	context.loadSelectedCourse();
	assert.match(error, /invalide/);
	assert.equal(renderedRr4, 1);
}
checkLoading().then(() => {
	console.log("Revolution : cinq circuits, VRAM, géométrie OLDE et chargements vérifiés.");
}).catch(error => {
	console.error(error);
	process.exitCode = 1;
});
