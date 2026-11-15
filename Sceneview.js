"use strict"
var Sceneview = function(containerId, width, height){
	this.renderer = new THREE.WebGLRenderer( { antialias: true } );
	this.renderer.setSize( width, height );
	this.renderer.setClearColor( 0x000000 );
	this.container = document.getElementById( containerId );
	this.container.appendChild( this.renderer.domElement );
	this.width = width;
	this.height = height;

	this.activeCameraMode = 'fly';

	window.addEventListener('resize', this.resize.bind(this), true);
	this.renderer.domElement.addEventListener('dblclick', this.centerOnClick.bind(this));
	this.clear();
	this.animate();
};

Sceneview.prototype.centerOnClick = function(event) {
	if ((this.rr4Fly && this.rr4Fly.active) || (this.activeCameraMode === 'fly' && this.cameraSpline))
		return;

	var rect = this.renderer.domElement.getBoundingClientRect();
	if (!rect.width || !rect.height)
		return;
	var pointer = new THREE.Vector2(
		(event.clientX - rect.left) / rect.width * 2 - 1,
		1 - (event.clientY - rect.top) / rect.height * 2
	);
	this.scene.updateMatrixWorld(true);
	this.camera.updateMatrixWorld(true);
	this.updateRr4Billboards(this.camera);

	var meshes = [];
	function collectMeshes(object) {
		if (!object.visible)
			return;
		if (object instanceof THREE.Mesh)
			meshes.push(object);
		object.children.forEach(collectMeshes);
	}
	collectMeshes(this.scene);

	var raycaster = new THREE.Raycaster();
	raycaster.setFromCamera(pointer, this.camera);
	var direction = this.camera.getWorldDirection();
	var intersections = raycaster.intersectObjects(meshes, false);
	for (var i = 0; i < intersections.length; i++) {
		var intersection = intersections[i];
		var material = intersection.object.material;
		if (material instanceof THREE.MultiMaterial)
			material = material.materials[intersection.face.materialIndex];
		if (!material || !material.visible)
			continue;
		var depth = intersection.point.clone().sub(this.camera.position).dot(direction);
		if (depth < this.camera.near || depth > this.camera.far)
			continue;
		var offset = intersection.point.clone().sub(this.controls.target);
		this.camera.position.add(offset);
		this.controls.target.copy(intersection.point);
		this.controls.update();
		return;
	}
};

Sceneview.prototype.clear = function() 
{
	console.log("clear");
	this.scene = new THREE.Scene();
	this.rr4BillboardMesh = null;
	this.rr4Fly = null;
	this.camera = new THREE.PerspectiveCamera( 90, this.width / this.height, 0.1, 5000000 );
	this.camera.position.set(-500,500,-500);
	this.camera.up = new THREE.Vector3(0,1,0);
	this.camera.lookAt(new THREE.Vector3(0,0,0));
	
	this.controls = new THREE.OrbitControls( this.camera, this.renderer.domElement );
	this.controls.damping = 0.2;
	this.controls.zoomSpeed = 2;
	
	this.scene.add( new THREE.AmbientLight( 0x77818a, 0.45 ) );
	var sunlight = new THREE.DirectionalLight( 0xffe3b0, 1.15 );
	sunlight.position.set( -0.5, 1, 0.35 );
	this.scene.add( sunlight );
	
	var axis = new THREE.AxisHelper( 1 );
	axis.position.set( 0, 0, 0 );
	this.scene.add( axis );
	
};

Sceneview.prototype.resize = function() 
{
	this.width = this.container.clientWidth;
	this.height = this.container.clientHeight;
	
	this.camera.aspect = this.width / this.height;
	this.camera.updateProjectionMatrix();

	this.renderer.setSize( this.width, this.height );
	if (this.viewMode === 'top' && this.boundsMinimum && this.boundsMaximum)
		this.fitTopDownToBounds(this.boundsMinimum, this.boundsMaximum);
}

