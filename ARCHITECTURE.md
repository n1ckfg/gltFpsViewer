# gltFpsViewer Architecture

This document provides a high-level overview of the `gltFpsViewer` application's structure and core systems. The application is a lightweight, dependency-free (via CDN) web-based 3D viewer built with [Three.js](https://threejs.org/).

## Directory Structure

- **`index.html`**: The main entry point. Sets up the full-screen structure, the "Click to play" instruction overlay, and utilizes an [Import Map](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/script/type/importmap) to resolve `three` and `three/addons/*` directly from unpkg.
- **`style.css`**: Contains minimalistic styling to ensure the canvas fills the window and the instruction overlay is centered with proper `pointer-events` handling.
- **`main.js`**: Contains the entirety of the application logic. 
- **`recorder.js`**: A standalone `Recorder` class wrapping the `MediaRecorder` API, adapted from the `MonitorModule` in LICHEN.
- **`palette.js`**: A self-contained `Palette` widget (background swatches + levels sliders) that builds its own DOM and reports changes through callbacks.
- **`levels.js`**: The `LevelsShader` definition used by the post-processing levels pass.
- **`run.bat` / `run.command`**: Helper scripts to easily spawn a local HTTP server (`http-server`) and open the application in a browser, bypassing local CORS restrictions.

## Core Systems (`main.js`)

The application logic is driven by standard Three.js paradigms, structured around an `init()` setup function and a recursive `animate()` render loop.

### 1. Rendering & Scene Setup
- **Scene**: A basic `THREE.Scene` with a sky-blue background and fog to provide depth. Includes a `GridHelper` (which hides once the first model is loaded).
- **Lighting**: A combination of `HemisphereLight` (for soft ambient illumination) and `DirectionalLight` (for directional shading).
- **Renderer**: `WebGLRenderer` configured for full-screen anti-aliased output.
- **Post-processing**: The scene is drawn through an `EffectComposer` chain rather than a direct `renderer.render()` call: `RenderPass` → `OutputPass` → a `ShaderPass` running `LevelsShader`. Because the levels pass runs *after* `OutputPass` has tone-mapped and sRGB-encoded the frame, it operates on display-referred values, matching the behaviour of an image editor's Levels dialog. With neutral settings the chain is a pass-through — colours round-trip exactly.

### 2. Camera & Movement Controls
The application features a hybrid control scheme that switches between "FPS Flight" and "Object Manipulation" modes based on the Pointer Lock API.

- **Mode Switching**: `Tab` toggles between the two. With the menu up it requests pointer lock and returns to flight; in flight it releases the lock and pauses. It is handled before the palette's key guard, so it works even while one of that panel's controls has focus, and it calls `preventDefault()` so the browser doesn't walk focus instead. Clicking empty space also locks, and `Esc` unlocks (browser behaviour). Note that Chrome throttles re-locking for a moment after an unlock, so a very fast `Tab`-`Tab` may need a second press.
- **Widget Visibility**: `updateWidgetVisibility()` hides everything that is viewer chrome rather than scene content whenever the pointer is locked — the `GridHelper`, the `TransformControls` gizmo and the green selection `BoxHelper` — so flight mode (and anything captured during it) is unobstructed. Selection state is kept, not cleared: the gizmo and box reappear on the same node when the menu comes back. Note that `PointerLockControls` dispatches its `lock`/`unlock` events *before* assigning `isLocked`, so those two handlers pass the new state in explicitly rather than reading the stale flag.
- **FPS Flight Mode (Pointer Locked)**:
  - Governed by `PointerLockControls`, which binds mouse movement directly to the camera's pitch and yaw.
  - A custom velocity-based movement system listens for `W, A, S, D` (horizontal) and `Q, E` (vertical) to translate the camera.
  - Holding `Shift` doubles the movement speed.
- **Object Manipulation Mode (Pointer Unlocked)**:
  - Governed by `TransformControls`.
  - A Raycaster fires on `pointerdown` to detect if the user clicked on a loaded model. If so, the exact mesh node is highlighted with a green `BoxHelper`, while the `TransformControls` gizmo attaches to the top-level loaded model (root) by default.
  - **Scene Graph Navigation**: While unlocked, users can use the `Arrow keys` to traverse the model's internal scene graph (`Up`/`Down` for parent/child, `Left`/`Right` for siblings). Upon navigation, the `TransformControls` gizmo attaches directly to the newly selected sub-node, enabling precise manipulation of individual parts.
  - Hotkeys `1`, `2`, and `3` switch the gizmo between `translate`, `rotate`, and `scale` modes respectively.
  - **Node Deletion**: Pressing `Backspace` or `Delete` prompts for confirmation and removes the selected node (and its children) from the scene, properly disposing of associated resources.
  - Clicking empty space deselects the current node, detaches the gizmo, and re-enters FPS Flight Mode.

