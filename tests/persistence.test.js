"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const THREE = require("../js/three.js");

const cookies = new Map();
const status = { textContent: "" };
let blocked = false;
const document = {
	get cookie() {
		if (blocked)
			throw new Error("accès refusé");
		return Array.from(cookies, ([name, value]) => `${name}=${value}`).join("; ");
	},
	set cookie(value) {
		if (blocked)
			throw new Error("accès refusé");
		const pair = value.split(";")[0];
		const separator = pair.indexOf("=");
		cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
	},
	getElementById() { return status; }
};
const camera = new THREE.PerspectiveCamera(90, 1, 0.1, 100000);
const viewer = {
	camera,
	controls: {
		target: new THREE.Vector3(),
		update() {
			camera.lookAt(this.target);
			context.scheduleCameraSave();
		}
	},
	rr4Fly: null
};
const context = vm.createContext({
	document, m_viewer: viewer, m_activeCourse: null, m_cameraSuspended: false,
	m_courses: { rr4: [["0"], ["1"]], map: [["main"]] },
	clearTimeout, setTimeout
});
const html = fs.readFileSync("index.html", "utf8");
const start = html.indexOf("function persistenceWarning(");
const end = html.indexOf("function setSelectOptions(", start);
assert.ok(start >= 0 && end > start);
vm.runInContext(html.slice(start, end), context);

function frame(position, target, near = 0.5, far = 9000) {
	camera.position.fromArray(position);
	viewer.controls.target.fromArray(target);
	camera.near = near;
	camera.far = far;
}
function saved(name) {
	return JSON.parse(decodeURIComponent(cookies.get(name)));
}
function render(position) {
	return () => {
		frame(position, [0, 0, 0]);
		viewer.controls.update();
		return true;
	};
}

assert.equal(context.readStoredSelection(), null);
assert.equal(context.showCourse("rr4", "0", render([10, 20, 30])), true);
frame([1, 2, 3], [4, 5, 6], 0.2, 2000);
assert.equal(context.showCourse("rr4", "1", render([100, 200, 300])), true);
assert.deepEqual(saved("ridge_view_camera_rr4_0").position, [1, 2, 3]);
frame([11, 12, 13], [14, 15, 16], 0.3, 3000);
assert.equal(context.showCourse("map", "main", render([500, 600, 700])), true);
frame([21, 22, 23], [24, 25, 26]);
assert.equal(context.showCourse("rr4", "0", render([999, 999, 999])), true);
assert.ok(camera.position.distanceTo(new THREE.Vector3(1, 2, 3)) < 1e-8);
assert.ok(viewer.controls.target.equals(new THREE.Vector3(4, 5, 6)));
assert.equal(camera.near, 0.2);
assert.equal(camera.far, 2000);
assert.equal(context.m_cameraSaveTimer, undefined, "Le cadrage ne doit pas programmer de sauvegarde");
assert.equal(context.readStoredSelection().course, "0");
assert.equal(context.showCourse("rr4", "1", render([999, 999, 999])), true);
assert.ok(camera.position.distanceTo(new THREE.Vector3(11, 12, 13)) < 1e-8);
assert.equal(context.showCourse("map", "main", render([999, 999, 999])), true);
assert.ok(camera.position.distanceTo(new THREE.Vector3(21, 22, 23)) < 1e-8);

frame([30, 40, 50], [1, 2, 3], 1, 4000);
viewer.rr4Fly = { active: true, target: new THREE.Vector3(31, 41, 51) };
context.saveActiveCamera();
assert.deepEqual(saved("ridge_view_camera_map_main").target, [31, 41, 51]);
viewer.controls.target.copy(viewer.rr4Fly.target);
viewer.rr4Fly = null;
assert.equal(context.showCourse("rr4", "0", render([1, 1, 1])), true);
assert.equal(context.showCourse("map", "main", render([1, 1, 1])), true);
assert.ok(viewer.controls.target.equals(new THREE.Vector3(31, 41, 51)));
assert.equal(viewer.viewMode, "orbit");

const selection = cookies.get("ridge_view_selection");
assert.equal(context.showCourse("rr4", "1", () => false), false);
assert.equal(cookies.get("ridge_view_selection"), selection, "Un échec ne doit pas changer la sélection");
cookies.set("ridge_view_selection", encodeURIComponent(JSON.stringify({ mode: "__proto__", course: "0" })));
assert.equal(context.readStoredSelection(), null);
assert.match(status.textContent, /invalide/);
cookies.set("ridge_view_camera_rr4_0", "%broken");
status.textContent = "";
context.showCourse("rr4", "0", render([99, 99, 99]));
assert.match(status.textContent, /Impossible de lire/);
assert.ok(camera.position.distanceTo(new THREE.Vector3(99, 99, 99)) < 1e-8);
cookies.set("ridge_view_camera_rr4_0", encodeURIComponent(JSON.stringify({
	position: [1, 2, 3], target: [1, 2, 3], near: -1, far: 100
})));
status.textContent = "";
context.restoreCamera("rr4", "0");
assert.match(status.textContent, /invalide/);
cookies.set("ridge_view_camera_rr4_0", encodeURIComponent(JSON.stringify({
	position: [1e308, 1, 1], target: [0, 0, 0], near: 1, far: 100
})));
status.textContent = "";
context.restoreCamera("rr4", "0");
assert.match(status.textContent, /invalide/);
blocked = true;
status.textContent = "";
context.saveActiveCamera();
assert.match(status.textContent, /Impossible d'enregistrer/);
status.textContent = "";
assert.equal(context.readStoredSelection(), null);
assert.match(status.textContent, /Impossible de lire/);

console.log("Persistance de la sélection et des caméras : OK");
