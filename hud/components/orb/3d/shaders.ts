/**
 * GLSL shaders for the Nova 3D orb.
 * All shaders support a uSpeaking uniform (0–1) for animated speaking state.
 */

// ─── Particle (filament + spark) shaders ────────────────────────────────────

export const pointVertexShader = `
  uniform float uTime;
  uniform float uIntensity;
  uniform float uRadius;
  uniform float uSpeaking;
  attribute float aScale;
  attribute float aSeed;
  varying float vSeed;
  varying float vAlpha;

  void main() {
    vSeed = aSeed;
    vec3 p = position;

    // Drift outward/inward — amplitude and speed ramp up when speaking
    float speed  = 1.4 + uSpeaking * 2.6;
    float amp    = (0.034 + uSpeaking * 0.058) * uIntensity;
    float drift  = sin(uTime * speed + aSeed * 20.0) * amp;
    p += normalize(p) * drift;

    vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);

    // Per-particle size pulsing when speaking
    float sizePulse = 1.0 + uSpeaking * 0.38 * sin(uTime * 7.2 + aSeed * 6.28);
    float size = (4.5 + aScale * 10.0) * (uRadius / 2.0) * sizePulse;
    gl_PointSize = size * (1.0 / max(0.2, -mvPosition.z));
    gl_Position  = projectionMatrix * mvPosition;

    vAlpha = 0.36 + aScale * 0.64;
  }
`

export const pointFragmentShader = `
  uniform vec3  uColor;
  uniform float uIntensity;
  uniform float uSpeaking;
  varying float vSeed;
  varying float vAlpha;

  void main() {
    vec2  uv      = gl_PointCoord - vec2(0.5);
    float d       = length(uv);
    float glow    = smoothstep(0.5, 0.0, d);
    // Tight hotspot at center of each particle for sparkle feel
    float core    = smoothstep(0.16, 0.0, d);
    float sparkle = 0.58 + 0.42 * sin(vSeed * 120.0 + uIntensity * 2.0);
    float surge   = 1.0 + uSpeaking * 0.70;
    float alpha   = glow * vAlpha * sparkle * uIntensity * 1.18 * surge;
    if (alpha < 0.008) discard;
    // Lighten the very center of each particle
    vec3 col = uColor + core * 0.36;
    gl_FragColor = vec4(col, alpha);
  }
`

// ─── Core sphere shaders ─────────────────────────────────────────────────────

export const coreVertexShader = `
  varying vec3 vNormal;
  varying vec3 vWorldPos;
  varying vec3 vViewDir;

  void main() {
    vNormal   = normalize(normalMatrix * normal);
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorldPos  = world.xyz;
    // Real view-space direction for accurate fresnel
    vViewDir   = normalize(cameraPosition - world.xyz);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

export const coreFragmentShader = `
  uniform float uTime;
  uniform vec3  uCoreColor;
  uniform vec3  uAccentColor;
  uniform float uIntensity;
  uniform float uSpeaking;
  varying vec3  vNormal;
  varying vec3  vWorldPos;
  varying vec3  vViewDir;

  float hash31(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.yzx + 31.32);
    return fract((p.x + p.y) * p.z);
  }

  void main() {
    vec3  N = normalize(vNormal);
    vec3  V = normalize(vViewDir);
    // View-space fresnel — rim brightens toward edge
    float fresnel = pow(1.0 - abs(dot(N, V)), 2.4);

    // Breathing pulse + fast speaking pulse layered on top
    float breathe    = 0.84 + 0.24 * sin(uTime * 2.1);
    float speakPulse = 1.0  + uSpeaking * 0.55 * sin(uTime * 8.8);
    float pulse      = breathe * speakPulse;

    // Turbulent surface noise
    float noise = hash31(vWorldPos * 2.3 + vec3(uTime * 0.22));
    // Flow lines — run faster when speaking
    float flowSpeed = 0.8 + uSpeaking * 1.8;
    float flow      = sin((vWorldPos.y + uTime * flowSpeed) * 7.0) * 0.07 + 0.07;

    vec3 color  = mix(uCoreColor, uAccentColor, noise * 0.36 + fresnel * 0.54 + flow);
    color      *= 1.20 + uSpeaking * 0.20;

    float alpha = (0.60 + fresnel * 0.50) * pulse * uIntensity;
    gl_FragColor = vec4(color, alpha);
  }
`
