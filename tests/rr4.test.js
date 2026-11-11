"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const context = { DataView, Number };
vm.createContext(context);
vm.runInContext(fs.readFileSync("Rr4Decode.js", "utf8"), context);
vm.runInContext(fs.readFileSync("MapVram.js", "utf8"), context);

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
const expectedGeometryQuads = [10235, 10951, 10865, 10593, 11492, 11039, 6448, 5455];
const expectedAmbient = [[58, 96, 115], [55, 87, 121], [30, 30, 20], [50, 40, 20],
	[79, 79, 110], [74, 102, 80], [96, 96, 90], [23, 20, 29]];
expectedCourseSamples.forEach((sampleCount, course) => {
	const scene = context.Rr4Decode.parseCourse(context.Rr4Decode.extract(archive, resources, course * 2 + 1));
	const route = context.Rr4Decode.parseTrackResource(context.Rr4Decode.extract(
		archive, resources, context.Rr4Decode.trackResourceBase + course
	));
	assert.equal(scene.samples.length, sampleCount, `Nombre d'échantillons circuit ${course + 1}`);
	assert.equal(route.sampleCount, sampleCount, `Ressource de tracé circuit ${course + 1}`);
	assert.equal(scene.type, course === 7 ? 11 : 10);
	assert.deepEqual(Array.from(scene.ambient), expectedAmbient[course]);
	assert.equal(scene.decorations.length, expectedGeometryQuads[course], `Géométrie fixe circuit ${course + 1}`);
	assert.equal(scene.sky.length, 3);
	assert.ok(scene.sky.every(layer => layer.vertices.length && layer.primitives.length));
	const skyVram = context.MapVram.loadRr4(context.Rr4Decode.extract(archive, resources, course * 2));
	const skyPages = new Map();
	scene.sky.forEach(layer => layer.primitives.forEach(primitive => {
		if (!primitive.uvs.length)
			return;
		const key = `${primitive.tpage}:${primitive.clut}`;
		if (!skyPages.has(key))
			skyPages.set(key, context.MapVram.page(skyVram, primitive.tpage, primitive.clut));
		assert.ok(context.MapVram.covered(skyPages.get(key), primitive.uvs));
	}));
	if (course === 0)
		assert.equal(JSON.stringify(scene.decorations[0].vertices), JSON.stringify([
			[50498, -327, 20815], [50554, -327, 20787],
			[50484, -327, 20736], [50547, -327, 20713]
		]));
	if (course === 0) {
		assert.equal(JSON.stringify(scene.decorations[0].uvs), "[[63,192],[14,192],[63,207],[10,207]]");
		assert.equal(scene.decorations[0].clut, 0x7c4c);
		assert.equal(scene.decorations[0].tpage, 0x2f);
		assert.equal(JSON.stringify(scene.sky[0].vertices[0]), "[-1828,-699,0]");
		assert.equal(JSON.stringify(scene.sky[0].primitives[0].indices), "[71,66,56]");
		assert.equal(JSON.stringify(scene.sky[0].primitives[0].colors[0]), "[80,168,208]");
		assert.equal(JSON.stringify(scene.sky[2].primitives[0].uvs), "[[128,31],[255,0],[255,31]]");
		assert.equal(JSON.stringify(scene.decorations[2729].window), "[64,192,64,64]");
		for (const [quadIndex, colors] of [
			[0, [[112, 128, 120], [24, 40, 56], [88, 104, 104], [24, 40, 56]]],
			[2729, [[112, 128, 120], [112, 128, 120], [112, 128, 120], [24, 40, 56]]],
			[3711, [[28, 47, 57], [28, 47, 57], [28, 47, 57], [28, 47, 57]]],
			[8664, [[28, 47, 57], [28, 47, 57], [28, 47, 57], [28, 47, 57]]]
		])
			assert.equal(JSON.stringify(scene.decorations[quadIndex].colors), JSON.stringify(colors));
		const wall = scene.decorations[9197].vertices;
		assert.ok(wall.some(vertex => JSON.stringify(vertex) === "[36559,0,5830]"));
		assert.ok(wall.some(vertex => JSON.stringify(vertex) === "[36559,-163,5830]"));
		assert.equal(JSON.stringify(context.Rr4Decode.worldVertex(36559, -163, 5830)), "[36559,163,-5830]");
		const sample = scene.samples[22];
		assert.equal(JSON.stringify(context.Rr4Decode.worldVertex(sample.x, sample.height, sample.z)),
			"[36559,1,-6238]");
		const textureResource = context.Rr4Decode.extract(archive, resources, 0);
		const vram = context.MapVram.loadRr4(textureResource);
		for (const [quadIndex, expected] of [[0, [206, 189, 165, 255]], [2729, [90, 90, 82, 255]]]) {
			const quad = scene.decorations[quadIndex];
			const page = context.MapVram.page(vram, quad.tpage, quad.clut, quad.window);
			const [u, v] = quad.uvs[0];
			const pixel = (v * 256 + u) * 4;
			assert.deepEqual(Array.from(page.pixels.slice(pixel, pixel + 4)), expected);
			assert.equal(context.MapVram.covered(page, quad.uvs), true);
		}
		const invalidList = textureResource.slice(0);
		const invalidData = new DataView(invalidList);
		invalidData.setInt32(invalidData.getUint32(8, true) - 4, 1, true);
		assert.throws(() => context.MapVram.loadRr4(invalidList), /liste TIM R4/i);
		assert.throws(() => context.MapVram.loadRr4(new ArrayBuffer(8)), /textures R4 invalide/);
	}
	if (course === 4) {
		const sample = scene.samples[8];
		const roadEdge = [sample.x + sample.left[0], sample.height, sample.z + sample.left[1]];
		assert.equal(JSON.stringify(roadEdge), "[35064,0,9432]");
		assert.ok(scene.decorations.some(quad => quad.vertices.some(vertex =>
			vertex.every((value, index) => value === roadEdge[index]))),
		"Un sommet de chaussée doit correspondre au repère de la géométrie fixe");
	}
});

