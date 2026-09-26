// Canvas video recording, adapted from LICHEN's MonitorModule.
//
// The WebGL canvas is blitted into a fixed-size offscreen 2D canvas each frame
// and MediaRecorder captures that canvas instead of the renderer directly. This
// keeps the output resolution stable if the window is resized mid-take, and
// avoids depending on `preserveDrawingBuffer` (the blit happens immediately
// after render, while the drawing buffer is still valid).

const MIME_TYPES = [
    'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
    'video/mp4;codecs=avc1',
    'video/mp4',
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm'
];

export class Recorder {

    constructor( sourceCanvas, options = {} ) {
        this.sourceCanvas = sourceCanvas;

        this.maxWidth = options.maxWidth ?? 1920;
        this.maxHeight = options.maxHeight ?? 1080;
        this.fps = options.fps ?? 30;
        this.bitrate = options.bitrate ?? 20; // Mbps
        this.countdownSeconds = options.countdownSeconds ?? 3;
        this.preferDirectCapture = options.directCapture ?? true;
        this.onStateChange = options.onStateChange ?? ( () => {} );

        this.canvas = document.createElement( 'canvas' );
        this.canvas.width = this.maxWidth;
        this.canvas.height = this.maxHeight;
        // Opaque: this canvas is never composited over anything, and dropping
        // the alpha channel makes both the blit and the encode cheaper.
        this.ctx = this.canvas.getContext( '2d', { alpha: false } );

        this._recorder = null;
        this._chunks = [];
        this._mimeType = null;
        this._countdownTimer = null;
        this._countdownRemaining = 0;
        this._startTime = 0;
        this._frameTrack = null;
        this._frameInterval = 1000 / this.fps;
        this._lastFrameTime = 0;
        this._direct = false;
        this._directSize = '';
    }

    // 'idle' | 'countdown' | 'recording'
    get state() {
        if ( this._countdownTimer !== null ) return 'countdown';
        if ( this.isRecording() ) return 'recording';
        return 'idle';
    }

    isRecording() {
        return this._recorder !== null && this._recorder.state === 'recording';
    }

    isCountingDown() {
        return this._countdownTimer !== null;
    }

    get countdownRemaining() {
        return this._countdownRemaining;
    }

    get elapsedSeconds() {
        if ( !this.isRecording() ) return 0;
        return ( performance.now() - this._startTime ) / 1000;
    }

    /**
     * Hotkey (R) handler: arm the countdown, cancel a running countdown, or stop
     * an in-progress recording.
     */
    toggle() {
        switch ( this.state ) {
            case 'countdown':
                this.cancelCountdown();
                break;
            case 'recording':
                this.stop();
                break;
            default:
                this.startCountdown();
                break;
        }
    }

    startCountdown() {
        if ( this.state !== 'idle' ) return;

        if ( typeof MediaRecorder === 'undefined' ) {
            console.error( 'MediaRecorder is not supported in this browser' );
            return;
        }

        this._countdownRemaining = this.countdownSeconds;

        // Assign the timer before emitting so the HUD sees the 'countdown'
        // state on the very first tick.
        this._countdownTimer = setInterval( () => {
            this._countdownRemaining -= 1;

            if ( this._countdownRemaining > 0 ) {
                this._emit();
                return;
            }

            clearInterval( this._countdownTimer );
            this._countdownTimer = null;
            this._countdownRemaining = 0;
            this.start();
        }, 1000 );

        this._emit();
    }

    cancelCountdown() {
        if ( this._countdownTimer === null ) return;

        clearInterval( this._countdownTimer );
        this._countdownTimer = null;
        this._countdownRemaining = 0;
        console.log( 'Recording cancelled' );
        this._emit();
    }

    /**
     * Begin capturing immediately (no countdown).
     * @returns {boolean} True if recording started.
     */
    start() {
        if ( this.isRecording() ) {
            console.warn( 'Already recording' );
            return false;
        }

        // Copying the renderer's canvas into the capture canvas is a GPU
        // readback. It is only needed to scale an oversized frame down into the
        // capture bounds — when the canvas already fits, MediaRecorder can take
        // the WebGL canvas directly and the readback disappears entirely.
        const src = this.sourceCanvas;
        this._direct = this.preferDirectCapture
            && src.width > 0 && src.height > 0
            && src.width <= this.maxWidth
            && src.height <= this.maxHeight;

        if ( !this._direct ) this._matchSourceSize();

        const mimeType = MIME_TYPES.find( type => MediaRecorder.isTypeSupported( type ) );
        if ( !mimeType ) {
            console.error( 'No supported video MIME type found' );
            this._emit();
            return false;
        }

        this._mimeType = mimeType;
        this._chunks = [];

        let stream;
        let track = null;

        if ( this._direct ) {
            stream = src.captureStream( this.fps );
            this._directSize = `${src.width}x${src.height}`;
        } else {
            // Ask for frames on demand rather than letting the browser sample
            // the canvas on its own schedule: pacing the blit ourselves means
            // one readback per encoded frame instead of one per animation
            // frame. Browsers without requestFrame fall back to a timed stream.
            stream = this.canvas.captureStream( 0 );
            track = stream.getVideoTracks()[ 0 ];

            if ( !track || typeof track.requestFrame !== 'function' ) {
                stream = this.canvas.captureStream( this.fps );
                track = null;
            }
        }

        this._frameTrack = track;
        this._frameInterval = 1000 / this.fps;
        this._lastFrameTime = 0;

        try {
            this._recorder = new MediaRecorder( stream, {
                mimeType: mimeType,
                videoBitsPerSecond: this.bitrate * 1000000
            } );
        } catch ( e ) {
            console.error( 'Failed to create MediaRecorder:', e );
            this._recorder = null;
            this._emit();
            return false;
        }

        this._recorder.ondataavailable = ( e ) => {
            if ( e.data && e.data.size > 0 ) this._chunks.push( e.data );
        };

        this._recorder.onstop = () => this._download();

        this._recorder.onerror = ( e ) => {
            console.error( 'MediaRecorder error:', e );
            this._recorder = null;
            this._chunks = [];
            this._emit();
        };

        // Seed the first frame so the stream never starts on an empty canvas.
        if ( !this._direct ) this.update( true );

        this._recorder.start( 1000 ); // Collect data every second
        this._startTime = performance.now();

        const size = this._direct ? this._directSize : `${this.canvas.width}x${this.canvas.height}`;
        const path = this._direct ? 'direct' : 'scaled';
        console.log( `Recording started (${mimeType}, ${size} @ ${this.fps}fps, ${this.bitrate} Mbps, ${path})` );
        this._emit();
        return true;
    }

