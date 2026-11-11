"use strict";

var m_mapBanksPromise = null;
var m_buildingsPromise = null;

function renderMapSectors(sectors, includeBuildings) {
	var group = new THREE.Object3D();
	var minimum = new THREE.Vector3(Infinity, Infinity, Infinity);
	var maximum = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
	var meshes = [];
	var primitiveCount = 0;
	sectors.forEach(function(sector) {
		if (!sector.primitives.length)
			return;
		var geometry = new THREE.Geometry();
		sector.primitives.forEach(function(primitive) {
			var base = geometry.vertices.length;
			primitive.vertices.forEach(function(point) {
				var world = MapDecode.worldVertex(sector.origin, point);
				var vertex = new THREE.Vector3(world[0], world[1], world[2]);
				geometry.vertices.push(vertex);
				minimum.min(vertex);
				maximum.max(vertex);
			});
			geometry.faces.push(new THREE.Face3(base, base + 1, base + 2));
			geometry.faces.push(new THREE.Face3(base + 2, base + 1, base + 3));
		});
		geometry.computeFaceNormals();
		geometry.computeVertexNormals();
		geometry.computeBoundingSphere();
		var color = new THREE.Color();
		color.setHSL((sector.id * 0.61803398875) % 1, 0.72, 0.56);
		var mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: color, side: THREE.DoubleSide }));
		mesh.userData.blockColor = color;
		mesh.userData.primitives = sector.primitives;
		meshes.push(mesh);
		group.add(mesh);
		primitiveCount += sector.primitives.length;
	});
	if (!primitiveCount)
		throw new Error("Aucune primitive dans les blocs sélectionnés.");
	group.userData.minimum = minimum;
	group.userData.maximum = maximum;
	group.userData.summary = "MAP.RRM + IDX.HED · " + (sectors.length === 1 ? "section " + sectors[0].id : sectors.length + " sections placées") + " · " + primitiveCount + " primitives · " + primitiveCount * 2 + " faces · placement expérimental";
	if (m_object)
		m_viewer.remove(m_object);
	m_object = group;
	m_triangleObjects = meshes;
	m_viewer.scene.add(group);
	m_viewer.fitToBounds(minimum, maximum);
	applyRenderMode();
	loadMapSky(group);
	document.getElementById("buildingStatus").textContent = includeBuildings ? "Chargement des immeubles OBJ.RRO..." : "Immeubles affichés avec le circuit complet uniquement.";
	if (includeBuildings)
		loadMapBuildings(group);
}

function loadMapSelection(single) {
	try {
		if (!m_mapSectors)
			throw new Error("Charge d'abord un fichier MAP.RRM.");
		if (!single) {
			renderMapSectors(m_mapSectors, true);
			return;
		}
		var id = Number(document.getElementById("objectId").value);
		if (!Number.isInteger(id) || id < 0 || id >= m_mapSectors.length)
			throw new Error("L'indice du bloc doit être compris entre 0 et " + (m_mapSectors.length - 1) + ".");
		renderMapSectors([m_mapSectors[id]]);
	} catch (error) {
		setStatus(error.message, true);
	}
}

function loadMapBanks() {
	if (!m_mapBanksPromise) {
		m_mapBanksPromise = Promise.all(MapVram.mapBanks.map(async function(name) {
			var response = await fetch("ridge_racer/" + name);
			if (!response.ok)
				throw new Error("Impossible de charger " + name + " (HTTP " + response.status + ").");
			var buffer = await response.arrayBuffer();
			return { name: name, buffer: buffer };
		})).then(function(banks) {
			var map = MapVram.create();
			var objects = MapVram.create();
			var sky = MapVram.create();
			banks.forEach(function(bank) {
				MapVram.loadTms(map, bank.buffer, bank.name);
				if (MapVram.objectBanks.indexOf(bank.name) !== -1)
					MapVram.loadTms(objects, bank.buffer, bank.name);
				if (bank.name === "TEX0.TMS")
					MapVram.loadTms(sky, bank.buffer, bank.name);
			});
			return { map: map, objects: objects, scenery: map, sky: sky };
		}).catch(function(error) {
			m_mapBanksPromise = null;
			throw error;
		});
	}
	return m_mapBanksPromise;
}