context.THREE = require("../js/three.js");
context.m_buffer = archive;
context.m_rr4Resources = resources;
context.m_sourceType = "";
context.m_object = null;
context.m_triangleObjects = [];
context.m_viewer = { scene: { add() {} }, fitToBounds() {}, remove() {} };
context.document = { getElementById() { return {}; } };
context.applyRr4RenderMode = function() {};
const html = fs.readFileSync("index.html", "utf8");
const renderStart = html.indexOf("function rr4TextureKey(");
const renderEnd = html.indexOf("function disposeRr4Meshes(", renderStart);
assert.ok(renderStart >= 0 && renderEnd > renderStart);
vm.runInContext(html.slice(renderStart, renderEnd), context);
context.loadRr4Sky = function() {};
context.renderRr4Course(0);
const roadMesh = context.m_triangleObjects[0];
const decorMesh = context.m_triangleObjects[1];
assert.equal(roadMesh.geometry.vertices[22 * 4].y, 1);
assert.equal(roadMesh.geometry.faces[0].normal.y, 1);
const circuit8 = context.Rr4Decode.parseCourse(context.Rr4Decode.extract(archive, resources, 15));
const sign = circuit8.decorations[1913];
assert.equal(JSON.stringify(sign.uvs), "[[128,224],[255,224],[128,239],[255,239]]");
const camera = new context.THREE.PerspectiveCamera(90, 1, 0.1, 5000);
camera.position.set(39317, 250, -45360);
camera.lookAt(new context.THREE.Vector3(39317, 315, -44988));
camera.updateMatrixWorld(true);
const signScreenX = sign.vertices.slice(0, 2).map(vertex => {
	const world = context.Rr4Decode.worldVertex(vertex[0], vertex[1], vertex[2]);
	return new context.THREE.Vector3(world[0], world[1], world[2]).project(camera).x;
});
assert.ok(signScreenX[0] < signScreenX[1], "Le panneau doit être lisible depuis la chaussée");
const wallIndex = decorMesh.userData.rr4Primitives.findIndex(quad =>
	quad.vertices.some(vertex => JSON.stringify(vertex) === "[36559,-163,5830]"));
assert.ok(wallIndex >= 0);
const wallVertexIndex = decorMesh.userData.rr4Primitives[wallIndex].vertices.findIndex(vertex =>
	JSON.stringify(vertex) === "[36559,-163,5830]");
