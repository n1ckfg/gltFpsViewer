import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';

let camera, scene, renderer, controls, gridHelper, transformControl;

let moveForward = false;
let moveBackward = false;
let moveLeft = false;
let moveRight = false;
let moveUp = false;
let moveDown = false;
let isRunning = false;

let prevTime = performance.now();
const velocity = new THREE.Vector3();
const direction = new THREE.Vector3();

let loadedModels = [];

init();
animate();

function init() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color( 0x87ceeb ); // Sky blue
    scene.fog = new THREE.Fog( 0x87ceeb, 0, 750 );

    const light = new THREE.HemisphereLight( 0xeeeeff, 0x777788, 2.5 );
    light.position.set( 0.5, 1, 0.75 );
    scene.add( light );

    const dirLight = new THREE.DirectionalLight( 0xffffff, 3 );
    dirLight.position.set( 1, 1, 1 );
    scene.add( dirLight );

    camera = new THREE.PerspectiveCamera( 75, window.innerWidth / window.innerHeight, 0.1, 1000 );
    camera.position.y = 2;
    camera.position.z = 5;

    renderer = new THREE.WebGLRenderer( { antialias: true } );
    renderer.setPixelRatio( window.devicePixelRatio );
    renderer.setSize( window.innerWidth, window.innerHeight );
    document.body.appendChild( renderer.domElement );

    controls = new PointerLockControls( camera, document.body );

    const instructions = document.getElementById( 'instructions' );

    transformControl = new TransformControls(camera, renderer.domElement);
    transformControl.addEventListener('dragging-changed', function (event) {
        // Prevent pointer lock while dragging transform controls
    });
    scene.add(transformControl);

    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();

    document.addEventListener('pointerdown', (event) => {
        if (controls.isLocked) return;

        if (transformControl.dragging || transformControl.axis !== null) {
            return;
        }

        mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
        mouse.y = -(event.clientY / window.innerHeight) * 2 - 1; // wait, +1 for ThreeJS standard

        // Let's fix Y coordinate mapping correctly
        mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

        raycaster.setFromCamera(mouse, camera);

        const intersects = raycaster.intersectObjects(loadedModels, true);

        if (intersects.length > 0) {
            let object = intersects[0].object;
            while (object.parent && !loadedModels.includes(object)) {
                object = object.parent;
            }
            if (loadedModels.includes(object)) {
                transformControl.attach(object);
                return;
            }
        }
        
        // If clicking empty space, detach transform control and lock pointer
        transformControl.detach();
        controls.lock();
    });

    controls.addEventListener( 'lock', function () {
        instructions.style.display = 'none';
    } );

    controls.addEventListener( 'unlock', function () {
        instructions.style.display = 'flex';
    } );

    scene.add( controls.getObject() );

    const onKeyDown = function ( event ) {
        switch ( event.code ) {
            case 'ArrowUp':
            case 'KeyW':
                moveForward = true;
                break;
            case 'ArrowLeft':
            case 'KeyA':
                moveLeft = true;
                break;
            case 'ArrowDown':
            case 'KeyS':
                moveBackward = true;
                break;
            case 'ArrowRight':
            case 'KeyD':
                moveRight = true;
                break;
            case 'KeyE':
                moveDown = true;
                break;
            case 'KeyQ':
                moveUp = true;
                break;
            case 'ShiftLeft':
            case 'ShiftRight':
                isRunning = true;
                break;
            case 'KeyO':
                exportScene();
                break;
            case 'Digit1':
                if (transformControl) transformControl.setMode('translate');
                break;
            case 'Digit2':
                if (transformControl) transformControl.setMode('rotate');
                break;
            case 'Digit3':
                if (transformControl) transformControl.setMode('scale');
                break;
        }
    };

    const onKeyUp = function ( event ) {
        switch ( event.code ) {
            case 'ArrowUp':
            case 'KeyW':
                moveForward = false;
                break;
            case 'ArrowLeft':
            case 'KeyA':
                moveLeft = false;
                break;
            case 'ArrowDown':
            case 'KeyS':
                moveBackward = false;
                break;
            case 'ArrowRight':
            case 'KeyD':
                moveRight = false;
                break;
            case 'KeyE':
                moveDown = false;
                break;
            case 'KeyQ':
                moveUp = false;
                break;
            case 'ShiftLeft':
            case 'ShiftRight':
                isRunning = false;
                break;
        }
    };

    document.addEventListener( 'keydown', onKeyDown );
    document.addEventListener( 'keyup', onKeyUp );

    window.addEventListener( 'resize', onWindowResize );

    // Drag and Drop
    document.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.stopPropagation();
    });

    document.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();

        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            const files = Array.from(e.dataTransfer.files);
            const fileMap = new Map();
            let rootFile = null;

            files.forEach(file => {
                fileMap.set(file.name, file);
                if (file.name.match(/\.(gltf|glb)$/i)) {
                    rootFile = file;
                }
            });

            if (!rootFile) {
                alert('No .gltf or .glb file found in the dropped files.');
                return;
            }

            const manager = new THREE.LoadingManager();
            const objectURLs = [];

            manager.setURLModifier((url) => {
                try {
                    const parsedUrl = new URL(url, window.location.href);
                    const pathname = parsedUrl.pathname;
                    const filename = pathname.substring(pathname.lastIndexOf('/') + 1);
                    if (fileMap.has(filename)) {
                        const blobUrl = URL.createObjectURL(fileMap.get(filename));
                        objectURLs.push(blobUrl);
                        return blobUrl;
                    }
                } catch (e) {
                    const filename = url.substring(url.lastIndexOf('/') + 1);
                    if (fileMap.has(filename)) {
                        const blobUrl = URL.createObjectURL(fileMap.get(filename));
                        objectURLs.push(blobUrl);
                        return blobUrl;
                    }
                }
                return url;
            });

            const loader = new GLTFLoader(manager);
            const rootUrl = URL.createObjectURL(rootFile);
            objectURLs.push(rootUrl);

            loader.load(rootUrl, (gltf) => {
                if (loadedModels.length === 0) {
                    scene.add(gltf.scene);
                    loadedModels.push(gltf.scene);
                    if (gridHelper) gridHelper.visible = false;
                } else {
                    const newModel = gltf.scene;
                    const box = new THREE.Box3().setFromObject(newModel);
                    
                    const rayDir = new THREE.Vector3();
                    camera.getWorldDirection(rayDir);
                    
                    let t = 2.0;
                    const step = 0.5;
                    const maxT = 1000.0;
                    let placed = false;
                    
                    const existingBoxes = loadedModels.map(m => new THREE.Box3().setFromObject(m));
                    
                    while (t < maxT) {
                        const P = camera.position.clone().add(rayDir.clone().multiplyScalar(t));
                        const testBox = box.clone().translate(P);
                        
                        let intersects = false;
                        for (const eBox of existingBoxes) {
                            if (testBox.intersectsBox(eBox)) {
                                intersects = true;
                                break;
                            }
                        }
                        
                        if (!intersects) {
                            newModel.position.copy(P);
                            placed = true;
                            break;
                        }
                        
                        t += step;
                    }
                    
                    if (!placed) {
                        newModel.position.copy(camera.position.clone().add(rayDir.clone().multiplyScalar(5)));
                    }
                    
                    scene.add(newModel);
                    loadedModels.push(newModel);
                }
                console.log("Model loaded successfully");
                
                objectURLs.forEach(url => URL.revokeObjectURL(url));
            }, undefined, (error) => {
                console.error(error);
                alert('Error loading model.');
                objectURLs.forEach(url => URL.revokeObjectURL(url));
            });
        }
    });

    // Add a simple ground
    const groundGeometry = new THREE.PlaneGeometry( 2000, 2000, 100, 100 );
    groundGeometry.rotateX( - Math.PI / 2 );
    
    // Grid Helper
    gridHelper = new THREE.GridHelper(200, 200);
    scene.add(gridHelper);
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize( window.innerWidth, window.innerHeight );
}

