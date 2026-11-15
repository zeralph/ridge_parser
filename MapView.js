"use strict";

var m_mapBanksPromise = null;
var m_revolutionReferencesPromise = null;
var m_buildingsPromise = null;
var m_mapExecutablePromise = null;

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
	var revolution = m_sourceType === "revolution";
	group.userData.summary = (revolution ? "Ridge Racer Revolution" : "MAP.RRM + IDX.HED") + " · " +
		(sectors.length === 1 ? "section " + sectors[0].id : sectors.length + " sections placées") +
		" · " + primitiveCount + " quads · " + primitiveCount * 2 + " faces · placement expérimental";
	m_viewer.clearRr4FlyPath();
	syncRr4FlyButton();
	if (m_object)
		m_viewer.remove(m_object);
	m_object = group;
	m_triangleObjects = meshes;
	var revolutionPrimitives = revolution && includeBuildings ? appendMapBuildings(group, m_revolutionBuildings) : 0;
	m_viewer.scene.add(group);
	m_viewer.fitToBounds(minimum, maximum);
	applyRenderMode();
	if (revolution) {
		try {
			m_viewer.clearSky();
			m_viewer.setSky(MapVram.sky(m_revolutionVram.map, 0x7b85, [104, 168, 224]));
			document.getElementById("skyStatus").textContent = "Ciel du circuit · fond bleu et projection approximatifs.";
		} catch (error) {
			document.getElementById("skyStatus").textContent = "Ciel non chargé : " + error.message;
		}
		document.getElementById("buildingStatus").textContent = includeBuildings ?
			m_revolutionBuildings.length + " éléments de décor · " + revolutionPrimitives +
			" quads · variantes et primitives supplémentaires non décodées." :
			"Décors affichés avec le circuit complet uniquement.";
		if (includeBuildings) {
			try {
				var track = RevolutionDecode.parseTrack(m_buffer);
				m_viewer.setFlyPath(track, 1);
				syncRr4FlyButton();
				document.getElementById("flyStatus").textContent = "Tracé natif du circuit · " + track.length + " points.";
			} catch (error) {
				document.getElementById("flyStatus").textContent = "Fly-through indisponible : " + error.message;
			}
		} else {
			document.getElementById("flyStatus").textContent = "Le fly-through nécessite le circuit complet.";
		}
		return;
	}
	loadMapSky(group);
	document.getElementById("buildingStatus").textContent = includeBuildings ? "Chargement des immeubles OBJ.RRO..." : "Immeubles affichés avec le circuit complet uniquement.";
	if (includeBuildings) {
		document.getElementById("flyStatus").textContent = "Chargement du tracé du circuit...";
		loadMapBuildings(group);
		loadMapFlyPath(group, m_buffer, m_mapIndexBuffer);
	} else {
		document.getElementById("flyStatus").textContent = "Le fly-through nécessite le circuit complet.";
	}
}