assert.equal(decorMesh.geometry.vertices[wallIndex * 4 + wallVertexIndex].y, 163);
for (let triangle = 0; triangle < 2; triangle++) {
	const face = decorMesh.geometry.faces[wallIndex * 2 + triangle];
	const faceUvs = decorMesh.geometry.faceVertexUvs[0][wallIndex * 2 + triangle];
	[face.a, face.b, face.c].forEach((vertexIndex, index) => {
		const uv = decorMesh.userData.rr4Primitives[wallIndex].uvs[vertexIndex - wallIndex * 4];
		assert.equal(faceUvs[index].x, (uv[0] + 0.5) / 256);
		assert.equal(faceUvs[index].y, (uv[1] + 0.5) / 256);
	});
}
const coloredIndex = decorMesh.userData.rr4Primitives.findIndex(quad =>
	new Set(quad.colors.map(color => color.join(","))).size > 1 &&
	quad.colors.some(color => color.some(channel => channel > 128)));
assert.ok(coloredIndex >= 0);
for (let triangle = 0; triangle < 2; triangle++) {
	const coloredFace = decorMesh.geometry.faces[coloredIndex * 2 + triangle];
	[coloredFace.a, coloredFace.b, coloredFace.c].forEach((vertexIndex, index) => {
		const expected = decorMesh.userData.rr4Primitives[coloredIndex].colors[vertexIndex - coloredIndex * 4];
		const color = coloredFace.vertexColors[index];
		assert.deepEqual([color.r, color.g, color.b], Array.from(expected, channel => channel / 128));
	});
}

const controls = { rr4RenderMode: { value: "textured" }, rr4RenderStatus: {},
	rr4Ambient: { value: "#3a6073" }, rr4AmbientEnabled: { checked: true } };
controls.skyStatus = {};
context.document = { getElementById(id) { return controls[id]; } };
context.m_viewer.clearSky = function() { this.skyScene = null; };
context.m_viewer.setSkyScene = function(scene) { this.skyScene = scene; };
const skyStart = html.indexOf("function loadRr4Sky(");
assert.ok(skyStart >= 0 && skyStart < renderStart);
vm.runInContext(html.slice(skyStart, renderStart), context);
const firstSky = context.Rr4Decode.parseCourse(context.Rr4Decode.extract(archive, resources, 1)).sky;
context.loadRr4Sky(firstSky, context.Rr4Decode.extract(archive, resources, 0));
assert.match(controls.skyStatus.textContent, /Ciel R4 ·/);
const skyScene = context.m_viewer.skyScene;
assert.ok(skyScene);
const untexturedSky = skyScene.children.find(mesh => !mesh.material.map);
const texturedSky = skyScene.children.find(mesh => mesh.material.map);
assert.ok(untexturedSky && texturedSky);
assert.equal(untexturedSky.geometry.faces.length, firstSky[0].primitives.length);
const skyFace = untexturedSky.geometry.faces[0];
const skyPrimitive = firstSky[0].primitives[0];
const sourceSkyVertex = firstSky[0].vertices[skyPrimitive.indices[0]];
const skyVertex = untexturedSky.geometry.vertices[skyFace.a];
assert.deepEqual([skyVertex.x, skyVertex.y, skyVertex.z],
	Array.from(context.Rr4Decode.worldVertex(...sourceSkyVertex), value => value / 256));
assert.deepEqual([skyFace.vertexColors[0].r, skyFace.vertexColors[0].g, skyFace.vertexColors[0].b],
	Array.from(skyPrimitive.colors[0], channel => channel / 255));
assert.equal(texturedSky.material.vertexColors, context.THREE.VertexColors);
assert.equal(texturedSky.material.depthWrite, false);
context.loadRr4Sky(firstSky, new ArrayBuffer(8));
assert.equal(context.m_viewer.skyScene, null);
assert.match(controls.skyStatus.textContent, /Ciel R4 non chargé/);

