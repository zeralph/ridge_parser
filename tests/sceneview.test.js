"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const THREE = require("../js/three.js");

const listeners = {};
const canvas = {
	addEventListener(type, callback) {
		(listeners[type] ||= []).push(callback);
	},
	getBoundingClientRect() {
		return { left: 100, top: 50, width: 400, height: 200 };
	}
};
THREE.WebGLRenderer = function() {
	this.domElement = canvas;
	this.setSize = function() {};
	this.setClearColor = function() {};
};
const context = vm.createContext({
	THREE,
	console,
	window: { addEventListener() {} },
	document: { getElementById() { return { appendChild() {} }; } },
	requestAnimationFrame() {}
});
vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "js", "orbit-controls.js"), "utf8"), context);
vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "Sceneview.js"), "utf8"), context);
const animate = context.Sceneview.prototype.animate;
context.Sceneview.prototype.animate = function() {};
const viewer = new context.Sceneview("container", 400, 200);
assert.equal(listeners.dblclick.length, 1);
viewer.clear();
assert.equal(listeners.dblclick.length, 1, "Le rechargement ne doit pas ajouter de gestionnaire");

viewer.camera.position.set(0, 0, 10);
viewer.camera.near = 1;
viewer.camera.far = 30;
viewer.camera.lookAt(viewer.controls.target);
viewer.camera.updateProjectionMatrix();

function plane(z) {
	const mesh = new THREE.Mesh(
		new THREE.PlaneGeometry(100, 100),
		new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })
	);
	mesh.position.z = z;
	return mesh;
}

const group = new THREE.Object3D();
group.position.x = 2;
const front = plane(0);
const back = plane(-2);
group.add(front);
group.add(back);
viewer.scene.add(group);
const click = (clientX, clientY) => listeners.dblclick[0]({ clientX, clientY });
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-5, `${actual} != ${expected}`);

click(350, 150);
close(viewer.controls.target.x, 5);
close(viewer.controls.target.y, 0);
close(viewer.controls.target.z, 0);
close(viewer.camera.position.x, 5);
close(viewer.camera.position.z, 10);

const target = viewer.controls.target.clone();
const position = viewer.camera.position.clone();
group.visible = false;
click(300, 150);
assert.ok(viewer.controls.target.equals(target), "Le vide ne doit pas déplacer la cible");
assert.ok(viewer.camera.position.equals(position), "Le vide ne doit pas déplacer la caméra");

group.visible = true;
front.material.visible = false;
click(300, 150);
close(viewer.controls.target.z, -2);
close(viewer.camera.position.z, 8);

viewer.camera.far = 1;
const clippedTarget = viewer.controls.target.clone();
click(300, 150);
assert.ok(viewer.controls.target.equals(clippedTarget), "Une surface hors du plan de coupe doit être ignorée");

viewer.camera.far = 30;
viewer.cameraSpline = {};
const flyTarget = viewer.controls.target.clone();
click(300, 150);
assert.ok(viewer.controls.target.equals(flyTarget), "La caméra orbitale ne doit pas bouger en mode vol");

viewer.cameraSpline = null;
viewer.camera.position.set(0, 0, -10);
viewer.controls.target.set(0, 0, 0);
viewer.controls.update();
front.material = new THREE.MultiMaterial([
	new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })
]);
back.visible = false;
click(350, 150);
close(viewer.controls.target.x, -5);
close(viewer.controls.target.z, 0);
close(viewer.camera.position.x, -5);

viewer.camera.position.set(0, 0, -10);
viewer.controls.target.set(0, 0, 0);
viewer.controls.update();
front.material.materials[0].side = THREE.FrontSide;
click(350, 150);
assert.ok(viewer.controls.target.equals(new THREE.Vector3()), "Une face arrière non affichée doit être ignorée");