async function loadMapSky(group) {
	document.getElementById("skyStatus").textContent = "Chargement du ciel TEX0.TMS...";
	try {
		var vrams = await loadMapBanks();
		if (m_object !== group || m_sourceType !== "map")
			return;
		if (!m_viewer.skyScene)
			m_viewer.setSky(MapVram.sky(vrams.sky));
		document.getElementById("skyStatus").textContent = "Ciel TEX0.TMS · panorama expérimental";
	} catch (error) {
		if (m_object === group && m_sourceType === "map")
			document.getElementById("skyStatus").textContent = "Ciel non chargé : " + error.message;
	}
}

function loadBuildingData() {
	if (!m_buildingsPromise) {
		m_buildingsPromise = Promise.all(["OBJ.RRO", "SCUS-943.00"].map(async function(name) {
			var response = await fetch("ridge_racer/" + name);
			if (!response.ok)
				throw new Error("Impossible de charger " + name + " (HTTP " + response.status + ").");
			return response.arrayBuffer();
		})).then(async function(buffers) {
			if (!window.crypto || !window.crypto.subtle)
				throw new Error("Vérification de l'exécutable indisponible : utilise un serveur local sécurisé.");
			var digest = await window.crypto.subtle.digest("SHA-256", buffers[1]);
			var hash = Array.from(new Uint8Array(digest), function(byte) { return byte.toString(16).padStart(2, "0"); }).join("");
			if (hash !== ObjDecode.executableHash)
				throw new Error("Version de SCUS-943.00 non reconnue : placement des immeubles désactivé.");
			return ObjDecode.parseBuildings(buffers[1], ObjDecode.parseModels(buffers[0]));
		}).catch(function(error) {
			m_buildingsPromise = null;
			throw error;
		});
	}
	return m_buildingsPromise;
}

async function loadMapBuildings(group) {
	try {
		var buildings = await loadBuildingData();
		if (m_object !== group || m_sourceType !== "map")
			return;
		var primitiveCount = 0;
		buildings.forEach(function(building) {
			var geometry = new THREE.Geometry();
			building.model.primitives.forEach(function(primitive) {
				var base = geometry.vertices.length;
				primitive.vertices.forEach(function(point) {
					var world = ObjDecode.worldVertex(building, point);
					geometry.vertices.push(new THREE.Vector3(world[0], world[1], world[2]));
				});
				geometry.faces.push(new THREE.Face3(base, base + 1, base + 2));
				geometry.faces.push(new THREE.Face3(base + 2, base + 1, base + 3));
			});
			geometry.computeFaceNormals();
			geometry.computeVertexNormals();
			geometry.computeBoundingSphere();
			var color = new THREE.Color(0xc8ccce);
			var mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: color, side: THREE.DoubleSide }));
			mesh.userData.blockColor = color;
			mesh.userData.primitives = building.model.primitives;
			mesh.userData.textureBank = building.textureBank;
			mesh.userData.objectId = building.model.id;
			group.add(mesh);
			m_triangleObjects.push(mesh);
			primitiveCount += building.model.primitives.length;
		});
		document.getElementById("buildingStatus").textContent = buildings.length + " éléments de décor placés depuis SCUS-943.00 · " + primitiveCount + " primitives · fenêtres de texture PS1 expérimentales.";
		applyRenderMode();
	} catch (error) {
		if (m_object === group && m_sourceType === "map")
			document.getElementById("buildingStatus").textContent = "Immeubles non chargés : " + error.message;
	}
}

