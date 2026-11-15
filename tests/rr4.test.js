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
const expectedGeometryQuads = [10235, 11130, 10865, 10593, 11492, 11039, 6448, 6354];
const expectedGeometryTriangles = [0, 564, 0, 0, 0, 0, 0, 0];
const expectedDecorSpriteCounts = [76, 77, 316, 300, 373, 406, 205, 166];
const expectedAmbient = [[58, 96, 115], [55, 87, 121], [30, 30, 20], [50, 40, 20],
	[79, 79, 110], [74, 102, 80], [96, 96, 90], [23, 20, 29]];
context.THREE = require("../js/three.js");
vm.runInContext(fs.readFileSync("Sceneview.js", "utf8"), context);
const pathViewer = {
	setRr4FlyPath: context.Sceneview.prototype.setRr4FlyPath,
	setFlyPath: context.Sceneview.prototype.setFlyPath,
	stopRr4Fly: context.Sceneview.prototype.stopRr4Fly
};

function roadSurfaces(primitives) {
	const surfaces = [];
	primitives.forEach(primitive => {
		const triangles = primitive.vertices.length === 4 ? [[0, 1, 2], [1, 3, 2]] : [[0, 1, 2]];
		triangles.forEach(indices => {
			const [a, b, c] = indices.map(index => primitive.vertices[index]);
			const determinant = (b[2] - c[2]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[2] - c[2]);
			if (determinant)
				surfaces.push({ a, b, c, determinant,
					minX: Math.min(a[0], b[0], c[0]), maxX: Math.max(a[0], b[0], c[0]),
					minZ: Math.min(a[2], b[2], c[2]), maxZ: Math.max(a[2], b[2], c[2]) });
		});
	});
	return surfaces;
}

function roadSampleCovered(sample, surfaces, visibleFromAbove = false) {
	return surfaces.some(({ a, b, c, determinant, minX, maxX, minZ, maxZ }) => {
		if ((visibleFromAbove && determinant >= 0) ||
			sample.x < minX || sample.x > maxX || sample.z < minZ || sample.z > maxZ)
			return false;
		const alpha = ((b[2] - c[2]) * (sample.x - c[0]) + (c[0] - b[0]) * (sample.z - c[2])) / determinant;
		const beta = ((c[2] - a[2]) * (sample.x - c[0]) + (a[0] - c[0]) * (sample.z - c[2])) / determinant;
		const gamma = 1 - alpha - beta;
		return alpha >= -1e-6 && beta >= -1e-6 && gamma >= -1e-6 &&
			Math.abs(alpha * a[1] + beta * b[1] + gamma * c[1] - sample.height / 4) <= 32;
	});
}