function animate() {
    requestAnimationFrame( animate );

    const time = performance.now();

    if ( controls.isLocked === true ) {
        const delta = ( time - prevTime ) / 1000;

        velocity.x -= velocity.x * 10.0 * delta;
        velocity.z -= velocity.z * 10.0 * delta;
        velocity.y -= velocity.y * 10.0 * delta;

        direction.z = Number( moveForward ) - Number( moveBackward );
        direction.x = Number( moveRight ) - Number( moveLeft );
        direction.y = Number( moveUp ) - Number( moveDown );
        direction.normalize(); // this ensures consistent movements in all directions

        const speed = isRunning ? 50.0 : 25.0; // Units per second

        if ( moveForward || moveBackward ) velocity.z -= direction.z * speed * delta;
        if ( moveLeft || moveRight ) velocity.x -= direction.x * speed * delta;
        if ( moveUp || moveDown ) velocity.y -= direction.y * speed * delta;

        controls.moveRight( - velocity.x * delta );
        controls.moveForward( - velocity.z * delta );
        controls.getObject().position.y += velocity.y * delta;
    }

    prevTime = time;

    renderer.render( scene, camera );
}

function exportScene() {
    const exporter = new GLTFExporter();
    exporter.parse(
        scene,
        function ( gltf ) {
            const blob = new Blob( [ gltf ], { type: 'application/octet-stream' } );
            const url = URL.createObjectURL( blob );
            const link = document.createElement( 'a' );
            link.style.display = 'none';
            link.href = url;
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            link.download = `scene_${timestamp}.glb`;
            document.body.appendChild( link );
            link.click();
            document.body.removeChild( link );
            URL.revokeObjectURL( url );
        },
        function ( error ) {
            console.error( 'An error happened during parsing', error );
            alert('Error exporting scene');
        },
        { binary: true }
    );
}