context.m_rr4Textures = [];
context.disposeMeshMaterial = function(material) {
	if (material instanceof context.THREE.MultiMaterial)
		material.materials.forEach(item => item.dispose());
	else
		material.dispose();
};
context.setStatus = function() {};
context.MapVram = {
	loadRr4() { return {}; },
	page() { return { pixels: new Uint8Array(4) }; },
	covered() { return true; }
};
const modeStart = html.indexOf("function updateRr4Ambient(");
const modeEnd = html.indexOf("function loadRr4Course(", modeStart);
assert.ok(modeStart >= 0 && modeEnd > modeStart);
vm.runInContext(html.slice(modeStart, modeEnd), context);
context.applyRr4RenderMode();
assert.ok(decorMesh.material.materials.every(material => material.vertexColors === context.THREE.VertexColors));
assert.equal(roadMesh.visible, false);
const ambientFace = decorMesh.geometry.faces[coloredIndex * 2];
const ambientVertex = ambientFace.a - coloredIndex * 4;
const ambientSource = decorMesh.userData.rr4Primitives[coloredIndex].colors[ambientVertex];
assert.deepEqual([ambientFace.vertexColors[0].r, ambientFace.vertexColors[0].g, ambientFace.vertexColors[0].b],
	Array.from(ambientSource, (channel, index) => Math.min(255, channel + expectedAmbient[0][index]) / 128));
controls.rr4Ambient.value = "#010203";
context.updateRr4Ambient();
assert.deepEqual([ambientFace.vertexColors[0].r, ambientFace.vertexColors[0].g, ambientFace.vertexColors[0].b],
	Array.from(ambientSource, (channel, index) => Math.min(255, channel + index + 1) / 128));
controls.rr4AmbientEnabled.checked = false;
context.updateRr4Ambient();
assert.deepEqual([ambientFace.vertexColors[0].r, ambientFace.vertexColors[0].g, ambientFace.vertexColors[0].b],
	Array.from(ambientSource, channel => channel / 128));
controls.rr4AmbientEnabled.checked = true;
controls.rr4RenderMode.value = "shaded";
context.applyRr4RenderMode();
assert.ok(decorMesh.material instanceof context.THREE.MeshBasicMaterial);
assert.equal(decorMesh.material.vertexColors, context.THREE.VertexColors);
assert.ok(roadMesh.material instanceof context.THREE.MeshBasicMaterial);
assert.equal(roadMesh.visible, true);
const firstColor = decorMesh.geometry.faces[coloredIndex * 2].vertexColors[0];
const firstVertex = decorMesh.geometry.faces[coloredIndex * 2].a - coloredIndex * 4;
const sourceColor = decorMesh.userData.rr4Primitives[coloredIndex].colors[firstVertex];
["r", "g", "b"].forEach((channel, index) => {
	assert.ok(Math.abs(firstColor[channel] * decorMesh.material.color[channel] - sourceColor[index] / 255) < 1e-12);
});
controls.rr4RenderMode.value = "wireframe";
context.applyRr4RenderMode();
assert.equal(decorMesh.material.wireframe, true);
assert.equal(roadMesh.visible, true);

const brokenCourse = context.Rr4Decode.extract(archive, resources, 1);
const brokenData = new DataView(brokenCourse);
const relativeOffset = brokenData.getUint32(4, true);
brokenData.setUint32(relativeOffset + 0x10 + 5 * 4,
	brokenData.getUint32(relativeOffset + 0x10 + 5 * 4, true) - 1, true);
assert.throws(() => context.Rr4Decode.parseCourse(brokenCourse), /géométrie.*tronqué/);
const brokenSky = context.Rr4Decode.extract(archive, resources, 1);
const skyData = new DataView(brokenSky);
const skyOffset = skyData.getUint32(8, true);
skyData.setUint32(skyOffset + skyData.getUint32(skyOffset + 12, true), 0x10063, true);
assert.throws(() => context.Rr4Decode.parseCourse(brokenSky), /Commande de ciel R4/);
const brokenLighting = context.Rr4Decode.extract(archive, resources, 1);
const lightingData = new DataView(brokenLighting);
lightingData.setUint32(28, lightingData.getUint32(24, true) + 0x2b, true);
assert.throws(() => context.Rr4Decode.parseCourse(brokenLighting), /éclairage R4 tronquées/);

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