Sceneview.prototype.animate = function() 
{
	requestAnimationFrame( this.animate.bind(this) );
	var time = Date.now();
	
	// Update weapon tile color 
	if(this.weaponTileMaterial) {
		this.updateWeaponMaterial(time);
	}

	if (this.rr4Fly && this.rr4Fly.active) {
		if (document.hidden)
			this.rr4Fly.lastTime = null;
		else
			this.advanceRr4Fly(time);
		this.renderScene(this.camera);
	}
	// Camera is in fly mode and we have a spline to follow?
	else if( this.activeCameraMode === 'fly' && this.cameraSpline ) {
	
		var elapsedTime = time - this.startTime;
		var elapsedTicks = elapsedTime / 1000 * 60;

		// Fixed time step loop (60hz)
		while(this.ticks < elapsedTicks) {
		
			this.updateSplineCamera();
			this.ticks++;
		}
		
		this.rotateSpritesToCamera(this.splineCamera);
		this.renderScene(this.splineCamera);
	}

	// Default Orbit camera
	else {
		this.controls.update();
//		this.rotateSpritesToCamera(this.camera);
		//console.log("render");
		this.renderScene(this.camera);
	}
};

Sceneview.prototype.setRr4FlyPath = function(samples) {
	var points = samples.map(function(sample) {
		if (!sample.left || !sample.right ||
			![sample.x, sample.z, sample.height, sample.left[0], sample.left[1], sample.right[0], sample.right[1]].every(Number.isFinite))
			throw new Error("Échantillon de route invalide pour la caméra fly-through.");
		return [
			sample.x + (sample.left[0] + sample.right[0]) / 2,
			-sample.height / 4,
			-sample.z - (sample.left[1] + sample.right[1]) / 2
		];
	});
	this.setFlyPath(points, -1);
};

Sceneview.prototype.setFlyPath = function(coordinates, normalDirection) {
	if (normalDirection !== 1 && normalDirection !== -1)
		throw new Error("Sens de parcours invalide pour la caméra fly-through.");
	var points = [];
	coordinates.forEach(function(coordinate) {
		if (!coordinate || coordinate.length !== 3 || !coordinate.every(Number.isFinite))
			throw new Error("Point invalide pour la caméra fly-through.");
		var point = new THREE.Vector3(coordinate[0], coordinate[1], coordinate[2]);
		if (!points.length || point.distanceToSquared(points[points.length - 1]) > 0)
			points.push(point);
	});
	if (points.length > 1 && points[0].distanceToSquared(points[points.length - 1]) === 0)
		points.pop();
	if (points.length < 2)
		throw new Error("Le circuit ne contient pas assez de points distincts pour la caméra fly-through.");

	var distances = [0];
	for (var i = 0; i < points.length; i++)
		distances.push(distances[i] + points[i].distanceTo(points[(i + 1) % points.length]));
	this.stopRr4Fly();
	this.rr4Fly = { points: points, distances: distances, length: distances[points.length], active: false,
		normalDirection: normalDirection };
};

Sceneview.prototype.rr4FlyPoint = function(distance) {
	var path = this.rr4Fly;
	distance = ((distance % path.length) + path.length) % path.length;
	var low = 0, high = path.points.length;
	while (low + 1 < high) {
		var middle = Math.floor((low + high) / 2);
		if (path.distances[middle] <= distance)
			low = middle;
		else
			high = middle;
	}
	var fraction = (distance - path.distances[low]) / (path.distances[low + 1] - path.distances[low]);
	return path.points[low].clone().lerp(path.points[(low + 1) % path.points.length], fraction);
};

Sceneview.prototype.nearestRr4FlyDistance = function(height) {
	var path = this.rr4Fly;
	var camera = this.camera.position;
	var roadHeight = camera.y - height;
	var bestHorizontal = Infinity, bestVertical = Infinity, bestDistance = 0;
	for (var i = 0; i < path.points.length; i++) {
		var start = path.points[i], end = path.points[(i + 1) % path.points.length];
		var dx = end.x - start.x, dy = end.y - start.y, dz = end.z - start.z;
		var horizontalLength = dx * dx + dz * dz;
		var fraction = horizontalLength ?
			((camera.x - start.x) * dx + (camera.z - start.z) * dz) / horizontalLength :
			(roadHeight - start.y) / dy;
		fraction = Math.max(0, Math.min(1, fraction));
		var x = start.x + dx * fraction - camera.x;
		var z = start.z + dz * fraction - camera.z;
		var y = start.y + dy * fraction - roadHeight;
		var horizontal = x * x + z * z, vertical = y * y;
		if (horizontal < bestHorizontal - 1e-9 ||
			(Math.abs(horizontal - bestHorizontal) <= 1e-9 && vertical < bestVertical)) {
			bestHorizontal = horizontal;
			bestVertical = vertical;
			bestDistance = path.distances[i] + fraction * (path.distances[i + 1] - path.distances[i]);
		}
	}
	return bestDistance;
};