expectedCourseSamples.forEach((sampleCount, course) => {
	const courseBuffer = context.Rr4Decode.extract(archive, resources, course * 2 + 1);
	const scene = context.Rr4Decode.parseCourse(courseBuffer);
	const route = context.Rr4Decode.parseTrackResource(context.Rr4Decode.extract(
		archive, resources, context.Rr4Decode.trackResourceBase + course
	));
	assert.equal(scene.samples.length, sampleCount, `Nombre d'échantillons circuit ${course + 1}`);
	assert.equal(route.sampleCount, sampleCount, `Ressource de tracé circuit ${course + 1}`);
	pathViewer.setRr4FlyPath(scene.samples);
	assert.equal(pathViewer.rr4Fly.points.length, sampleCount);
	scene.samples.forEach((sample, index) => {
		const point = pathViewer.rr4Fly.points[index];
		assert.equal(point.x, sample.x + (sample.left[0] + sample.right[0]) / 2);
		assert.ok(point.y + sample.height / 4 === 0);
		assert.equal(point.z, -sample.z - (sample.left[1] + sample.right[1]) / 2);
		assert.ok(pathViewer.rr4Fly.distances[index + 1] - pathViewer.rr4Fly.distances[index] < 400,
			`Discontinuité de trajectoire circuit ${course + 1}, échantillon ${index}`);
	});
	assert.equal(scene.type, course === 7 ? 11 : 10);
	assert.deepEqual(Array.from(scene.ambient), expectedAmbient[course]);
	assert.equal(scene.decorations.filter(primitive => primitive.vertices.length === 4).length,
		expectedGeometryQuads[course], `Quads du circuit ${course + 1}`);
	assert.equal(scene.decorations.filter(primitive => primitive.vertices.length === 3).length,
		expectedGeometryTriangles[course], `Triangles du circuit ${course + 1}`);
	const data = new DataView(courseBuffer);
	const relativeOffset = data.getUint32(4, true);
	const sectionEnd = data.getUint32(8, true) - relativeOffset;
	const sections = Array.from({ length: 16 }, (_, index) =>
		data.getUint32(relativeOffset + 0x10 + index * 4, true)).concat(sectionEnd);
	const viewOffset = data.getUint32(relativeOffset + 12, true);
	assert.equal((sections[0] - viewOffset) % 80, 0);
	const counts = Array(16).fill(0);
	for (let record = viewOffset; record < sections[0]; record += 80) {
		counts.forEach((count, stream) => {
			const offset = relativeOffset + record + 16 + stream * 4;
			assert.equal(data.getUint16(offset + 2, true), count);
			counts[stream] += data.getUint16(offset, true);
		});
	}
	const strides = [64, 68, 48, 52, 64, 68, 48, 52, 48, 52, 56, 68, 72, 52, 56, 0];
	counts.forEach((count, stream) => assert.equal(sections[stream + 1] - sections[stream], count * strides[stream]));
	scene.decorations.forEach(primitive => {
		const uvOffset = primitive.stream < 8 ? 24 : primitive.stream < 11 ? 6 :
			primitive.stream < 13 ? 48 : 32;
		const offset = relativeOffset + sections[primitive.stream] + primitive.sourceIndex * strides[primitive.stream];
		assert.equal(primitive.orderingBias, data.getUint8(offset + uvOffset + 13));
	});
	assert.equal(counts[8], expectedDecorSpriteCounts[course]);
	assert.equal(counts.reduce((sum, count) => sum + count, 0) - counts[8], scene.decorations.length);
	assert.equal(scene.sprites.length, counts[8], `Sprites du circuit ${course + 1}`);
	const surfaces = roadSurfaces(scene.decorations);
	scene.samples.forEach((sample, index) =>
		assert.ok(roadSampleCovered(sample, surfaces, true),
			`Chaussée non visible du dessus circuit ${course + 1}, échantillon ${index}`));
	pathViewer.rr4Fly.samples.forEach((point, index) => {
		if (index % 32 !== 0)
			return;
		assert.ok(roadSampleCovered({ x: point.x, z: -point.z, height: -point.y * 4 }, surfaces, true),
			`Trajectoire lissée hors chaussée circuit ${course + 1}, échantillon ${index}`);
	});
	assert.equal(scene.sky.length, 3);
	assert.ok(scene.sky.every(layer => layer.vertices.length && layer.primitives.length));
	if (course === 1) {
		assert.equal(JSON.stringify(scene.decorations[0].vertices), JSON.stringify([
			[50386, -460, 19190], [50364, -460, 19192],
			[50386, -431, 19190], [50364, -431, 19192]
		]));
		assert.equal(JSON.stringify(scene.decorations[166].window), "[64,32,64,32]");
		const textureResource = context.Rr4Decode.extract(archive, resources, course * 2);
		const vram = context.MapVram.loadRr4(textureResource);
		const pageCache = new Map();
		scene.decorations.slice(0, 179).forEach(quad => {
			const key = `${quad.tpage}:${quad.clut}:${(quad.window || []).join(",")}`;
			if (!pageCache.has(key))
				pageCache.set(key, context.MapVram.page(vram, quad.tpage, quad.clut, quad.window));
			assert.ok(context.MapVram.covered(pageCache.get(key), quad.uvs));
		});
		const triangles = scene.decorations.filter(primitive => primitive.vertices.length === 3);
		assert.equal(JSON.stringify(triangles[0].vertices), "[[49631,-662,19269],[49632,-662,19279],[49628,-657,19274]]");
		assert.equal(JSON.stringify(triangles[0].uvs), "[[248,88],[250,88],[249,94]]");
		assert.equal(JSON.stringify(triangles[0].colors), "[[24,40,56],[24,40,56],[24,40,56]]");
		assert.equal(triangles[0].clut, 0x7d8f);
		assert.equal(triangles[0].tpage, 0x3c);
		assert.equal(triangles[0].window, null);
		assert.equal(JSON.stringify(triangles[405].vertices), "[[50442,-327,20500],[50451,-327,20581],[50456,-327,20579]]");
		assert.equal(JSON.stringify(triangles[405].window), "[192,0,64,64]");
		triangles.forEach(triangle => {
			const key = `${triangle.tpage}:${triangle.clut}:${(triangle.window || []).join(",")}`;
			if (!pageCache.has(key))
				pageCache.set(key, context.MapVram.page(vram, triangle.tpage, triangle.clut, triangle.window));
			assert.ok(context.MapVram.covered(pageCache.get(key), triangle.uvs));
		});
		const quadEdges = new Set();
		scene.decorations.slice(0, expectedGeometryQuads[course]).forEach(quad => {
			[[0, 1], [1, 3], [3, 2], [2, 0]].forEach(([a, b]) =>
				quadEdges.add([quad.vertices[a].join(","), quad.vertices[b].join(",")].sort().join("|")));
		});
		assert.equal(triangles.filter(triangle => [[0, 1], [1, 2], [2, 0]].some(([a, b]) =>
			quadEdges.has([triangle.vertices[a].join(","), triangle.vertices[b].join(",")].sort().join("|")))).length, 513);
	}
	const skyVram = context.MapVram.loadRr4(context.Rr4Decode.extract(archive, resources, course * 2));
	const skyPages = new Map();
	for (let sprite = relativeOffset + sections[8]; sprite < relativeOffset + sections[9]; sprite += 48) {
		for (const offset of [4, 6, 16, 18])
			assert.equal(data.getInt16(sprite + offset, true), 0);
		assert.equal(data.getUint8(sprite + 47), 0x2c);
		const clut = data.getUint16(sprite + 26, true);
		const tpage = data.getUint16(sprite + 30, true);
		const key = `${tpage}:${clut}`;
		if (!skyPages.has(key))
			skyPages.set(key, context.MapVram.page(skyVram, tpage, clut));
		const uvs = [24, 28, 32, 34].map(offset =>
			[data.getUint8(sprite + offset), data.getUint8(sprite + offset + 1)]);
		assert.ok(context.MapVram.covered(skyPages.get(key), uvs),
			`Texture de sprite manquante circuit ${course + 1}`);
	}
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
		const roadEdge = [sample.x + sample.left[0], sample.height / 4, sample.z + sample.left[1]];
		assert.equal(JSON.stringify(roadEdge), "[35064,0,9432]");
		assert.ok(scene.decorations.some(quad => quad.vertices.some(vertex =>
			vertex.every((value, index) => value === roadEdge[index]))),
		"Un sommet de chaussée doit correspondre au repère de la géométrie fixe");
	}
	if (course === 7) {
		assert.deepEqual(counts.slice(11, 15), [315, 262, 220, 102]);
		const sprite = scene.sprites[0];
		assert.equal(JSON.stringify(sprite.position), "[31020,-158,46531]");
		assert.equal(JSON.stringify(sprite.vertices), "[[-294,0,0],[-294,-574,0],[294,0,0],[294,-574,0]]");
		assert.equal(JSON.stringify(sprite.uvs), "[[128,255],[128,192],[191,255],[191,192]]");
		assert.equal(sprite.clut, 0x7cd3);
		assert.equal(sprite.tpage, 0x36);
		const oldSurfaces = roadSurfaces(scene.decorations.slice(0, 5455));
		assert.equal(scene.samples.filter(sample => roadSampleCovered(sample, oldSurfaces)).length, 319);
		assert.equal(roadSampleCovered(scene.samples[325], oldSurfaces), false);
		assert.equal(roadSampleCovered(scene.samples[325], surfaces), true);
		const quad = scene.decorations[5455];
		assert.equal(JSON.stringify(quad.vertices), "[[21303,-65,45194],[20976,-61,45194],[21303,-65,45350],[20976,-60,45350]]");
		assert.equal(JSON.stringify(quad.uvs), "[[0,39],[63,39],[0,32],[63,32]]");
		assert.equal(JSON.stringify(quad.colors), "[[176,168,168],[176,168,168],[176,168,168],[176,168,168]]");
		assert.equal(quad.clut, 0x7c41);
		assert.equal(quad.tpage, 0x2e);
		assert.equal(quad.window, null);
		assert.equal(JSON.stringify(scene.decorations[5455 + 315].window), "[64,192,64,64]");
		assert.equal(JSON.stringify(scene.decorations[5455 + 315 + 262 + 220].window), "[192,0,64,64]");
		const pages = new Map();
		scene.decorations.slice(5455).forEach(primitive => {
			const key = `${primitive.tpage}:${primitive.clut}:${(primitive.window || []).join(",")}`;
			if (!pages.has(key))
				pages.set(key, context.MapVram.page(skyVram, primitive.tpage, primitive.clut, primitive.window));
			assert.ok(context.MapVram.covered(pages.get(key), primitive.uvs));
		});
	}
});

