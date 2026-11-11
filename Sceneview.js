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
	this.clear();
	this.animate();
};

Sceneview.prototype.clear = function() 
{
	console.log("clear");
	this.scene = new THREE.Scene();
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

	// Camera is in fly mode and we have a spline to follow?
	if( this.activeCameraMode === 'fly' && this.cameraSpline ) {
	
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

Sceneview.prototype.renderScene = function(camera) {
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

Sceneview.prototype.setSky = function(pixels) {
	this.clearSky();
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
	this.skyScene = new THREE.Scene();
	this.skyScene.add(new THREE.Mesh(geometry, material));
	this.skyCamera = new THREE.PerspectiveCamera(90, 1, 0.1, 100);
	this.skyTexture = texture;
	this.skyGeometry = geometry;
	this.skyMaterial = material;
};

Sceneview.prototype.clearSky = function() {
	if (!this.skyScene)
		return;
	this.skyTexture.dispose();
	this.skyGeometry.dispose();
	this.skyMaterial.dispose();
	this.skyScene = null;
	this.skyCamera = null;
	this.skyTexture = null;
	this.skyGeometry = null;
	this.skyMaterial = null;
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