Sceneview.prototype.updateRr4FlyCamera = function() {
	var path = this.rr4Fly;
	var position = this.rr4FlyPoint(path.distance);
	var direction = path.direction === "normal" ? path.normalDirection : -path.normalDirection;
	var target = this.rr4FlyPoint(path.distance + direction * Math.min(300, path.length / 4));
	position.y += path.height;
	target.y += path.height;
	this.camera.position.copy(position);
	this.camera.up.set(0, 1, 0);
	this.camera.lookAt(target);
	path.target = target;
};

Sceneview.prototype.configureRr4Fly = function(speed, height, direction) {
	if (!this.rr4Fly || !Number.isFinite(speed) || speed < 0 ||
		!Number.isFinite(height) || height <= 0 || (direction !== "normal" && direction !== "inverse"))
		throw new Error("Réglages de la caméra fly-through invalides.");
	this.rr4Fly.speed = speed;
	this.rr4Fly.height = height;
	this.rr4Fly.direction = direction;
	if (this.rr4Fly.active)
		this.updateRr4FlyCamera();
};

Sceneview.prototype.startRr4Fly = function(speed, height, direction) {
	this.configureRr4Fly(speed, height, direction);
	var path = this.rr4Fly;
	if (path.active)
		return;
	path.distance = this.nearestRr4FlyDistance(height);
	path.lastTime = null;
	path.controlsEnabled = this.controls.enabled;
	path.near = this.camera.near;
	path.far = this.camera.far;
	path.active = true;
	this.controls.enabled = false;
	this.viewMode = 'rr4-fly';
	this.camera.near = Math.min(this.camera.near, 1);
	if (this.boundsMinimum && this.boundsMaximum)
		this.camera.far = Math.max(this.camera.far, this.boundsMaximum.distanceTo(this.boundsMinimum) * 2 + height);
	this.camera.updateProjectionMatrix();
	this.updateRr4FlyCamera();
};

Sceneview.prototype.advanceRr4Fly = function(time) {
	var path = this.rr4Fly;
	if (path.lastTime !== null) {
		var elapsed = Math.max(0, (time - path.lastTime) / 1000);
		var direction = path.direction === "normal" ? path.normalDirection : -path.normalDirection;
		path.distance = ((path.distance + direction * path.speed * elapsed) % path.length + path.length) % path.length;
	}
	path.lastTime = time;
	this.updateRr4FlyCamera();
};

Sceneview.prototype.stopRr4Fly = function() {
	var path = this.rr4Fly;
	if (!path || !path.active)
		return;
	path.active = false;
	this.controls.enabled = path.controlsEnabled;
	this.controls.target.copy(path.target);
	this.camera.near = path.near;
	this.camera.far = path.far;
	this.camera.updateProjectionMatrix();
	this.viewMode = 'orbit';
	this.controls.update();
};

Sceneview.prototype.clearRr4FlyPath = function() {
	this.stopRr4Fly();
	this.rr4Fly = null;
};

Sceneview.prototype.renderScene = function(camera) {
	this.updateRr4Billboards(camera);
	if (!this.skyScene) {
		this.renderer.render(this.scene, camera);
		return;
	}
	this.skyCamera.quaternion.copy(camera.quaternion);
	this.skyCamera.fov = camera.fov;
	this.skyCamera.aspect = camera.aspect;
	this.skyCamera.zoom = camera.zoom;
	this.skyCamera.updateProjectionMatrix();
	this.renderer.autoClear = true;
	this.renderer.render(this.skyScene, this.skyCamera);
	this.renderer.autoClear = false;
	this.renderer.render(this.scene, camera);
	this.renderer.autoClear = true;
};