const overlapping = [
	{ vertices: [[0, 0, 0], [10, 0, 0], [0, 0, 10]], orderingBias: 20, stream: 4, sourceIndex: 0 },
	{ vertices: [[0, 0, 0], [10, 0, 0], [0, 0, 10]], orderingBias: 10, stream: 4, sourceIndex: 1 },
	{ vertices: [[0, 0, 0], [10, 0, 0], [0, 0, 10]], orderingBias: 5, stream: 4, sourceIndex: 2 },
	{ vertices: [[10, 0, 0], [10, 0, 10], [0, 0, 10]], orderingBias: 5, stream: 4, sourceIndex: 3 },
	{ vertices: [[0, 0, 0], [0, 0, 10], [10, 0, 0]], orderingBias: 1, stream: 4, sourceIndex: 4 }
];
context.Rr4Decode.assignDepthLayers(overlapping);
assert.deepEqual(overlapping.map(primitive => primitive.depthLayer), [0, 1, 2, 0, 0]);
const equalPriority = [
	{ vertices: overlapping[0].vertices, orderingBias: 5, stream: 5, sourceIndex: 0 },
	{ vertices: overlapping[0].vertices, orderingBias: 5, stream: 4, sourceIndex: 1 },
	{ vertices: overlapping[0].vertices, orderingBias: 5, stream: 4, sourceIndex: 0 }
];
context.Rr4Decode.assignDepthLayers(equalPriority);
assert.deepEqual(equalPriority.map(primitive => primitive.depthLayer), [0, 1, 2]);

