import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Recorder } from './recorder.js';
import { Palette } from './palette.js';
import { LevelsShader } from './levels.js';

let camera, scene, renderer, controls, gridHelper, transformControl;
let composer, levelsPass;

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

let recorder, countdownEl, recIndicatorEl, recTimeEl;
let palette;

let loadedModels = [];
let selectedNode = null; // Currently selected node for scene graph navigation
let selectionHelper = null; // BoxHelper for visual highlight

init();
animate();

function init() {
    scene = new THREE.Scene();
    //scene.background = new THREE.Color( 0x000000 );
    //scene.fog = new THREE.Fog( 0x000000, 0, 750 );
    scene.background = new THREE.Color( 0x87ceeb );
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

    // Post-processing: the levels pass runs last, after OutputPass has encoded
    // the frame to sRGB, so it adjusts display values rather than linear ones.
    composer = new EffectComposer( renderer );
    composer.setPixelRatio( window.devicePixelRatio );
    composer.setSize( window.innerWidth, window.innerHeight );
    composer.addPass( new RenderPass( scene, camera ) );
    composer.addPass( new OutputPass() );
    levelsPass = new ShaderPass( LevelsShader );
    composer.addPass( levelsPass );

    palette = new Palette( {
        onBackgroundChange: setBackgroundColor,
        onLevelsChange: setLevels
    } );

    controls = new PointerLockControls( camera, document.body );

    countdownEl = document.getElementById( 'countdown' );
    recIndicatorEl = document.getElementById( 'rec-indicator' );
    recTimeEl = document.getElementById( 'rec-time' );

    recorder = new Recorder( renderer.domElement, {
        onStateChange: updateRecorderHud
    } );
    updateRecorderHud( recorder.state );

    const instructions = document.getElementById( 'instructions' );

    transformControl = new TransformControls(camera, renderer.domElement);
    transformControl.addEventListener('dragging-changed', function (event) {
        // Prevent pointer lock while dragging transform controls
    });
    scene.add(transformControl);

    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();

    document.addEventListener('pointerdown', (event) => {
        if (palette.contains(event.target)) return;
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
            // Select the exact node hit for scene graph navigation
            selectNode(object);
            // But attach transform controls to the top-level loaded model
            let modelRoot = object;
            while (modelRoot.parent && !loadedModels.includes(modelRoot)) {
                modelRoot = modelRoot.parent;
            }
            if (loadedModels.includes(modelRoot)) {
                transformControl.attach(modelRoot);
                return;
            }
        }
        
        // If clicking empty space, detach transform control and lock pointer
        selectNode(null);
        transformControl.detach();
        controls.lock();
    });

    controls.addEventListener( 'lock', function () {
        instructions.style.display = 'none';
        palette.close();
    } );

    controls.addEventListener( 'unlock', function () {
        instructions.style.display = 'flex';
    } );

    scene.add( controls.getObject() );

    const onKeyDown = function ( event ) {
        if ( event.code === 'Escape' && palette.isOpen ) {
            palette.close();
            return;
        }

        // Let the panel's own controls handle their keys (arrows nudge sliders)
        if ( palette.contains( event.target ) && event.code !== 'KeyC' ) return;

        // Space toggles recording in both flight and manipulation modes
        if ( event.code === 'Space' ) {
            event.preventDefault();
            if ( !event.repeat ) recorder.toggle();
            return;
        }

        // Arrow keys: scene graph navigation (only when pointer is unlocked)
        if ( !controls.isLocked ) {
            switch ( event.code ) {
                case 'ArrowUp':
                    navigateSceneGraph( 'parent' );
                    return;
                case 'ArrowDown':
                    navigateSceneGraph( 'child' );
                    return;
                case 'ArrowLeft':
                    navigateSceneGraph( 'prevSibling' );
                    return;
                case 'ArrowRight':
                    navigateSceneGraph( 'nextSibling' );
                    return;
                case 'Backspace':
                case 'Delete':
                    deleteSelectedNode();
                    return;
            }
        }

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
            case 'KeyC':
                palette.toggle();
                // The panel needs the cursor back
                if ( palette.isOpen && controls.isLocked ) controls.unlock();
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
    composer.setSize( window.innerWidth, window.innerHeight );
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

    if ( selectionHelper ) selectionHelper.update();

    composer.render();

    recorder.update();
    if ( recorder.isRecording() ) recTimeEl.textContent = formatDuration( recorder.elapsedSeconds );
}


function setBackgroundColor( hex ) {
    const color = new THREE.Color( hex );
    scene.background = color;
    if ( scene.fog ) scene.fog.color.copy( color );
}