Sceneview.prototype.updateRr4Billboards = function(camera) {
	var mesh = this.rr4BillboardMesh;
	if (!mesh)
		return;
	var forward = camera.getWorldDirection();
	var length = Math.sqrt(forward.x * forward.x + forward.z * forward.z);
	if (length < 1e-8) {
		var right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.getWorldQuaternion());
		length = Math.sqrt(right.x * right.x + right.z * right.z);
		if (length < 1e-8)
			return;
		forward.set(right.z / length, 0, -right.x / length);
	} else {
		forward.x /= length;
		forward.z /= length;
	}
	if (mesh.userData.rr4ForwardX === forward.x && mesh.userData.rr4ForwardZ === forward.z)
		return;
	mesh.userData.rr4ForwardX = forward.x;
	mesh.userData.rr4ForwardZ = forward.z;
	mesh.userData.rr4Sprites.forEach(function(sprite, index) {
		sprite.vertices.forEach(function(vertex, corner) {
			mesh.geometry.vertices[index * 4 + corner].set(
				sprite.position[0] + (-forward.z * vertex[0] + forward.x * vertex[2]) / 4,
				-sprite.position[1] - vertex[1] / 4,
				-sprite.position[2] + (forward.x * vertex[0] + forward.z * vertex[2]) / 4
			);
		});
	});
	mesh.geometry.verticesNeedUpdate = true;
	mesh.geometry.computeBoundingSphere();
};

Sceneview.prototype.setSky = function(pixels) {
	var texture = new THREE.DataTexture(pixels, 512, 256, THREE.RGBAFormat, THREE.UnsignedByteType);
	texture.magFilter = THREE.LinearFilter;
	texture.minFilter = THREE.LinearFilter;
	texture.generateMipmaps = false;
	texture.flipY = false;
	texture.needsUpdate = true;
	var geometry = new THREE.SphereGeometry(10, 64, 32);
	geometry.faceVertexUvs[0].forEach(function(face) {
		face.forEach(function(uv) { uv.y = 1 - uv.y; });
	});
	var material = new THREE.MeshBasicMaterial({ map: texture, side: THREE.BackSide, depthWrite: false });
	var scene = new THREE.Scene();
	scene.add(new THREE.Mesh(geometry, material));
	this.setSkyScene(scene);
};

Sceneview.prototype.setSkyScene = function(scene) {
	this.clearSky();
	this.skyScene = scene;
	this.skyCamera = new THREE.PerspectiveCamera(90, 1, 0.1, 100);
};

Sceneview.prototype.clearSky = function() {
	if (!this.skyScene)
		return;
	var geometries = new Set(), materials = new Set(), textures = new Set();
	this.skyScene.traverse(function(object) {
		if (!(object instanceof THREE.Mesh))
			return;
		geometries.add(object.geometry);
		var meshMaterials = object.material instanceof THREE.MultiMaterial ? object.material.materials : [object.material];
		meshMaterials.forEach(function(material) {
			materials.add(material);
			if (material.map)
				textures.add(material.map);
		});
	});
	geometries.forEach(function(geometry) { geometry.dispose(); });
	materials.forEach(function(material) { material.dispose(); });
	textures.forEach(function(texture) { texture.dispose(); });
	this.skyScene = null;
	this.skyCamera = null;
};

Sceneview.prototype.remove = function(object) {
	this.scene.remove(object);
	var disposeResources = function(child) {
		if (child.geometry)
			child.geometry.dispose();
		if (child.material) {
			if (child.material instanceof THREE.MultiMaterial) {
				child.material.materials.forEach(function(material) { material.dispose(); });
			} else if (Array.isArray(child.material))
				child.material.forEach(function(material) { material.dispose(); });
			else
				child.material.dispose();
		}
	};
	if (object.traverse)
		object.traverse(disposeResources);
	else
		disposeResources(object);
}

