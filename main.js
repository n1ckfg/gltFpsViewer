import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

let camera, scene, renderer, controls, gridHelper;

let moveForward = false;
let moveBackward = false;
let moveLeft = false;
let moveRight = false;
let moveUp = false;
let moveDown = false;

let prevTime = performance.now();
const velocity = new THREE.Vector3();
const direction = new THREE.Vector3();

let currentModel = null;

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

    instructions.addEventListener( 'click', function () {
        controls.lock();
    } );

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
                if (currentModel) {
                    scene.remove(currentModel);
                }
                currentModel = gltf.scene;
                scene.add(currentModel);
                if (gridHelper) gridHelper.visible = false;
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

        const speed = 25.0; // Units per second

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