// Three.js vérifie instanceof Array, mais le viewer s'exécute dans un autre contexte VM.
const MultiMaterial = context.THREE.MultiMaterial;
context.THREE.MultiMaterial = function(materials) { return new MultiMaterial(Array.from(materials || [])); };
context.THREE.MultiMaterial.prototype = MultiMaterial.prototype;
context.m_buffer = archive;
context.m_rr4Resources = resources;
context.m_sourceType = "";
context.m_object = null;
context.m_triangleObjects = [];
context.m_viewer = {
	renderer: { setClearColor(color) { this.clearColor = color; } },
	scene: { add() {} }, fitToBounds() {}, remove() {},
	setRr4FlyPath: context.Sceneview.prototype.setRr4FlyPath,
	setFlyPath: context.Sceneview.prototype.setFlyPath,
	stopRr4Fly: context.Sceneview.prototype.stopRr4Fly
};
context.document = { getElementById() { return { setAttribute() {} }; } };
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
assert.equal(roadMesh.geometry.vertices[22 * 4].y, 0.25);
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

const ambientInput = html.match(/<input\b[^>]*\bid="rr4AmbientEnabled"[^>]*>/);
assert.ok(ambientInput);
const controls = { renderMode: { value: "textured" }, rr4RenderStatus: {}, rr4RoadVisible: { checked: false },
	rr4Ambient: { value: "#3a6073" }, rr4AmbientEnabled: { checked: /\schecked(?:\s|=|>)/i.test(ambientInput[0]) },
	rr4FlyToggle: { setAttribute() {} } };
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
context.m_rr4RoadOverride = null;
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
assert.equal(context.m_viewer.renderer.clearColor, "#3a6073");
assert.ok(decorMesh.material.materials.every(material => material.vertexColors === context.THREE.VertexColors));
assert.ok(decorMesh.material.materials.every(material => material.side === context.THREE.BackSide));
assert.equal(roadMesh.visible, false);
assert.equal(controls.rr4RoadVisible.checked, false);
const ambientFace = decorMesh.geometry.faces[coloredIndex * 2];
const ambientVertex = ambientFace.a - coloredIndex * 4;
const ambientSource = decorMesh.userData.rr4Primitives[coloredIndex].colors[ambientVertex];
assert.deepEqual([ambientFace.vertexColors[0].r, ambientFace.vertexColors[0].g, ambientFace.vertexColors[0].b],
	Array.from(ambientSource, channel => channel / 128));
controls.rr4AmbientEnabled.checked = true;
context.updateRr4Ambient();
assert.deepEqual([ambientFace.vertexColors[0].r, ambientFace.vertexColors[0].g, ambientFace.vertexColors[0].b],
	Array.from(ambientSource, (channel, index) => Math.min(255, channel + expectedAmbient[0][index]) / 128));
