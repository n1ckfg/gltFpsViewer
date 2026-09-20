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
        this.onStateChange = options.onStateChange ?? ( () => {} );

        this.canvas = document.createElement( 'canvas' );
        this.canvas.width = this.maxWidth;
        this.canvas.height = this.maxHeight;
        this.ctx = this.canvas.getContext( '2d' );

        this._recorder = null;
        this._chunks = [];
        this._mimeType = null;
        this._countdownTimer = null;
        this._countdownRemaining = 0;
        this._startTime = 0;
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
     * Space bar handler: arm the countdown, cancel a running countdown, or stop
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

        this._matchSourceSize();

        const mimeType = MIME_TYPES.find( type => MediaRecorder.isTypeSupported( type ) );
        if ( !mimeType ) {
            console.error( 'No supported video MIME type found' );
            this._emit();
            return false;
        }

        this._mimeType = mimeType;
        this._chunks = [];

        const stream = this.canvas.captureStream( this.fps );

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
        this.update( true );

        this._recorder.start( 1000 ); // Collect data every second
        this._startTime = performance.now();

        console.log( `Recording started (${mimeType}, ${this.canvas.width}x${this.canvas.height} @ ${this.fps}fps, ${this.bitrate} Mbps)` );
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

        const ctx = this.ctx;
        const dest = this.canvas;

        // Letterbox: only produces bars if the window aspect changed mid-take.
        const scale = Math.min( dest.width / src.width, dest.height / src.height );
        const dw = src.width * scale;
        const dh = src.height * scale;
        const dx = ( dest.width - dw ) / 2;
        const dy = ( dest.height - dh ) / 2;

        ctx.fillStyle = '#000';
        ctx.fillRect( 0, 0, dest.width, dest.height );
        ctx.drawImage( src, dx, dy, dw, dh );
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
