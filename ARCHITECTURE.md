# gltFpsViewer Architecture

This document provides a high-level overview of the `gltFpsViewer` application's structure and core systems. The application is a lightweight, dependency-free (via CDN) web-based 3D viewer built with [Three.js](https://threejs.org/).

## Directory Structure

- **`index.html`**: The main entry point. Sets up the full-screen structure, the "Click to play" instruction overlay, and utilizes an [Import Map](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/script/type/importmap) to resolve `three` and `three/addons/*` directly from unpkg.
- **`style.css`**: Contains minimalistic styling to ensure the canvas fills the window and the instruction overlay is centered with proper `pointer-events` handling.
- **`main.js`**: Contains the entirety of the application logic. 
- **`run.bat` / `run.command`**: Helper scripts to easily spawn a local HTTP server (`http-server`) and open the application in a browser, bypassing local CORS restrictions.

## Core Systems (`main.js`)

The application logic is driven by standard Three.js paradigms, structured around an `init()` setup function and a recursive `animate()` render loop.

### 1. Rendering & Scene Setup
- **Scene**: A basic `THREE.Scene` with a sky-blue background and fog to provide depth.
- **Lighting**: A combination of `HemisphereLight` (for soft ambient illumination) and `DirectionalLight` (for directional shading).
- **Renderer**: `WebGLRenderer` configured for full-screen anti-aliased output.

### 2. Camera & Movement Controls
The application features a hybrid control scheme that switches between "FPS Flight" and "Object Manipulation" modes based on the Pointer Lock API.

- **FPS Flight Mode (Pointer Locked)**:
  - Governed by `PointerLockControls`, which binds mouse movement directly to the camera's pitch and yaw.
  - A custom velocity-based movement system listens for `W, A, S, D` (horizontal) and `Q, E` (vertical) to translate the camera.
  - Holding `Shift` doubles the movement speed.
- **Object Manipulation Mode (Pointer Unlocked)**:
  - Governed by `TransformControls`.
  - A Raycaster fires on `pointerdown` to detect if the user clicked on a loaded model. If so, the `TransformControls` gizmo attaches to the model.
  - Hotkeys `1`, `2`, and `3` switch the gizmo between `translate`, `rotate`, and `scale` modes respectively.
  - Clicking empty space detaches the gizmo and re-enters FPS Flight Mode.

### 3. Drag-and-Drop Loader
To bypass standard browser security restrictions regarding local file access, the application implements a robust local drag-and-drop system.
- Listens for `drop` events on the document.
- Identifies the root `.gltf` or `.glb` file.
- Creates a custom `THREE.LoadingManager` with a `setURLModifier`. When the `GLTFLoader` attempts to fetch relative assets (like `.bin` or `.png` textures), the manager maps the requested filename to the physical file dropped by the user, dynamically generating a `Blob URL` (`URL.createObjectURL`).
- **Dynamic Placement**: When subsequent models are dropped, the application performs a spatial check. It projects a ray forward from the camera and steps iteratively until it finds a position where the new model's bounding box does not intersect with any previously loaded models' bounding boxes.

### 4. Scene Export
- Users can press `O` to trigger an export.
- The application uses `GLTFExporter` to parse the entire current scene graph.
- It is configured to output in binary mode (`binary: true`), generating an ArrayBuffer that is converted into a Blob and programmatically downloaded as a timestamped `.glb` file.
