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

console.log("Recentrage de la caméra vérifié.");