Sceneview.prototype.fitToBounds = function(minimum, maximum) {
	this.viewMode = 'orbit';
	this.boundsMinimum = minimum.clone();
	this.boundsMaximum = maximum.clone();
	var center = new THREE.Vector3().addVectors(minimum, maximum).multiplyScalar(0.5);
	var dimensions = new THREE.Vector3().subVectors(maximum, minimum);
	var radius = Math.max(dimensions.length() * 0.5, 1);
	var verticalFov = THREE.Math.degToRad(this.camera.fov);
	var horizontalFov = 2 * Math.atan(Math.tan(verticalFov * 0.5) * this.width / this.height);
	var fitFov = Math.min(verticalFov, horizontalFov);
	var distance = radius / Math.sin(fitFov * 0.5) * 1.12;
	var direction = new THREE.Vector3(1, 1, 1).normalize();

	this.camera.up.set(0, 1, 0);
	this.controls.target.copy(center);
	this.camera.position.copy(center).add(direction.multiplyScalar(distance));
	this.camera.lookAt(center);
	this.camera.near = Math.max(distance / 10000, 0.01);
	this.camera.far = distance + radius * 2;
	this.camera.updateProjectionMatrix();
	this.controls.update();
};

Sceneview.prototype.fitTopDownToBounds = function(minimum, maximum) {
	this.viewMode = 'top';
	this.boundsMinimum = minimum.clone();
	this.boundsMaximum = maximum.clone();
	var center = new THREE.Vector3().addVectors(minimum, maximum).multiplyScalar(0.5);
	var width = Math.max(maximum.x - minimum.x, 1);
	var depth = Math.max(maximum.z - minimum.z, 1);
	var height = Math.max(maximum.y - minimum.y, 0);
	var verticalFov = THREE.Math.degToRad(this.camera.fov);
	var horizontalFov = 2 * Math.atan(Math.tan(verticalFov * 0.5) * this.width / this.height);
	var fitDistance = Math.max(
		width / (2 * Math.tan(horizontalFov * 0.5)),
		depth / (2 * Math.tan(verticalFov * 0.5))
	);
	var distance = (fitDistance + height * 0.5) * 1.08;

	this.controls.target.copy(center);
	this.camera.up.set(0, 1, 0);
	this.camera.position.set(center.x, center.y + distance, center.z + distance * 0.0001);
	this.camera.lookAt(center);
	this.camera.near = Math.max(distance / 10000, 0.01);
	this.camera.far = distance + height + 1;
	this.camera.updateProjectionMatrix();
	this.controls.update();
};


Sceneview.prototype.createPointCloud = function(buffer, options) {
	var data = new DataView(buffer);
	var offset = options.offset;
	var stride = options.stride;
	var componentSize = options.componentSize;
	var componentType = options.componentType;
	var littleEndian = options.littleEndian;
	var scale = options.scale;
	var recordSize = componentSize * 3;

	if (offset < 0 || offset >= data.byteLength)
		throw new Error("Offset must be inside the file.");
	if (stride < recordSize)
		throw new Error("Stride must be at least three components (" + recordSize + " bytes).");
	if (componentType === "float" && componentSize !== 4)
		throw new Error("Float mode requires 4-byte components.");

	var vertices = [];
	var minimum = new THREE.Vector3(Infinity, Infinity, Infinity);
	var maximum = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
	var readComponent = function(position) {
		if (componentType === "float")
			return data.getFloat32(position, littleEndian);
		if (componentSize === 1)
			return componentType === "signed" ? data.getInt8(position) : data.getUint8(position);
		if (componentSize === 2)
			return componentType === "signed" ? data.getInt16(position, littleEndian) : data.getUint16(position, littleEndian);
		if (componentSize === 4)
			return componentType === "signed" ? data.getInt32(position, littleEndian) : data.getUint32(position, littleEndian);

		var value = 0;
		for (var byteIndex = 0; byteIndex < 3; byteIndex++) {
			var shift = littleEndian ? byteIndex * 8 : (2 - byteIndex) * 8;
			value |= data.getUint8(position + byteIndex) << shift;
		}
		if (componentType === "signed" && (value & 0x800000))
			value |= 0xFF000000;
		return value;
	};

	for (var position = offset; position + recordSize <= data.byteLength; position += stride) {
		var x = readComponent(position) * scale;
		var y = readComponent(position + componentSize) * scale;
		var z = readComponent(position + componentSize * 2) * scale;
		if (!isFinite(x) || !isFinite(y) || !isFinite(z))
			continue;
		vertices.push(new THREE.Vector3(x, y, z));
		minimum.x = Math.min(minimum.x, x);
		minimum.y = Math.min(minimum.y, y);
		minimum.z = Math.min(minimum.z, z);
		maximum.x = Math.max(maximum.x, x);
		maximum.y = Math.max(maximum.y, y);
		maximum.z = Math.max(maximum.z, z);
	}

	if (vertices.length === 0)
		throw new Error("No complete vertex records found with these settings.");

	var geometry = new THREE.Geometry();
	geometry.vertices = vertices;
	geometry.computeBoundingSphere();
	var object = new THREE.Points(geometry, new THREE.PointsMaterial({ color: 0x55d6be, size: 3, sizeAttenuation: false }));
	object.userData.vertexCount = vertices.length;
	object.userData.minimum = minimum;
	object.userData.maximum = maximum;
	this.scene.add(object);

	this.fitToBounds(minimum, maximum);
	return object;
};