controls.rr4Ambient.value = "#010203";
context.updateRr4Ambient();
assert.equal(context.m_viewer.renderer.clearColor, "#010203");
assert.deepEqual([ambientFace.vertexColors[0].r, ambientFace.vertexColors[0].g, ambientFace.vertexColors[0].b],
	Array.from(ambientSource, (channel, index) => Math.min(255, channel + index + 1) / 128));
controls.rr4AmbientEnabled.checked = false;
context.updateRr4Ambient();
assert.equal(context.m_viewer.renderer.clearColor, "#010203");
assert.deepEqual([ambientFace.vertexColors[0].r, ambientFace.vertexColors[0].g, ambientFace.vertexColors[0].b],
	Array.from(ambientSource, channel => channel / 128));
controls.rr4AmbientEnabled.checked = true;
controls.renderMode.value = "shaded";
context.applyRr4RenderMode();
assert.equal(context.m_viewer.renderer.clearColor, "#010203");
assert.ok(decorMesh.material.materials.every(material => material.vertexColors === context.THREE.VertexColors &&
	material.side === context.THREE.BackSide));
assert.ok(roadMesh.material instanceof context.THREE.MeshBasicMaterial);
assert.equal(roadMesh.visible, true);
assert.equal(controls.rr4RoadVisible.checked, true);
const firstColor = decorMesh.geometry.faces[coloredIndex * 2].vertexColors[0];
const firstVertex = decorMesh.geometry.faces[coloredIndex * 2].a - coloredIndex * 4;
const sourceColor = decorMesh.userData.rr4Primitives[coloredIndex].colors[firstVertex];
const shadedMaterial = decorMesh.material.materials[decorMesh.geometry.faces[coloredIndex * 2].materialIndex];
["r", "g", "b"].forEach((channel, index) => {
	assert.ok(Math.abs(firstColor[channel] * shadedMaterial.color[channel] - sourceColor[index] / 255) < 1e-12);
});
controls.renderMode.value = "wireframe";
context.applyRr4RenderMode();
assert.equal(decorMesh.material.wireframe, true);
assert.equal(roadMesh.visible, true);

controls.rr4Status = {};
controls.rr4AmbientSource = {};
controls.renderMode.value = "textured";
context.loadRr4Sky = function() {};
context.renderRr4Course(1);
const circuit2Decor = context.m_triangleObjects[1];
const primitives = circuit2Decor.userData.rr4Primitives;
const triangleIndex = primitives.findIndex(primitive =>
	JSON.stringify(primitive.vertices[0]) === "[50442,-327,20500]" && primitive.vertices.length === 3);
assert.ok(triangleIndex >= 0);
const vertexBase = primitives.slice(0, triangleIndex).reduce((sum, primitive) => sum + primitive.vertices.length, 0);
const faceIndex = primitives.slice(0, triangleIndex).reduce((sum, primitive) => sum + primitive.vertices.length - 2, 0);
const triangle = primitives[triangleIndex];
const triangleFace = circuit2Decor.geometry.faces[faceIndex];
assert.deepEqual([triangleFace.a, triangleFace.b, triangleFace.c], [vertexBase, vertexBase + 1, vertexBase + 2]);
assert.equal(circuit2Decor.geometry.faces.length, 11130 * 2 + 564);
triangle.vertices.forEach((vertex, corner) => {
	const point = circuit2Decor.geometry.vertices[vertexBase + corner];
	assert.deepEqual([point.x, point.y, point.z], Array.from(context.Rr4Decode.worldVertex(...vertex)));
	const uv = circuit2Decor.geometry.faceVertexUvs[0][faceIndex][corner];
	assert.deepEqual([uv.x, uv.y], Array.from(triangle.uvs[corner], value => (value + 0.5) / 256));
	const color = triangleFace.vertexColors[corner];
	assert.deepEqual([color.r, color.g, color.b], Array.from(triangle.colors[corner],
		(value, channel) => Math.min(255, value + expectedAmbient[1][channel]) / 128));
});
const materialsByKey = new Map();
let currentFace = 0;
primitives.forEach(primitive => {
	const key = `${context.rr4TextureKey(primitive)}:${primitive.depthLayer}`;
	const materialIndex = circuit2Decor.geometry.faces[currentFace].materialIndex;
	if (materialsByKey.has(key))
		assert.equal(materialIndex, materialsByKey.get(key));
	else
		materialsByKey.set(key, materialIndex);
	for (let i = 0; i < primitive.vertices.length - 2; i++)
		assert.equal(circuit2Decor.geometry.faces[currentFace++].materialIndex, materialIndex);
});
assert.equal(new Set(materialsByKey.values()).size, materialsByKey.size);
controls.rr4AmbientEnabled.checked = false;
context.updateRr4Ambient();
assert.deepEqual([triangleFace.vertexColors[0].r, triangleFace.vertexColors[0].g, triangleFace.vertexColors[0].b],
	Array.from(triangle.colors[0], value => value / 128));