    stop() {
        if ( !this.isRecording() ) {
            console.warn( 'Not currently recording' );
            return;
        }

        const elapsed = this.elapsedSeconds;
        this._recorder.stop();
        console.log( `Recording stopped (${elapsed.toFixed( 1 )}s)` );
        this._emit();
    }

    /**
     * Copy the current renderer output into the capture canvas. Call once per
     * frame, right after `renderer.render()`.
     */
    update( force = false ) {
        if ( !force && !this.isRecording() ) return;

        const src = this.sourceCanvas;
        if ( !src.width || !src.height ) return;

        if ( this._direct ) {
            // MediaRecorder is reading the WebGL canvas itself, so there is
            // nothing to copy — but the stream is bound to that canvas's size.
            const size = `${src.width}x${src.height}`;
            if ( size !== this._directSize ) {
                console.warn( `Canvas resized to ${size} while recording; the video changes resolution mid-stream` );
                this._directSize = size;
            }
            return;
        }

        // Skip animation frames the encoder would never see.
        const now = performance.now();
        if ( !force ) {
            const elapsed = now - this._lastFrameTime;
            if ( elapsed < this._frameInterval ) return;
            // Hold the cadence, but don't try to catch up after a long stall.
            this._lastFrameTime = elapsed > this._frameInterval * 2
                ? now
                : this._lastFrameTime + this._frameInterval;
        } else {
            this._lastFrameTime = now;
        }

        const ctx = this.ctx;
        const dest = this.canvas;

        // Letterbox: only produces bars if the window aspect changed mid-take.
        const scale = Math.min( dest.width / src.width, dest.height / src.height );
        const dw = src.width * scale;
        const dh = src.height * scale;
        const dx = ( dest.width - dw ) / 2;
        const dy = ( dest.height - dh ) / 2;

        // drawImage covers the whole canvas unless there are bars to clear.
        if ( dx > 0.5 || dy > 0.5 ) {
            ctx.fillStyle = '#000';
            ctx.fillRect( 0, 0, dest.width, dest.height );
        }

        ctx.drawImage( src, dx, dy, dw, dh );

        if ( this._frameTrack ) this._frameTrack.requestFrame();
    }

    /**
     * Size the capture canvas to the renderer's drawing buffer, capped to the
     * configured maximum. Resolution is locked for the duration of the take
     * because MediaRecorder cannot handle a resize mid-stream.
     * @private
     */
    _matchSourceSize() {
        const sw = this.sourceCanvas.width || this.maxWidth;
        const sh = this.sourceCanvas.height || this.maxHeight;

        const scale = Math.min( 1, this.maxWidth / sw, this.maxHeight / sh );

        // Even dimensions keep H.264 encoders happy.
        this.canvas.width = Math.max( 2, Math.round( sw * scale / 2 ) * 2 );
        this.canvas.height = Math.max( 2, Math.round( sh * scale / 2 ) * 2 );
    }

    /**
     * @private
     */
    _download() {
        const chunks = this._chunks;
        const mimeType = this._mimeType;

        this._chunks = [];
        this._recorder = null;
        this._frameTrack = null;
        this._direct = false;

        if ( chunks.length === 0 ) {
            console.warn( 'No recording data to download' );
            this._emit();
            return;
        }

        const blob = new Blob( chunks, { type: mimeType } );
        const url = URL.createObjectURL( blob );

        const extension = mimeType.includes( 'mp4' ) ? 'mp4' : 'webm';
        const timestamp = new Date().toISOString().replace( /[:.]/g, '-' ).slice( 0, 19 );
        const filename = `capture_${timestamp}.${extension}`;

        const link = document.createElement( 'a' );
        link.style.display = 'none';
        link.href = url;
        link.download = filename;
        document.body.appendChild( link );
        link.click();
        document.body.removeChild( link );
        URL.revokeObjectURL( url );

        console.log( `Downloaded: ${filename}` );
        this._emit();
    }

    /**
     * @private
     */
    _emit() {
        this.onStateChange( this.state, this );
    }

    dispose() {
        this.cancelCountdown();
        if ( this.isRecording() ) this._recorder.stop();
        this._recorder = null;
        this._chunks = [];
    }
}
