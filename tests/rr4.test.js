"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const context = { DataView, Number };
vm.createContext(context);
vm.runInContext(fs.readFileSync("Rr4Decode.js", "utf8"), context);

function arrayBuffer(path) {
	const bytes = fs.readFileSync(path);
	return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

const archive = arrayBuffer("ridge_racer_4/R4.BIN");
const resources = context.Rr4Decode.parse(archive);
assert.equal(resources.length, 934);
assert.deepEqual(
	{ start: resources[0].start, size: resources[0].size, type: resources[0].type },
	{ start: 4096, size: 395264, type: 2 }
);
assert.equal(resources[1].type, 10);
assert.equal(resources[933].size, 22528);
const firstExtractedPath = "ridge_racer_4/R4.BIN.00000";
let comparedFiles = 0;
if (fs.existsSync(firstExtractedPath)) {
	resources.forEach(resource => {
		const extracted = Buffer.from(context.Rr4Decode.extract(archive, resources, resource.id));
		const expected = fs.readFileSync(`ridge_racer_4/R4.BIN.${String(resource.id).padStart(5, "0")}`);
		assert.equal(extracted.compare(expected), 0, `Ressource ${resource.id} différente du fichier extrait`);
		comparedFiles++;
	});
}
assert.throws(() => context.Rr4Decode.extract(archive, resources, -1), /Indice/);

const expectedCourseSamples = [523, 556, 565, 585, 666, 642, 301, 396];
expectedCourseSamples.forEach((sampleCount, course) => {
	const scene = context.Rr4Decode.parseCourse(context.Rr4Decode.extract(archive, resources, course * 2 + 1));
	const route = context.Rr4Decode.parseTrackResource(context.Rr4Decode.extract(
		archive, resources, context.Rr4Decode.trackResourceBase + course
	));
	assert.equal(scene.samples.length, sampleCount, `Nombre d'échantillons circuit ${course + 1}`);
	assert.equal(route.sampleCount, sampleCount, `Ressource de tracé circuit ${course + 1}`);
	assert.equal(scene.type, course === 7 ? 11 : 10);
	assert.equal(scene.decorations, undefined,
		`Les objets de piste ne doivent pas être présentés comme des décors statiques (circuit ${course + 1})`);
});

function archiveBuffer(size, sectors) {
	const buffer = new ArrayBuffer(size);
	const data = new DataView(buffer);
	data.setUint32(0, sectors.length, true);
	sectors.forEach((sector, index) => data.setUint32(4 + index * 4, sector, true));
	return buffer;
}

assert.throws(() => context.Rr4Decode.parse(new ArrayBuffer(3)), /incomplet/);
assert.throws(() => context.Rr4Decode.parse(new ArrayBuffer(4097)), /multiple/);
assert.throws(() => context.Rr4Decode.parse(archiveBuffer(6144, [2, 1])), /Offset/);
console.log("R4.BIN : 934 ressources indexées et extraction vérifiée" +
	(comparedFiles ? " pour " + comparedFiles + " fichiers extraits." : "."));