controls.renderMode.value = "shaded";
context.applyRr4RenderMode();
assert.ok(circuit2Decor.material.materials.every(material => material.vertexColors === context.THREE.VertexColors));

controls.renderMode.value = "textured";
controls.rr4AmbientEnabled.checked = true;
context.renderRr4Course(7);
assert.equal(context.m_viewer.renderer.clearColor, "#17141d");
const circuit8Road = context.m_triangleObjects[0];
const circuit8Decor = context.m_triangleObjects[1];
const circuit8Sprites = context.m_triangleObjects[2];
assert.equal(circuit8Road.geometry.vertices[0].y, 163.75);
assert.equal(circuit8Road.visible, false);
assert.equal(circuit8Decor.geometry.faces.length, 6354 * 2);
assert.equal(circuit8Sprites.geometry.faces.length, 166 * 2);
assert.equal(context.m_viewer.rr4BillboardMesh, circuit8Sprites);
const spriteIndex = circuit8Sprites.userData.rr4Sprites.findIndex(sprite =>
	JSON.stringify(sprite.position) === "[31020,-158,46531]");
assert.ok(spriteIndex >= 0);
const spriteFace = circuit8Sprites.geometry.faces[spriteIndex * 2];
const spriteMaterial = circuit8Sprites.material.materials[spriteFace.materialIndex];
assert.ok(spriteMaterial.map);
assert.equal(spriteMaterial.alphaTest, 0.5);
assert.equal(spriteMaterial.side, context.THREE.DoubleSide);
assert.equal(spriteMaterial.polygonOffset, false);
const sourceSprite = circuit8Sprites.userData.rr4Sprites[spriteIndex];
[spriteFace.a, spriteFace.b, spriteFace.c].forEach((vertexIndex, corner) => {
	const uv = circuit8Sprites.geometry.faceVertexUvs[0][spriteIndex * 2][corner];
	assert.deepEqual([uv.x, uv.y], Array.from(sourceSprite.uvs[vertexIndex - spriteIndex * 4],
		value => (value + 0.5) / 256));
});
assert.deepEqual([spriteFace.vertexColors[0].r, spriteFace.vertexColors[0].g, spriteFace.vertexColors[0].b],
	expectedAmbient[7].map(value => (127 + value) / 128));
const addedIndex = circuit8Decor.userData.rr4Primitives.findIndex(primitive =>
	JSON.stringify(primitive.vertices[0]) === "[21303,-65,45194]" &&
	JSON.stringify(primitive.uvs[0]) === "[0,39]");
assert.ok(addedIndex >= 0);
const stripeIndex = circuit8Decor.userData.rr4Primitives.findIndex(primitive =>
	primitive.stream === 4 && primitive.sourceIndex === 71);
const groundIndex = circuit8Decor.userData.rr4Primitives.findIndex(primitive =>
	primitive.stream === 5 && primitive.sourceIndex === 37);
const stripe = circuit8Decor.userData.rr4Primitives[stripeIndex];
const ground = circuit8Decor.userData.rr4Primitives[groundIndex];
assert.equal(stripe.orderingBias, 5);
assert.equal(ground.orderingBias, 20);
assert.ok(stripe.depthLayer > ground.depthLayer);
const stripeMaterial = circuit8Decor.material.materials[circuit8Decor.geometry.faces[stripeIndex * 2].materialIndex];
const groundMaterial = circuit8Decor.material.materials[circuit8Decor.geometry.faces[groundIndex * 2].materialIndex];
assert.equal(stripeMaterial.side, context.THREE.BackSide);
assert.equal(stripeMaterial.polygonOffset, true);
assert.equal(stripeMaterial.polygonOffsetUnits, -4 * stripe.depthLayer);
assert.equal(groundMaterial.polygonOffset, false);
const signIndices = [106, 107].map(sourceIndex => circuit8Decor.userData.rr4Primitives.findIndex(primitive =>
	primitive.stream === 5 && primitive.sourceIndex === sourceIndex));
assert.ok(signIndices.every(index => index >= 0));
const signFace = circuit8Decor.geometry.faces[signIndices[0] * 2];
const signCenter = new context.THREE.Vector3().add(circuit8Decor.geometry.vertices[signFace.a])
	.add(circuit8Decor.geometry.vertices[signFace.b]).add(circuit8Decor.geometry.vertices[signFace.c]).divideScalar(3);