const skyGeometry = new THREE.PlaneGeometry(1, 1);
const skyTexture = new THREE.Texture();
const skyMaterial = new THREE.MeshBasicMaterial({ map: skyTexture });
const skyScene = new THREE.Scene();
skyScene.add(new THREE.Mesh(skyGeometry, skyMaterial));
skyScene.add(new THREE.Mesh(skyGeometry, skyMaterial));
const disposed = { geometry: 0, texture: 0, material: 0 };
skyGeometry.addEventListener("dispose", () => disposed.geometry++);
skyTexture.addEventListener("dispose", () => disposed.texture++);
skyMaterial.addEventListener("dispose", () => disposed.material++);
viewer.setSkyScene(skyScene);
viewer.clearSky();
assert.deepEqual(disposed, { geometry: 1, texture: 1, material: 1 });
assert.equal(viewer.skyScene, null);

const billboardGeometry = new THREE.Geometry();
for (let i = 0; i < 4; i++)
	billboardGeometry.vertices.push(new THREE.Vector3());
const billboard = new THREE.Mesh(billboardGeometry, new THREE.MeshBasicMaterial());
billboard.userData.rr4Sprites = [{
	position: [100, -20, 200],
	vertices: [[-40, 0, 0], [-40, -80, 0], [40, 0, 0], [40, -80, 0]]
}];
viewer.rr4BillboardMesh = billboard;
viewer.camera.position.set(100, 40, -100);
viewer.camera.lookAt(new THREE.Vector3(100, 40, -200));
viewer.renderer.render = function() {
	assert.deepEqual(billboardGeometry.vertices[0].toArray(), [90, 20, -200]);
};
viewer.renderScene(viewer.camera);
assert.deepEqual(billboardGeometry.vertices[0].toArray(), [90, 20, -200]);
assert.deepEqual(billboardGeometry.vertices[1].toArray(), [90, 40, -200]);
viewer.camera.lookAt(new THREE.Vector3(200, 80, -100));
viewer.updateRr4Billboards(viewer.camera);
close(billboardGeometry.vertices[0].x, 100);
close(billboardGeometry.vertices[0].z, -210);
close(billboardGeometry.vertices[1].y, 40);
viewer.camera.position.set(100, 200, -200);
viewer.camera.lookAt(new THREE.Vector3(100, 0, -200));
viewer.updateRr4Billboards(viewer.camera);
assert.ok(billboardGeometry.vertices.every(vertex =>
	[vertex.x, vertex.y, vertex.z].every(Number.isFinite)));
viewer.clear();
assert.equal(viewer.rr4BillboardMesh, null);

const roadSample = (x, z, height = -80) => ({
	x, z, height, left: [-20, 0], right: [20, 0]
});
const road = [roadSample(0, 0), roadSample(2000, 0), roadSample(2000, 2000),
	roadSample(0, 2000, -480)];
viewer.setRr4FlyPath([road[0], road[0], ...road.slice(1), road[0]]);
assert.equal(viewer.rr4Fly.points.length, 4, "Les points consécutifs ou de fermeture identiques sont ignorés");
const length = viewer.rr4Fly.length;
const orbitNear = viewer.camera.near;
const orbitFar = viewer.camera.far;
viewer.camera.position.set(0, 120, 0);
viewer.startRr4Fly(100, 100, "normal");
assert.equal(viewer.controls.enabled, false);
assert.equal(viewer.viewMode, "rr4-fly");
close(viewer.camera.position.x, 0);
close(viewer.camera.position.y, 120);
close(viewer.camera.position.z, 0);
viewer.advanceRr4Fly(1000);
viewer.advanceRr4Fly(1500);
viewer.advanceRr4Fly(2000);
close(viewer.rr4Fly.distance, length - 100);
const expected = viewer.rr4FlyPoint(length - 100);
close(viewer.camera.position.x, expected.x);
close(viewer.camera.position.y, expected.y + 100);
close(viewer.camera.position.z, expected.z);
assert.ok(viewer.camera.position.y > 120, "La hauteur suit la pente interpolée");
const beforeChange = viewer.camera.position.clone();
viewer.configureRr4Fly(100, 200, "inverse");
close(viewer.camera.position.x, beforeChange.x);
close(viewer.camera.position.z, beforeChange.z);
close(viewer.camera.position.y, beforeChange.y + 100);
viewer.advanceRr4Fly(3000);
close(viewer.rr4Fly.distance, 0);
viewer.advanceRr4Fly(85000);
close(viewer.rr4Fly.distance, 8200 % length);
const beforeClick = viewer.camera.position.clone();
click(300, 150);
assert.ok(viewer.camera.position.equals(beforeClick), "Le double-clic est désactivé pendant le parcours");
viewer.stopRr4Fly();
assert.equal(viewer.controls.enabled, true);
assert.equal(viewer.viewMode, "orbit");
assert.equal(viewer.camera.near, orbitNear);
assert.equal(viewer.camera.far, orbitFar);
assert.ok(viewer.controls.target.equals(viewer.rr4Fly.target));