async function applyMapTextures(request) {
	var createdTextures = [];
	try {
		if (!m_triangleObjects.length)
			throw new Error("Charge d'abord une carte MAP.RRM.");
		document.getElementById("textureStatus").textContent = "Chargement des banques TMS...";
		var vrams = await loadMapBanks();
		if (request !== m_textureRequest)
			return;
		var pageCache = new Map();
		var Material = document.getElementById("renderMode").value === "textureSun" ? THREE.MeshLambertMaterial : THREE.MeshBasicMaterial;
		var matched = 0, missing = 0, objectMatched = 0, objectMissing = 0;
		var prepared = m_triangleObjects.map(function(mesh) {
			var materials = [];
			var materialIndices = new Map();
			var faceUvs = [];
			var faceMaterials = [];
			mesh.userData.primitives.forEach(function(primitive) {
				var bank = mesh.userData.textureBank || "map";
				var key = bank + ":" + primitive.tpage + ":" + primitive.clut + ":" + (primitive.window || []).join(",");
				if (!pageCache.has(key)) {
					var page = MapVram.page(vrams[bank], primitive.tpage, primitive.clut, primitive.window);
					var texture = new THREE.DataTexture(page.pixels, 256, 256, THREE.RGBAFormat, THREE.UnsignedByteType);
					texture.wrapS = THREE.ClampToEdgeWrapping;
					texture.wrapT = THREE.ClampToEdgeWrapping;
					texture.magFilter = THREE.NearestFilter;
					texture.minFilter = THREE.NearestFilter;
					texture.generateMipmaps = false;
					texture.flipY = false;
					texture.needsUpdate = true;
					page.texture = texture;
					pageCache.set(key, page);
					createdTextures.push(texture);
				}
				var currentPage = pageCache.get(key);
				if (!materialIndices.has(key)) {
					materialIndices.set(key, materials.length);
					materials.push(new Material({
						map: currentPage.texture, color: 0xffffff,
						side: THREE.DoubleSide, transparent: true, alphaTest: 0.5
					}));
				}
				var materialIndex = materialIndices.get(key);
				var uvs = primitive.uvs.map(function(uv) {
					return [(uv[0] + 0.5) / 256, (uv[1] + 0.5) / 256];
				});
				if (MapVram.covered(currentPage, primitive.uvs)) {
					if (bank !== "map") objectMatched++;
					else matched++;
				} else {
					if (bank !== "map") objectMissing++;
					else missing++;
				}
				[[0, 1, 2], [2, 1, 3]].forEach(function(indices) {
					faceUvs.push(indices.map(function(index) { return new THREE.Vector2(uvs[index][0], uvs[index][1]); }));
					faceMaterials.push(materialIndex);
				});
			});
			return { mesh: mesh, materials: materials, uvs: faceUvs, faceMaterials: faceMaterials };
		});
		prepared.forEach(function(item) {
			var geometry = item.mesh.geometry;
			geometry.faceVertexUvs[0] = item.uvs;
			geometry.faces.forEach(function(face, index) { face.materialIndex = item.faceMaterials[index]; });
			geometry.uvsNeedUpdate = true;
			geometry.groupsNeedUpdate = true;
			geometry.__directGeometry = undefined;
			disposeMeshMaterial(item.mesh.material);
			item.mesh.material = new THREE.MultiMaterial(item.materials);
		});
		m_mapTextures.forEach(function(texture) { texture.dispose(); });
		m_mapTextures = createdTextures;
		if (m_tmsTexture) {
			m_tmsTexture.dispose();
			m_tmsTexture = null;
		}
		var message = matched + " primitives MAP couvertes · " + missing + " incomplètes";
		if (objectMatched + objectMissing)
			message += " · décor OBJ : " + objectMatched + " couvertes, " + objectMissing + " incomplètes";
		message += " · magenta : données VRAM absentes · banques séparées circuit / immeubles";
		document.getElementById("textureStatus").textContent = message;
		setStatus(m_object.userData.summary + " · " + message, false);
	} catch (error) {
		createdTextures.forEach(function(texture) { texture.dispose(); });
		if (request === m_textureRequest) {
			document.getElementById("textureStatus").textContent = error.message;
			setStatus(error.message, true);
		}
	}
}