circuit8Decor.updateMatrixWorld(true);
const visibleSignSides = [1, -1].map(side => {
	const origin = signCenter.clone().addScaledVector(signFace.normal, side * 10);
	const direction = signFace.normal.clone().multiplyScalar(-side);
	return new context.THREE.Raycaster(origin, direction).intersectObject(circuit8Decor)
		.filter(hit => signIndices.includes(Math.floor(hit.faceIndex / 2)))
		.map(hit => Math.floor(hit.faceIndex / 2));
});
assert.equal(visibleSignSides[0].length, 1);
assert.equal(visibleSignSides[1].length, 1);
assert.notEqual(visibleSignSides[0][0], visibleSignSides[1][0]);
const addedQuad = circuit8Decor.userData.rr4Primitives[addedIndex];
for (let faceNumber = 0; faceNumber < 2; faceNumber++) {
	const index = addedIndex * 2 + faceNumber;
	const face = circuit8Decor.geometry.faces[index];
	[face.a, face.b, face.c].forEach((vertexIndex, corner) => {
		const sourceIndex = vertexIndex - addedIndex * 4;
		const uv = circuit8Decor.geometry.faceVertexUvs[0][index][corner];
		assert.deepEqual([uv.x, uv.y], Array.from(addedQuad.uvs[sourceIndex], value => (value + 0.5) / 256));
		const color = face.vertexColors[corner];
		assert.deepEqual([color.r, color.g, color.b], Array.from(addedQuad.colors[sourceIndex],
			(value, channel) => Math.min(255, value + expectedAmbient[7][channel]) / 128));
	});
	assert.ok(circuit8Decor.material.materials[face.materialIndex],
		`Matériau ${face.materialIndex} absent parmi ${circuit8Decor.material.materials.length}`);
}
controls.renderMode.value = "shaded";
context.applyRr4RenderMode();
assert.equal(circuit8Road.visible, true);
assert.equal(circuit8Sprites.material.vertexColors, context.THREE.VertexColors);
const shadedStripe = circuit8Decor.material.materials[circuit8Decor.geometry.faces[stripeIndex * 2].materialIndex];
assert.equal(shadedStripe.side, context.THREE.BackSide);
assert.equal(shadedStripe.polygonOffsetUnits, -4 * stripe.depthLayer);

const roadMaterial = circuit8Road.material;
controls.rr4RoadVisible.checked = false;
context.updateRr4RoadVisibility();
assert.equal(circuit8Road.visible, false);
assert.equal(circuit8Road.material, roadMaterial);
assert.equal(circuit8Decor.visible, true);
assert.equal(circuit8Sprites.visible, true);
controls.renderMode.value = "textured";
context.applyRr4RenderMode();
assert.equal(circuit8Road.visible, false);
assert.equal(controls.rr4RoadVisible.checked, false);
controls.rr4RoadVisible.checked = true;
context.updateRr4RoadVisibility();
assert.equal(circuit8Road.visible, true);
controls.renderMode.value = "wireframe";
context.applyRr4RenderMode();
assert.equal(circuit8Road.visible, true);
context.renderRr4Course(0);
assert.equal(context.m_triangleObjects[0].visible, true);
assert.equal(controls.rr4RoadVisible.checked, true);

controls.sourceMode = { value: "map" };
context.document.getElementById = id => controls[id] || (controls[id] = {});
context.m_viewer.clearRr4FlyPath = function() { this.rr4Fly = null; };
context.m_sourceType = "rr4";
context.m_sourceRequest = 0;
context.m_textureRequest = 0;
context.m_tmsTexture = null;
context.m_mapTextures = [];
context.m_lastRr4RenderMode = "textured";
context.m_lastGenericRenderMode = "textureSun";
context.m_courses = { map: [["main", "Circuit principal"]], revolution: [["CRS_EASY.DAT", "Easy"]],
	mdl: [["desert", "Desert"]], rr4: [["0", "Circuit 1"]] };