const pausedPosition = viewer.camera.position.clone();
const pausedDistance = viewer.rr4Fly.distance;
viewer.startRr4Fly(100, 200, "inverse");
close(viewer.camera.position.x, pausedPosition.x);
close(viewer.camera.position.y, pausedPosition.y);
close(viewer.camera.position.z, pausedPosition.z);
close(viewer.rr4Fly.distance, pausedDistance);
viewer.stopRr4Fly();
viewer.camera.position.set(0, 120, 0);
viewer.startRr4Fly(100, 100, "inverse");
viewer.advanceRr4Fly(1000);
viewer.advanceRr4Fly(6000);
close(viewer.camera.position.x, viewer.rr4FlyPoint(500).x);
assert.ok(viewer.camera.getWorldDirection().x > 0, "La caméra regarde dans le sens du mouvement");
const beforeReverse = viewer.camera.position.clone();
viewer.configureRr4Fly(100, 100, "normal");
assert.ok(viewer.camera.position.equals(beforeReverse));
assert.ok(viewer.camera.getWorldDirection().x < 0, "L'inversion change le sens du regard sans déplacer la caméra");
viewer.setRr4FlyPath(road);
assert.equal(viewer.controls.enabled, true, "Changer de circuit réactive la caméra orbitale");
assert.equal(viewer.rr4Fly.active, false);
assert.throws(() => viewer.setRr4FlyPath([road[0], road[0]]), /points distincts/);
assert.throws(() => viewer.setRr4FlyPath([road[0], { x: NaN }]), /invalide/);
assert.throws(() => viewer.startRr4Fly(-1, 100, "normal"), /invalides/);
viewer.startRr4Fly(0, 100, "normal");
viewer.clearRr4FlyPath();
assert.equal(viewer.controls.enabled, true);
assert.equal(viewer.rr4Fly, null);

viewer.setRr4FlyPath(road);
viewer.camera.position.set(750, 999, 300);
viewer.startRr4Fly(100, 100, "inverse");
const nearest = viewer.rr4FlyPoint(viewer.rr4Fly.distance);
assert.ok(Math.hypot(nearest.x - 750, nearest.z - 300) < 300);
for (const offset of [-1, 1]) {
	const nearby = viewer.rr4FlyPoint(viewer.rr4Fly.distance + offset);
	assert.ok(Math.hypot(nearest.x - 750, nearest.z - 300) <= Math.hypot(nearby.x - 750, nearby.z - 300));
}
close(viewer.camera.position.y, nearest.y + 100);
viewer.stopRr4Fly();
viewer.camera.position.set(100, 145, -500);
viewer.startRr4Fly(100, 100, "normal");
const nearestSlope = viewer.rr4FlyPoint(viewer.rr4Fly.distance);
for (const offset of [-1, 1]) {
	const nearby = viewer.rr4FlyPoint(viewer.rr4Fly.distance + offset);
	assert.ok(Math.hypot(nearestSlope.x - 100, nearestSlope.z + 500) <= Math.hypot(nearby.x - 100, nearby.z + 500));
}
close(viewer.camera.position.y, nearestSlope.y + 100);
viewer.stopRr4Fly();