### 3. Drag-and-Drop Loader
To bypass standard browser security restrictions regarding local file access, the application implements a robust local drag-and-drop system.
- Listens for `drop` events on the document.
- Identifies the root `.gltf` or `.glb` file.
- Creates a custom `THREE.LoadingManager` with a `setURLModifier`. When the `GLTFLoader` attempts to fetch relative assets (like `.bin` or `.png` textures), the manager maps the requested filename to the physical file dropped by the user, dynamically generating a `Blob URL` (`URL.createObjectURL`).
- **Viewer State Restore**: If the dropped file carries a `gltFpsViewer` block in its scene `extras` (i.e. it was saved by this viewer), the background colour, levels and player pose are restored from it. This only happens when dropping into an empty scene — dropping a second model logs the block and ignores it rather than yanking the view. Every field is validated on the way in, since the file may be hand-edited or written by an older build.
- **Dynamic Placement**: When subsequent models are dropped, the application performs a spatial check. It projects a ray forward from the camera and steps iteratively until it finds a position where the new model's bounding box does not intersect with any previously loaded models' bounding boxes.

### 4. Video Recording (`recorder.js`)
The `Recorder` class captures the viewport to a downloadable video file, independent of Three.js.
- **Controls**: `Space` arms a 3-second countdown (rendered as a large centred number in the `#recorder-hud` overlay), after which capture begins. `Space` again stops the recording and triggers the download; pressing it *during* the countdown cancels instead. The hotkey works in both FPS Flight and Object Manipulation modes.
- **Capture Path**: Rather than recording the WebGL canvas directly, each frame is blitted into a fixed-size offscreen 2D canvas immediately after `renderer.render()` (while the drawing buffer is still valid, so `preserveDrawingBuffer` is not required). `MediaRecorder` captures that canvas via `captureStream(30)`. Locking the output resolution at the start of a take means a mid-recording window resize letterboxes the frame rather than breaking the stream.
- **Resolution**: Matches the renderer's drawing buffer, scaled down to fit within 1920x1080 and rounded to even dimensions for H.264 compatibility.
- **Encoding**: MIME types are probed in order of preference (MP4/H.264 first, then WebM/VP9, VP8) so the best container the browser supports is used, at 20 Mbps. Chunks are collected every second and, on stop, concatenated into a Blob and downloaded as a timestamped `capture_*.mp4` (or `.webm`).
- **HUD**: While recording, a blinking red `REC` indicator with elapsed time is shown in the top-right corner. The HUD is plain DOM, so it never appears in the captured video. It is deliberately exempt from the widget hiding described in section 2 and stays up in FPS Flight Mode, since it is the only signal that a take is running.

### 5. Colour Palette & Levels (`palette.js`, `levels.js`)
Pressing `C` toggles a panel for adjusting the look of the viewport. It generates its own markup (the swatch grid and sliders are too repetitive to hand-write) and is styled from `style.css`.
- **Background**: A grid of 14 preset swatches plus a native `<input type="color">` for arbitrary values. Choosing a colour updates both `scene.background` and the fog colour, so the horizon stays consistent.
- **Levels**: Three sliders — black point (0–1), white point (0–1) and gamma (0.2–3) — drive the uniforms of the levels pass, applying `((c - black) / (white - black)) ^ (1/gamma)`. The two endpoints are prevented from crossing: the slider being dragged wins and pushes the other one ahead of it. A `reset` button restores the defaults (sky blue, 0 / 1 / 1).
- **Input Routing**: Because the viewer binds document-level handlers, the panel is explicitly excluded from them — `pointerdown` inside it does not raycast or grab pointer lock, and key presses on its controls (arrow keys nudging a slider) do not reach the scene-graph or movement bindings. Opening the panel while in FPS Flight Mode releases pointer lock so the cursor is usable; re-locking closes the panel.
- **Recording**: Since the adjustment is a shader pass rather than a CSS filter, both the background colour and the levels are baked into the captured video.

### 6. Scene Export
- Users can press `O` to trigger an export.
- The application uses `GLTFExporter` to parse the entire current scene graph.
- It is configured to output in binary mode (`binary: true`), generating an ArrayBuffer that is converted into a Blob and programmatically downloaded as a timestamped `.glb` file.
- **Viewer State**: Immediately before parsing, a snapshot of the state that isn't part of the scene graph is written to `scene.userData.gltFpsViewer`, which `GLTFExporter.processScene()` serializes into `scenes[0].extras`:

```json
{ "version": 1,
  "background": "#87ceeb",
  "levels": { "blackPoint": 0, "whitePoint": 1, "gamma": 1 },
  "player": { "position": [0,2,5], "quaternion": [0,0,0,1], "fov": 75 } }
```

  `extras` is the spec-sanctioned place for application data, so the file stays valid glTF and other tools simply ignore the block. The drag-and-drop loader reads it back (see above), making a `.glb` a complete save file for the session rather than just its geometry.
- **Camera Node**: `controls.getObject()` (the camera itself) lives in the scene, so the exporter would otherwise emit it as a glTF `camera` node — and because a loaded model keeps that node, a save → load → save cycle would stack up one camera per round trip. The camera is therefore hidden for the duration of the parse (the exporter's `onlyVisible` option skips it) and shown again in the completion callbacks; `visible` has no effect on a camera's own rendering, so nothing changes on screen. The pose travels in `extras` instead.