function load_binary_resource(url, offset, decal) 
{
	console.log("load_binary_resource " + url);
	var intArray = [];///new Float32Array();//[];
	var req = new XMLHttpRequest();
	req.open('GET', url, false);
	req.overrideMimeType('text\/plain; charset=x-user-defined');
	req.send(null);
	if (req.status != 200) 
	{
		//console.log("load_binary_resource error");
		return byteArray;
	}
	if(decal == undefined || decal == 0)
	{
		decal = 1;
	}
	
	var size = parseInt(req.responseText.length );
	console.log("size : " + size+", decal : "+decal+", offset : "+offset );
	var nbVertices = (size - offset) / decal;
	console.log("nb vertices : "+nbVertices);

	intArray = readVertexArray(req.responseText, offset, decal, 4);
	return intArray;

	for (var i = offset; i < size; i+=decal ) 
	{
		for( var j=0; j<3; j++)
		{
			var k = j*2 + i;
			var a = req.responseText.charCodeAt(k) & 0xff;
			var b = req.responseText.charCodeAt(k+1) & 0xff;
			var c = req.responseText.charCodeAt(k+2) & 0xff;
			//var d = req.responseText.charCodeAt(k+3) & 0xff;
			var e = a + (b << 8) + (c << 16);// + (d <<24);
			intArray.push( e );/// 65536.0 );
		}
	}
	return intArray;
	
	//-> read from end
	/*
	var i = req.responseText.length-1;
	do
	{
		i-= decal;
		for( var j=0; j<3; j++)
		{
			var k = j*3 + i;
			var a = req.responseText.charCodeAt(k) & 0xff;
			var b = req.responseText.charCodeAt(k+1) & 0xff;
			var c = req.responseText.charCodeAt(k+2) & 0xff;
			var d = req.responseText.charCodeAt(k+3) & 0xff;
			var e = a + (b << 8) + (c << 16) + (d <<24);
			//e = d + (c << 8) + (b << 16) + (a <<24);
			//intArray.push( Bytes2Float32(e) );//e / 65536.0 );
			intArray.push( e / 65536.0 );
		}
	}
	while( i>decal )
		*/
	return intArray;
}

function readVertexArray(data, offset, stride, componentSize)
{
	var vertices = [];
	for (var i = offset; i + stride <= data.length; i += stride)
	{
		var v = [];
		for (var a = 0; a < 3; a++)
		{
			var p = i + a * componentSize;
			var value;
			if (componentSize === 2)
			{
				value =
					((data.charCodeAt(p) & 0xFF) << 8) |
					(data.charCodeAt(p + 1) & 0xFF);
				if (value & 0x8000)
					value -= 0x10000;
			}
			else if (componentSize === 3)
			{
				value =
					((data.charCodeAt(p) & 0xFF) << 16) |
					((data.charCodeAt(p + 1) & 0xFF) << 8) |
					(data.charCodeAt(p + 2) & 0xFF);
				if (value & 0x800000)
					value -= 0x1000000;
			}
			else if (componentSize === 4)
			{
				value =
					((data.charCodeAt(p) & 0xFF) << 24) |
					((data.charCodeAt(p + 1) & 0xFF) << 16) |
					((data.charCodeAt(p + 2) & 0xFF) << 8) |
					(data.charCodeAt(p + 3) & 0xFF);
			}
			console.log(value);
			v.push(value);
		}
		vertices.push(v);
	}
	return vertices;
}