function loadMapSelection() {
	try {
		if (!m_mapSectors)
			throw new Error("Charge d'abord un circuit Ridge Racer.");
		renderMapSectors(m_mapSectors, true);
		return true;
	} catch (error) {
		setStatus(error.message, true);
		return false;
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

function loadRevolutionReferences() {
	if (!m_revolutionReferencesPromise) {
		m_revolutionReferencesPromise = Promise.all(["BIG0.TMS", "BIG1.TMS", "BIG2.TMS", "BIG3.TMS", "BIG4.TMS"].map(async function(name) {
			var response = await fetch("ridge_racer_revolution/" + name);
			if (!response.ok)
				throw new Error("Impossible de charger " + name + " (HTTP " + response.status + ").");
			return { name: name, buffer: await response.arrayBuffer() };
		})).then(function(banks) {
			return MapVram.revolutionReferences(banks);
		}).catch(function(error) {
			m_revolutionReferencesPromise = null;
			throw error;
		});
	}
	return m_revolutionReferencesPromise;
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

async function mapHash(buffer) {
	if (!window.crypto || !window.crypto.subtle)
		throw new Error("Vérification des fichiers indisponible : utilise un serveur local sécurisé.");
	var digest = await window.crypto.subtle.digest("SHA-256", buffer);
	return Array.from(new Uint8Array(digest), function(byte) { return byte.toString(16).padStart(2, "0"); }).join("");
}

function loadMapExecutable() {
	if (!m_mapExecutablePromise) {
		m_mapExecutablePromise = fetch("ridge_racer/SCUS-943.00").then(async function(response) {
			if (!response.ok)
				throw new Error("Impossible de charger SCUS-943.00 (HTTP " + response.status + ").");
			var buffer = await response.arrayBuffer();
			if (await mapHash(buffer) !== ObjDecode.executableHash)
				throw new Error("Version de SCUS-943.00 non reconnue.");
			return buffer;
		}).catch(function(error) {
			m_mapExecutablePromise = null;
			throw error;
		});
	}
	return m_mapExecutablePromise;
}

async function loadMapFlyPath(group, mapBuffer, indexBuffer) {
	try {
		var values = await Promise.all([loadMapExecutable(), mapHash(mapBuffer), mapHash(indexBuffer)]);
		if (m_object !== group || m_sourceType !== "map")
			return;
		if (values[1] !== MapDecode.trackMapHash || values[2] !== MapDecode.trackIndexHash)
			throw new Error("Version de MAP.RRM ou IDX.HED non reconnue pour ce tracé.");
		m_viewer.setFlyPath(MapDecode.parseTrack(values[0]), 1);
		syncRr4FlyButton();
		document.getElementById("flyStatus").textContent = "Tracé natif du circuit principal · 256 points.";
	} catch (error) {
		if (m_object === group && m_sourceType === "map")
			document.getElementById("flyStatus").textContent = "Fly-through indisponible : " + error.message;
	}
}

function loadBuildingData() {
	if (!m_buildingsPromise) {
		m_buildingsPromise = Promise.all([fetch("ridge_racer/OBJ.RRO").then(async function(response) {
			if (!response.ok)
				throw new Error("Impossible de charger OBJ.RRO (HTTP " + response.status + ").");
			return response.arrayBuffer();
		}), loadMapExecutable()]).then(function(buffers) {
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
		var primitiveCount = appendMapBuildings(group, buildings);
		document.getElementById("buildingStatus").textContent = buildings.length + " éléments de décor placés depuis SCUS-943.00 · " + primitiveCount + " primitives · fenêtres de texture PS1 expérimentales.";
		applyRenderMode();
	} catch (error) {
		if (m_object === group && m_sourceType === "map")
			document.getElementById("buildingStatus").textContent = "Immeubles non chargés : " + error.message;
	}
}

function appendMapBuildings(group, buildings) {
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
	return primitiveCount;
}

async function applyMapTextures(request) {
	var createdTextures = [];
	try {
		if (!m_triangleObjects.length)
			throw new Error("Charge d'abord une carte MAP.RRM.");
		var revolution = m_sourceType === "revolution";
		document.getElementById("textureStatus").textContent = revolution ? "Chargement des textures Revolution..." : "Chargement des banques TMS...";
		var vrams = revolution ? m_revolutionVram : await loadMapBanks();
		var references = revolution ? await loadRevolutionReferences() : null;
		if (request !== m_textureRequest)
			return;
		var pageCache = new Map();
		var selectionCache = new Map();
		var Material = document.getElementById("renderMode").value === "textureSun" ? THREE.MeshLambertMaterial : THREE.MeshBasicMaterial;
		var matched = 0, missing = 0, objectMatched = 0, objectMissing = 0, unverified = 0;
		var prepared = m_triangleObjects.map(function(mesh) {
			var materials = [];
			var materialIndices = new Map();
			var faceUvs = [];
			var faceMaterials = [];
			mesh.userData.primitives.forEach(function(primitive) {
				var bank = primitive.textureBank || mesh.userData.textureBank || "map";
				if (revolution) {
					var selectionKey = bank + ":" + primitive.tpage + ":" + primitive.clut + ":" +
						JSON.stringify(primitive.window) + ":" + JSON.stringify(primitive.uvs);
					if (!selectionCache.has(selectionKey))
						selectionCache.set(selectionKey, MapVram.revolutionTexture(primitive, vrams, references, bank));
					var selection = selectionCache.get(selectionKey);
					bank = selection.bank;
					if (!selection.verified)
						unverified++;
				}
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
					if (mesh.userData.objectId !== undefined) objectMatched++;
					else matched++;
				} else {
					if (mesh.userData.objectId !== undefined) objectMissing++;
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
		var message = matched + " primitives " + (revolution ? "Revolution" : "MAP") + " couvertes · " + missing + " incomplètes";
		if (objectMatched + objectMissing)
			message += " · décor " + (revolution ? "Revolution" : "OBJ") + " : " + objectMatched + " couvertes, " + objectMissing + " incomplètes";
		message += " · magenta : données VRAM absentes" + (revolution ?
			" · " + unverified + " primitives sans correspondance TMS vérifiée · textures statiques expérimentales" :
			" · banques séparées circuit / immeubles");
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