function setLevels( levels ) {
    levelsPass.uniforms[ 'blackPoint' ].value = levels.blackPoint;
    levelsPass.uniforms[ 'whitePoint' ].value = levels.whitePoint;
    levelsPass.uniforms[ 'gamma' ].value = levels.gamma;
}

function updateRecorderHud( state ) {
    const countingDown = state === 'countdown';
    const recording = state === 'recording';

    countdownEl.style.display = countingDown ? 'block' : 'none';
    recIndicatorEl.style.display = recording ? 'flex' : 'none';

    if ( countingDown ) countdownEl.textContent = recorder.countdownRemaining;
    if ( recording ) recTimeEl.textContent = formatDuration( 0 );
}

function formatDuration( seconds ) {
    const total = Math.floor( seconds );
    const mins = Math.floor( total / 60 );
    const secs = total % 60;
    return `${mins}:${String( secs ).padStart( 2, '0' )}`;
}

function selectNode( node ) {
    // Remove previous highlight
    if ( selectionHelper ) {
        scene.remove( selectionHelper );
        selectionHelper.dispose();
        selectionHelper = null;
    }

    selectedNode = node;

    if ( !node ) {
        console.log( 'Scene graph: deselected' );
        return;
    }

    // Add a wireframe bounding box highlight
    selectionHelper = new THREE.BoxHelper( node, 0x00ff00 );
    scene.add( selectionHelper );

    const nodeName = node.name || '(unnamed)';
    const nodeType = node.type;
    const childCount = node.children ? node.children.length : 0;
    console.log( `Scene graph: selected "${nodeName}" [${nodeType}] — ${childCount} children` );

    // Attach transform controls to this node
    transformControl.attach( node );
}

function navigateSceneGraph( direction ) {
    // If nothing selected, start from the first loaded model root
    if ( !selectedNode ) {
        if ( loadedModels.length > 0 ) {
            selectNode( loadedModels[0] );
        }
        return;
    }

    const node = selectedNode;

    switch ( direction ) {
        case 'parent': {
            if ( node.parent && node.parent !== scene ) {
                selectNode( node.parent );
            } else {
                console.log( 'Scene graph: already at root' );
            }
            break;
        }
        case 'child': {
            // Filter out non-user children (helpers, etc.)
            const userChildren = node.children.filter( c =>
                !(c instanceof THREE.BoxHelper) &&
                !(c.isTransformControlsRoot) &&
                c !== selectionHelper
            );
            if ( userChildren.length > 0 ) {
                selectNode( userChildren[0] );
            } else {
                console.log( 'Scene graph: no children' );
            }
            break;
        }
        case 'prevSibling':
        case 'nextSibling': {
            if ( !node.parent ) {
                console.log( 'Scene graph: no parent, cannot navigate siblings' );
                return;
            }
            const siblings = node.parent.children.filter( c =>
                !(c instanceof THREE.BoxHelper) &&
                !(c.isTransformControlsRoot) &&
                c !== selectionHelper
            );
            const idx = siblings.indexOf( node );
            if ( idx === -1 ) return;

            if ( direction === 'prevSibling' ) {
                if ( idx > 0 ) {
                    selectNode( siblings[idx - 1] );
                } else {
                    console.log( 'Scene graph: no previous sibling' );
                }
            } else {
                if ( idx < siblings.length - 1 ) {
                    selectNode( siblings[idx + 1] );
                } else {
                    console.log( 'Scene graph: no next sibling' );
                }
            }
            break;
        }
    }
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

function deleteSelectedNode() {
    if ( !selectedNode ) return;
    
    // Only allow deleting loaded models or their children
    let modelRoot = selectedNode;
    while (modelRoot.parent && !loadedModels.includes(modelRoot)) {
        modelRoot = modelRoot.parent;
    }
    
    if ( !loadedModels.includes(modelRoot) ) {
        console.log("Cannot delete non-model objects.");
        return; 
    }

    const nodeName = selectedNode.name || 'this object';
    if ( confirm(`Are you sure you want to delete "${nodeName}"?`) ) {
        // Detach transform controls
        transformControl.detach();
        
        // Remove from parent
        if ( selectedNode.parent ) {
            selectedNode.parent.remove( selectedNode );
        }
        
        // If it was a root model, remove from loadedModels array
        const index = loadedModels.indexOf( selectedNode );
        if ( index !== -1 ) {
            loadedModels.splice( index, 1 );
        }

        // Clean up resources (geometry, materials) recursively
        selectedNode.traverse((child) => {
            if (child.isMesh) {
                if (child.geometry) child.geometry.dispose();
                if (child.material) {
                    if (Array.isArray(child.material)) {
                        child.material.forEach(m => m.dispose());
                    } else {
                        child.material.dispose();
                    }
                }
            }
        });
        
        // Clear selection
        selectNode( null );
    }
}