const crossing = [
	roadSample(-1000, -1000, 0), roadSample(1000, 1000, 0),
	roadSample(-1000, 1000, -1600), roadSample(1000, -1000, -1600)
];
viewer.setRr4FlyPath(crossing);
viewer.camera.position.set(0, 500, 0);
viewer.startRr4Fly(100, 100, "normal");
assert.ok(viewer.camera.position.y > 300, "Le pont supérieur reste privilégié au croisement");
viewer.stopRr4Fly();

viewer.setRr4FlyPath([roadSample(0, 0, 0), roadSample(0, 0, -4000)]);
viewer.camera.position.set(0, 650, 0);
viewer.startRr4Fly(100, 100, "normal");
close(viewer.camera.position.y, 650);
viewer.stopRr4Fly();

viewer.setRr4FlyPath(road);
viewer.camera.position.set(0, 120, 0);
viewer.startRr4Fly(100, 100, "inverse");
let now = 1000;
let renderedCamera;
context.Date = { now: () => now };
viewer.renderer.render = (scene, camera) => { renderedCamera = camera; };
animate.call(viewer);
now = 2000;
animate.call(viewer);
assert.equal(renderedCamera, viewer.camera);
close(viewer.rr4Fly.distance, 100);
context.document.hidden = true;
now = 12000;
animate.call(viewer);
context.document.hidden = false;
now = 13000;
animate.call(viewer);
close(viewer.rr4Fly.distance, 100, "La caméra ne doit pas avancer pendant que la page est masquée");
now = 14000;
animate.call(viewer);
close(viewer.rr4Fly.distance, 200);

viewer.setFlyPath([[0, 0, 0], [2000, 0, 0], [2000, 100, 2000], [0, 100, 2000]], 1);
for (const index of [0, 64, 128, 192]) {
	const distance = viewer.rr4Fly.sampleDistances[index];
	const previous = viewer.rr4FlyPoint(distance - 1);
	const corner = viewer.rr4FlyPoint(distance);
	const next = viewer.rr4FlyPoint(distance + 1);
	assert.ok(corner.clone().sub(previous).normalize().dot(next.clone().sub(corner).normalize()) > 0.999,
		"La trajectoire doit tourner progressivement, y compris à la fermeture de la boucle");
}
for (let distance = 0; distance < viewer.rr4Fly.length; distance += 200) {
	const travelled = viewer.rr4FlyPoint(distance).distanceTo(viewer.rr4FlyPoint(distance + 20));
	assert.ok(Math.abs(travelled - 20) < 0.2, "La vitesse doit rester approximativement constante");
}
viewer.camera.position.set(500, 100, 20);
viewer.startRr4Fly(100, 100, "normal");
assert.ok(viewer.camera.getWorldDirection().x > 0);
const initialDistance = viewer.rr4Fly.distance;
viewer.advanceRr4Fly(1000);
viewer.advanceRr4Fly(2000);
close(viewer.rr4Fly.distance, initialDistance + 100);
viewer.configureRr4Fly(100, 100, "inverse");
assert.ok(viewer.camera.getWorldDirection().x < 0);
viewer.advanceRr4Fly(3000);
close(viewer.rr4Fly.distance, initialDistance);
viewer.clearRr4FlyPath();
assert.equal(viewer.controls.enabled, true);
assert.throws(() => viewer.setFlyPath([[0, 0, 0], [NaN, 0, 0]], 1), /invalide/);
assert.throws(() => viewer.setFlyPath([[0, 0, 0], [1, 0, 0]], 0), /invalide/);

console.log("Recentrage et caméra fly-through vérifiés.");