context.disposeRr4Meshes = function() {};
context.loadSelectedCourse = function() {};
context.saveActiveCamera = function() {};
context.m_initialCourse = null;
context.setSelectOptions = function(select, options, value) { select.value = value; };
const sourceModeStart = html.indexOf("function changeSourceMode(");
const sourceModeEnd = html.indexOf("function start(", sourceModeStart);
assert.ok(sourceModeStart >= 0 && sourceModeEnd > sourceModeStart);
vm.runInContext(html.slice(sourceModeStart, sourceModeEnd), context);
controls.renderMode = { value: "wireframe" };
context.changeSourceMode();
assert.equal(context.m_viewer.renderer.clearColor, 0x000000);
assert.equal(controls.renderMode.value, "texture");
controls.renderMode.value = "blocks";
controls.sourceMode.value = "revolution";
context.changeSourceMode();
assert.equal(controls.renderMode.value, "texture");
controls.renderMode.value = "wireframe";
controls.sourceMode.value = "mdl";
context.changeSourceMode();
assert.equal(controls.renderMode.value, "texture");
controls.sourceMode.value = "rr4";
context.changeSourceMode();
assert.equal(controls.renderMode.value, "wireframe");

const brokenCourse = context.Rr4Decode.extract(archive, resources, 1);
const brokenData = new DataView(brokenCourse);
const relativeOffset = brokenData.getUint32(4, true);
brokenData.setUint32(relativeOffset + 0x10 + 5 * 4,
	brokenData.getUint32(relativeOffset + 0x10 + 5 * 4, true) - 1, true);
assert.throws(() => context.Rr4Decode.parseCourse(brokenCourse), /géométrie.*tronqué/);
const brokenTriangles = context.Rr4Decode.extract(archive, resources, 3);
const triangleData = new DataView(brokenTriangles);
const triangleRelativeOffset = triangleData.getUint32(4, true);
const triangleBoundary = triangleRelativeOffset + 0x10 + 10 * 4;
triangleData.setUint32(triangleBoundary, triangleData.getUint32(triangleBoundary, true) - 1, true);
assert.throws(() => context.Rr4Decode.parseCourse(brokenTriangles), /géométrie.*tronqué.*9/);
const brokenWindowedTriangles = context.Rr4Decode.extract(archive, resources, 3);
const windowedTriangleData = new DataView(brokenWindowedTriangles);
const windowedTriangleBase = windowedTriangleData.getUint32(4, true);
for (let section = 11; section <= 15; section++) {
	const boundary = windowedTriangleBase + 0x10 + section * 4;
	windowedTriangleData.setUint32(boundary, windowedTriangleData.getUint32(boundary, true) - 1, true);
}
assert.throws(() => context.Rr4Decode.parseCourse(brokenWindowedTriangles), /géométrie.*tronqué.*10/);
const brokenTriangleWindow = context.Rr4Decode.extract(archive, resources, 3);
const triangleWindowData = new DataView(brokenTriangleWindow);
const triangleWindowBase = triangleWindowData.getUint32(4, true);
const triangleWindowStart = triangleWindowData.getUint32(triangleWindowBase + 0x10 + 10 * 4, true);
triangleWindowData.setUint32(triangleWindowBase + triangleWindowStart + 52, 0, true);
assert.throws(() => context.Rr4Decode.parseCourse(brokenTriangleWindow), /Fenêtre de texture R4 invalide/);
const brokenSprites = context.Rr4Decode.extract(archive, resources, 1);
const spriteData = new DataView(brokenSprites);
const spriteBase = spriteData.getUint32(4, true);
for (let section = 9; section <= 15; section++) {
	const boundary = spriteBase + 0x10 + section * 4;
	spriteData.setUint32(boundary, spriteData.getUint32(boundary, true) - 1, true);
}
assert.throws(() => context.Rr4Decode.parseCourse(brokenSprites), /sprites.*tronqué.*8/);
for (const stream of [11, 12, 13, 14]) {
	const brokenQuad = context.Rr4Decode.extract(archive, resources, 15);
	const quadData = new DataView(brokenQuad);
	const base = quadData.getUint32(4, true);
	const boundary = base + 0x10 + (stream + 1) * 4;
	quadData.setUint32(boundary, quadData.getUint32(boundary, true) - 1, true);
	assert.throws(() => context.Rr4Decode.parseCourse(brokenQuad), /géométrie.*tronqué/);
}
for (const [stream, stride] of [[12, 72], [14, 56]]) {
	const brokenQuadWindow = context.Rr4Decode.extract(archive, resources, 15);
	const quadData = new DataView(brokenQuadWindow);
	const base = quadData.getUint32(4, true);
	const start = quadData.getUint32(base + 0x10 + stream * 4, true);
	quadData.setUint32(base + start + stride - 4, 0, true);
	assert.throws(() => context.Rr4Decode.parseCourse(brokenQuadWindow), /Fenêtre de texture R4 invalide/);
}
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
