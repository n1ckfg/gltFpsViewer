// Photoshop-style levels adjustment, used as the final post-processing pass.
//
// It runs after OutputPass, so it operates on display-referred sRGB values —
// the same space the numbers in an image editor's Levels dialog refer to.
// Applying it in linear space instead would make the gamma control wildly
// non-linear and the black/white points behave unlike the editor equivalents.

export const LevelsShader = {

    name: 'LevelsShader',

    uniforms: {
        'tDiffuse': { value: null },
        'blackPoint': { value: 0.0 },
        'whitePoint': { value: 1.0 },
        'gamma': { value: 1.0 }
    },

    vertexShader: /* glsl */`

        varying vec2 vUv;

        void main() {

            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );

        }`,

    fragmentShader: /* glsl */`

        uniform sampler2D tDiffuse;
        uniform float blackPoint;
        uniform float whitePoint;
        uniform float gamma;

        varying vec2 vUv;

        void main() {

            vec4 texel = texture2D( tDiffuse, vUv );

            // Remap [blackPoint, whitePoint] onto [0, 1], then bend the midtones.
            float range = max( whitePoint - blackPoint, 0.0001 );
            vec3 color = clamp( ( texel.rgb - blackPoint ) / range, 0.0, 1.0 );
            color = pow( color, vec3( 1.0 / max( gamma, 0.0001 ) ) );

            gl_FragColor = vec4( color, texel.a );

        }`

};
