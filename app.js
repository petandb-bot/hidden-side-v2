/* HIDDEN SIDE v0.4.13 / V2 | p5.js 1.11.13 | WebGL1 | local GPU processing */
'use strict';

const $ = (id) => document.getElementById(id);
const dom = {};
const isTouchDevice = /iPad|iPhone|iPod|Android/i.test(navigator.userAgent);
const MAX_RECORD_SECONDS = 45;
const PERFORMANCE = {
  eco: { preview: 520, video: 720, fps: 24 },
  balanced: { preview: 720, video: 960, fps: 24 },
  fine: { preview: 960, video: 1280, fps: 30 }
};
const OUTPUT_PRESETS = {
  standard: { photo: 2048, video: 1280, history: 640, bitrate: 6000000 },
  high: { photo: 3072, video: 1920, history: 960, bitrate: 10000000 },
  max: { photo: 4096, video: 2560, history: 1280, bitrate: 16000000 }
};
const PREVIEW_PHOTO_SOURCE = 2048;
const PREVIEW_HISTORY_EDGE = 448;


const state = {
  type: 'none', element: null, fileName: '', objectUrl: null,
  mode: 0, seed: 11.726, depth: 0.50, erosion: 0.36, drift: 0.22,
  modeVariants: [0,0,0,0,0], macro: 0, trail: 0.55, accidentEnabled: true,
  accidentLevels: [0.42, 0.48, 0.55, 0.36],
  structure: { family: 0, angle: 0, scale: 1.0, warp: 0.4,
    offsetX: 0, offsetY: 0, bias: 0, amount: 0 },
  accident: { kind: 0, x: 0.5, y: 0.5, nextAt: 0,
    startAt: 0, duration: 0, intensity: 0, active: false, manualPreview: false },
  w: 4, h: 4, originalW: 4, originalH: 4,
  renderW: 4, renderH: 4, sourceW: 0, sourceH: 0,
  quality: 'balanced', outputQuality: 'high', renderPurpose: 'preview', isExporting: false,
  frameDirty: false, frameTime: -1, imageReady: false,
  videoReady: false, isRecording: false, recordStarting: false, recorder: null, stream: null,
  recordStartedAt: 0, recordDuration: 0, recordedBlob: null, recordedName: '',
  pointer: [0.5, 0.5], touchForce: 0, touchTarget: 0,
  kinetic: 0, kineticTarget: 0, pointerTime: 0, pointerIsDown: false,
  activeURL: null, firstDraw: true, renderingError: false,
  historyReady: false, historyW: 0, historyH: 0,
  lastRenderTime: 0, sourceGeneration: 0, importGeneration: 0
};

let gl, canvas, program, sourceTexture, buffer, sourceCanvas, sourceCtx, u;
let feedbackTextures = [], feedbackFramebuffer = null, feedbackReadIndex = 0;
let aPosition = -1, aUv = -1;
let lastTimestamp = performance.now();
function setup() {
  setAttributes({ version: 1, alpha: false, depth: false, stencil: false,
    antialias: false, preserveDrawingBuffer: true });
  pixelDensity(1);
  const p5Canvas = createCanvas(4, 4, WEBGL);
  p5Canvas.parent('canvas-host');
  canvas = p5Canvas.elt;
  frameRate(PERFORMANCE[state.quality].fps);
  try { initGL(); }
  catch (error) {
    state.renderingError = true;
    setStatus(`GPU INIT FAILED: ${error.message}`, true);
    console.error(error);
  }
  resizePreview();
  canvas.addEventListener('webglcontextlost', event => {
    event.preventDefault();
    state.renderingError = true;
    if (state.isRecording) stopRecording();
    setStatus('GPU CONTEXT LOST', true);
  });
  canvas.addEventListener('webglcontextrestored', () => {
    try {
      initGL();
      if (state.imageReady) {
        allocateSourceTexture(state.sourceW, state.sourceH);
        state.frameDirty = true;
      }
      initFeedback();
      state.renderingError = false;
      setStatus('GPU RESTORED');
    } catch (error) { setStatus(`GPU RESTORE FAILED: ${error.message}`, true); }
  });
}

function draw() {
  // A PNG export renders at a temporary resolution; the preview loop must not overwrite it.
  if (!gl || state.renderingError || state.isExporting) return;
  if (document.hidden) return;
  if (state.type === 'none' || !state.imageReady) {
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0.036, 0.034, 0.033, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    return;
  }

  const now = performance.now();
  const dt = Math.min((now - lastTimestamp) / 1000, 0.1);
  lastTimestamp = now;
  state.touchForce += (state.touchTarget - state.touchForce) * Math.min(1, dt * 11);
  state.kinetic += (state.kineticTarget - state.kinetic) * Math.min(1, dt * 7);
  if (!state.pointerIsDown) state.kineticTarget *= Math.exp(-dt*13);

  try {
    if (state.type === 'video' && state.element && state.element.readyState >= 2) {
      const current = state.element.currentTime;
      if (state.frameDirty || (current !== state.frameTime && !state.element.seeking)) {
        sourceCtx.drawImage(state.element, 0, 0, state.sourceW, state.sourceH);
        uploadSource();
        state.frameDirty = false;
        state.frameTime = current;
      }
      $('timecode').textContent = secondsToClock(current);
      if (state.isRecording && (current >= MAX_RECORD_SECONDS ||
          (Number.isFinite(state.element.duration) && current >= state.element.duration - 0.025))) {
        stopRecording();
      }
    } else if (state.type === 'photo' && state.frameDirty) {
      sourceCtx.drawImage(state.element, 0, 0, state.sourceW, state.sourceH);
      uploadSource();
      state.frameDirty = false;
    }
    updateAccident(now);
    renderFrame(now * 0.001);
    if (state.isRecording && (now - state.recordStartedAt) >= MAX_RECORD_SECONDS * 1000) {
      stopRecording();
    }
  } catch (error) {
    if (state.type === 'video') state.frameDirty = true;
    if (!state.renderingError) {
      setStatus(`RENDER FAILED: ${error.message}`, true);
      console.error(error);
      if (state.type !== 'video') state.renderingError = true;
    }
  }
}

const VERTEX_SHADER = `
  precision highp float;
  attribute vec2 a_position;
  attribute vec2 a_uv;
  varying vec2 v_uv;
  void main() {
    v_uv = a_uv;
    gl_Position = vec4(a_position, 0.0, 1.0);
  }
`;

const FRAGMENT_SHADER = `
  precision highp float;
  varying vec2 v_uv;
  uniform sampler2D u_source;
  uniform sampler2D u_history;
  uniform float u_historyMix;
  uniform float u_memory;
  uniform float u_trailRetention;
  uniform vec2 u_texel;
  uniform vec2 u_resolution;
  uniform vec2 u_pointer;
  uniform float u_touch;
  uniform float u_kinetic;
  uniform float u_time;
  uniform float u_seed;
  uniform float u_mode;
  uniform float u_variant;
  uniform float u_macro;
  uniform float u_depth;
  uniform float u_erosion;
  uniform float u_drift;
  uniform vec4 u_structureA;
  uniform vec4 u_structureB;
  uniform vec4 u_accident;

  float sat(float v) { return clamp(v, 0.0, 1.0); }
  vec3 sat3(vec3 v) { return clamp(v, 0.0, 1.0); }
  float lum(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 345.45));
    p += dot(p, p + 34.345);
    return fract(p.x * p.y);
  }
  float noise2(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 s = f*f*(3.0-2.0*f);
    return mix(mix(hash21(i),hash21(i+vec2(1.0,0.0)),s.x),
               mix(hash21(i+vec2(0.0,1.0)),hash21(i+vec2(1.0,1.0)),s.x),s.y);
  }
  float fbm(vec2 p) {
    float n = 0.0;
    float a = 0.5;
    for (int i=0; i<4; i++) {
      n += a*noise2(p);
      p = p*2.07 + vec2(12.3,5.4);
      a *= 0.5;
    }
    return n;
  }
  vec3 src(vec2 uv) {
    return texture2D(u_source, clamp(uv, vec2(0.001), vec2(0.999))).rgb;
  }
  vec3 past(vec2 uv) {
    return texture2D(u_history, clamp(uv, vec2(0.001), vec2(0.999))).rgb;
  }

  void main() {
    vec2 uv = v_uv;
    vec2 aspect = vec2(u_resolution.x/u_resolution.y,1.0);
    float d = u_depth;
    float e = u_erosion;
    float variant = u_variant;
    float macro = u_macro;
    float t = u_time * (0.62 + u_drift * 0.70);
    float kinetic = sat(u_kinetic);
    vec2 q = uv - vec2(0.5);
    float ca = cos(u_structureA.y);
    float sa = sin(u_structureA.y);
    vec2 axis = vec2(q.x*ca-q.y*sa, q.x*sa+q.y*ca);
    float structureField = 0.0;
    float structureRidge = 0.0;
    if (u_structureA.w > 0.001) {
    vec2 soil = axis*(1.9+u_structureA.z*1.1) + u_structureB.xy;
    float foldNoise = noise2(soil*vec2(1.05,1.65)+vec2(u_seed*0.06,t*0.032));
    float softNoise = fbm(soil*0.82 + vec2(0.0, u_seed*0.04));
    if (u_structureA.x < 0.5) {
      float bands = sin((soil.y+(foldNoise-0.5)*u_structureB.z)*6.6);
      structureField = bands*0.22 + (softNoise-0.5)*0.30;
      structureRidge = smoothstep(0.84,0.98,0.5+0.5*cos((soil.y+(softNoise-0.5))*6.6));
    } else if (u_structureA.x < 1.5) {
      float shear = soil.x*0.72 + (foldNoise-0.5)*u_structureB.z*0.95 + softNoise*0.55;
      structureField = (softNoise-0.5)*0.52 + 0.22*(shear*1.6/(1.0+abs(shear*1.6)));
      structureRidge = exp(-abs(shear)*3.4) * (0.45+0.55*smoothstep(0.38,0.72,softNoise));
    } else if (u_structureA.x < 2.5) {
      float ring = length(soil*vec2(0.92,1.10))+(foldNoise-0.5)*u_structureB.z*0.55;
      float curve = sin(ring*5.1 + softNoise*2.2);
      structureField = curve*0.20 + (softNoise-0.5)*0.26;
      structureRidge = smoothstep(0.80,0.97,0.5+0.5*cos(ring*5.1));
    } else if (u_structureA.x < 3.5) {
      vec2 cell = floor(soil*1.35);
      float zone = noise2(cell+u_seed*0.12);
      structureField = (zone-0.5)*0.48 + (softNoise-0.5)*0.22;
      structureRidge = smoothstep(0.70,0.92,softNoise) * (0.45+0.55*zone);
    } else if (u_structureA.x < 4.5) {
      float radius = length(soil*vec2(0.92,1.08));
      float lensCore = 1.0 / (1.0 + radius*radius*(1.8 + u_structureB.z*0.7));
      float lensRipple = sin(radius*(7.2 + u_structureB.z*2.8) - softNoise*2.4 + foldNoise*1.7);
      structureField = (lensCore-0.40)*0.72 + lensRipple*0.14 + (softNoise-0.5)*0.16;
      structureRidge = smoothstep(0.66,0.94,lensCore + lensRipple*0.10);
    } else {
      float stream = sin(soil.x*(4.2 + u_structureB.z*2.1) + softNoise*2.6 + foldNoise*1.4);
      float driftNoise = noise2(vec2(soil.y*1.6 + t*0.03, soil.x*0.52 + u_seed*0.14));
      structureField = stream*0.24 + (driftNoise-0.5)*0.24 + (softNoise-0.5)*0.18;
      structureRidge = smoothstep(0.80,0.98,0.5+0.5*stream) * smoothstep(0.34,0.78,driftNoise);
    }
    structureField = clamp(structureField,-1.0,1.0)*u_structureA.w;
    structureRidge *= 0.72*u_structureA.w;
    }
    vec2 field = uv*vec2(5.7,9.1) + vec2(u_seed,u_seed*0.31);
    float n = fbm(field + vec2(t*0.20,-t*0.14));
    float medium = fbm(field*2.6 - vec2(t*0.24,-t*0.17));
    float micro = hash21(floor(uv*u_resolution*0.48) + u_seed*13.5);
    float dist = length((uv-u_pointer)*aspect);
    float probe = exp(-dist*dist/(0.018+d*0.012)) * u_touch;
    float gesture = probe*(0.34+kinetic*0.48);

    vec2 flow = vec2(noise2(field*1.35+t*0.28)-0.5,
                     noise2(field*1.28+12.8-t*0.25)-0.5);
    float baseDisp = 0.0012 + e*0.0082 + variant*0.0015;
    vec2 displaced = uv + flow*baseDisp*(0.22+u_drift*0.70);
    displaced += flow*gesture*(0.013 + kinetic*0.030 + variant*0.006);
    displaced += vec2(flow.y, -flow.x)*structureField*(0.0022+e*0.0038);
    float incident = 0.0;
    if (u_accident.x>0.001) {
      vec2 incidentDelta = (uv-u_accident.zw)*aspect;
      incident = u_accident.x * exp(-dot(incidentDelta,incidentDelta)*6.0);
    }
    if(u_accident.x>0.001 && u_accident.y<0.5) {
      vec2 shardCell = floor((uv + vec2(structureField*0.03, medium*0.03))*vec2(18.0, 24.0));
      float faultGate = smoothstep(0.78,0.95,noise2(shardCell + u_seed));
      displaced.x += (faultGate-0.5)*incident*(0.010+e*0.030);
      displaced.y += (noise2(shardCell*0.7 + 9.1)-0.5)*incident*(0.004+e*0.012);
    }
    if(u_accident.x>0.001 && u_accident.y>=2.5) {
      displaced += vec2(flow.y,-flow.x)*incident*(0.020+e*0.065);
    }
    if(u_mode>3.5) {
      float row = floor(uv.y*118.0+t*(1.1+0.4*variant));
      float breakup = step(0.980-0.024*e-0.020*variant,hash21(vec2(row,floor(t*0.5)+u_seed)));
      displaced.x += breakup*(noise2(vec2(row,t+u_seed))-0.5)*e*(0.022+0.020*variant);
    }
    if(macro>0.5) {
      if(u_mode < 0.5) {
        float slipNoise = fbm(axis*vec2(1.4,4.8) + vec2(t*0.06, u_seed*0.10));
        float slipMask = smoothstep(0.60,0.82, slipNoise + structureRidge*0.18);
        vec2 slipVec = vec2(noise2(uv*vec2(3.0,8.0)+vec2(t*0.05,u_seed*0.12))-0.5,
                            noise2(uv*vec2(2.6,6.4)-vec2(t*0.04,u_seed*0.09))-0.5);
        displaced += slipVec*(0.004+0.012*e)*slipMask;
        displaced += vec2(flow.y,-flow.x)*(slipNoise-0.5)*(0.003+0.008*e)*slipMask;
      } else if(u_mode < 3.5 && u_mode >= 2.5) {
        float poolNoise = fbm(field*0.42 + vec2(t*0.04, -t*0.03) + vec2(u_seed*0.05, u_seed*0.08));
        float poolMask = smoothstep(0.52,0.84, poolNoise + medium*0.12);
        vec2 eddy = vec2(noise2(field*0.36+vec2(t*0.03,u_seed*0.07))-0.5,
                         noise2(field*0.30-vec2(t*0.025,u_seed*0.06))-0.5);
        displaced += eddy*(0.002+0.006*e)*poolMask;
      } else {
        vec2 blockGrid = floor(uv*(18.0+28.0*d))/(18.0+28.0*d);
        float blockNoise = noise2(blockGrid*vec2(8.0,11.0)+vec2(t*0.10,u_seed*0.08));
        float shearNoise = noise2(blockGrid*vec2(13.0,6.0)-vec2(t*0.08,u_seed*0.04));
        displaced += vec2((blockNoise-0.5),(shearNoise-0.5))*(0.003+0.010*e);
        displaced += vec2(flow.y,-flow.x)*(blockNoise-0.5)*(0.004+0.012*e);
      }
    }
    displaced = clamp(displaced,vec2(0.001),vec2(0.999));
    vec3 c = src(displaced);
    float l = lum(c);
    vec2 stepUV = u_texel*(1.10+1.12*d+0.18*variant);
    float gx = lum(src(displaced+vec2(stepUV.x,0.0))) - lum(src(displaced-vec2(stepUV.x,0.0)));
    float gy = lum(src(displaced+vec2(0.0,stepUV.y))) - lum(src(displaced-vec2(0.0,stepUV.y)));
    float edge = sat(length(vec2(gx,gy))*(2.6+3.8*d+0.4*variant));
    float outline = smoothstep(0.16,0.44,edge);
    float organ = sat(n*0.74+medium*0.26 + structureField*0.05);
    vec3 color = c;
    vec2 ghostPastUv = uv;
    float corridor = 0.5;

    if (u_mode<0.5) {
      float bedding = sin(axis.y*(7.0+4.0*d) + medium*1.9 + structureField*1.2);
      float fractureNoise = noise2(uv*vec2(2.1,5.1)+vec2(t*(0.04+0.01*variant),u_seed*0.19));
      float fault = smoothstep(0.47-0.02*variant,0.66,fractureNoise+outline*(0.04+0.04*variant));
      float stratum = l + structureField*(0.10+0.07*e) + (organ-0.5)*(0.10+0.18*e+0.05*variant)
                    + bedding*(0.06+0.06*d) + (fault-0.5)*e*(0.08+0.07*variant) + (micro-0.5)*e*0.02;
      stratum += gesture*(0.05+0.06*e)*(0.4+fault*0.6);
      float a = smoothstep(0.20-0.04*d,0.43-0.04*d,stratum);
      float b = smoothstep(0.45-0.03*d,0.67-0.03*d,stratum);
      float top = smoothstep(0.64-0.02*d,0.82-0.02*d,stratum+medium*0.05);
      vec3 ink = mix(vec3(0.028,0.026,0.038), vec3(0.040,0.028,0.050), variant);
      vec3 stone = mix(vec3(0.22,0.16,0.18), vec3(0.30,0.20,0.28), variant);
      vec3 chalk = vec3(0.77,0.69,0.65);
      vec3 mineral = mix(vec3(0.44,0.42,0.15), vec3(0.54,0.56,0.14), variant);
      color = mix(ink,stone,a);
      color = mix(color,chalk,b);
      float seamLight = top*(smoothstep(0.34,0.72,medium)*0.44 + outline*(0.16+0.08*variant));
      color = mix(color,mineral,sat(seamLight)*(0.34+0.12*variant));
      color = mix(color,vec3(0.018,0.018,0.022),outline*(0.34+0.10*d));
      color += (micro-0.5)*(0.020+0.015*variant)*e;
      color = mix(color, vec3(l), 0.05);
      color = mix(color, c, 0.08-0.03*variant);
      color = mix(color,mineral,structureRidge*(0.09+0.11*e));
      if(macro>0.5) {
        float crumbleNoise = fbm(axis*vec2(1.5,4.4)+vec2(t*0.05,u_seed*0.13));
        float crumble = smoothstep(0.60,0.82, crumbleNoise + structureRidge*0.18);
        vec2 crumbleShift = vec2(0.003+0.010*e,-0.001-0.004*e) * crumble;
        vec3 crumbleSample = src(clamp(displaced + crumbleShift, vec2(0.001), vec2(0.999)));
        color = mix(color, crumbleSample*vec3(0.88,0.84,0.82), crumble*(0.05+0.10*e));
        color = mix(color, vec3(0.10,0.07,0.08), crumble*(0.04+0.10*e));
        float exposed = smoothstep(0.44,0.82,outline + medium*0.16 + crumbleNoise*0.10);
        color = mix(color, mineral, exposed*(0.05+0.12*e));
      }
      if(variant>0.5) {
        float seamNoise = fbm(axis*vec2(1.0,2.8)+vec2(t*0.04,u_seed*0.10));
        float seam = smoothstep(0.62,0.79,seamNoise + structureRidge*0.14 + outline*0.05);
        vec2 slipVec = vec2(0.004+0.012*e,-0.002-0.006*e);
        vec3 slipSample = src(clamp(displaced + slipVec*seam + flow*0.003, vec2(0.001), vec2(0.999)));
        color = mix(color, slipSample*vec3(0.90,0.86,0.92), seam*(0.06+0.10*e));
        color = mix(color, vec3(0.10,0.05,0.16), seam*(0.07+0.08*e));
        float buriedFault = smoothstep(0.36,0.74,n+structureField*0.14+outline*0.10);
        color = mix(color,vec3(0.12,0.08,0.16),buriedFault*(0.04+0.08*e));
      }
      if(u_historyMix>0.5) {
        vec3 remnant = past(uv+flow*(0.0015+0.004*e+0.003*variant));
        color = mix(color,remnant,(0.08+0.05*d+0.04*variant)*u_memory);
      }
    } else if (u_mode<1.5) {
      vec3 neg = pow(sat3(1.0-c), vec3(0.97+0.06*d-0.05*variant));
      color = mix(neg, vec3(0.92,0.94,0.96), 0.03+0.05*variant);
      float silver = smoothstep(0.24,0.76,l)*(1.0-smoothstep(0.74,0.96,l));
      color = mix(color, vec3(0.42,0.36,0.38), silver*(0.05+0.08*d));
      float latentCenter = 0.43 + 0.08*noise2(vec2(t*0.06+u_seed,4.1)) + structureField*0.04;
      float latent = exp(-pow((l-latentCenter)/(0.09+0.02*variant), 2.0));
      latent *= (0.10+0.16*e+0.08*variant);
      color = mix(color, mix(vec3(0.95,0.95,0.91), vec3(0.98,0.98,0.95), variant), latent);
      float halation = smoothstep(0.18,0.62,outline) * smoothstep(0.46,0.92,l);
      vec3 coolEdge = mix(vec3(0.26,0.60,0.78), vec3(0.42,0.76,0.94), variant);
      color = mix(color, coolEdge, halation*(0.08+0.10*e+0.05*variant));
      vec2 fringeDir = normalize(vec2(gx,gy)+vec2(0.0001));
      vec2 fringe = fringeDir*u_texel*(1.6+4.0*e+2.0*variant);
      color.r += (src(displaced+fringe).r-c.r)*(0.04+0.05*variant)*e;
      color.b += (src(displaced-fringe).b-c.b)*(0.04+0.06*variant)*e;
      color = mix(color, vec3(l)*0.84+vec3(0.11), 0.04);
      color = mix(color, c, 0.18-0.08*variant);
      color = mix(color, vec3(0.95,0.97,0.99), gesture*(0.07+0.06*d));
      if(variant>0.5) {
        float bleach = smoothstep(0.60,0.96,l+outline*0.15);
        float solar = smoothstep(0.36,0.56,l) * (1.0-smoothstep(0.56,0.74,l));
        color = mix(color, vec3(0.985,0.985,0.97), bleach*(0.10+0.18*e));
        color = mix(color, vec3(0.14,0.16,0.22), solar*(0.08+0.12*e));
      }
      if(macro>0.5) {
        vec2 offsetA = vec2((noise2(floor(uv*vec2(18.0,12.0))+u_seed)-0.5)*(0.004+0.012*e), 0.0);
        vec3 glitchA = src(clamp(displaced+offsetA, vec2(0.001), vec2(0.999)));
        color = mix(color, vec3(glitchA.r, color.g, glitchA.b), 0.06+0.10*e);
      }
    } else if (u_mode<2.5) {
      float angle = t*(0.13+0.04*variant)+u_seed*0.07;
      vec3 lightDirection = normalize(vec3(-0.58*cos(angle)-0.20,
                                            0.44*sin(angle*0.74+0.6)+0.22,0.80));
      vec3 normal = normalize(vec3(-gx*(2.8+d*5.6+1.0*variant),-gy*(2.8+d*5.6+1.0*variant),0.62+0.12*(1.0-d)));
      float light = sat(dot(normal,lightDirection)*0.56+0.38);
      vec3 baseStone = mix(vec3(0.12,0.12,0.14), vec3(0.70,0.67,0.63), light);
      float elevation = l + (organ-0.5)*(0.05+0.06*variant)*e + gesture*(0.04+0.05*e) + structureField*0.06;
      vec3 warmLift = vec3(0.88,0.85,0.80) * smoothstep(0.52,0.88,elevation) * (0.22+0.12*variant);
      float spec = pow(max(dot(reflect(-lightDirection, normal), vec3(0.0,0.0,1.0)), 0.0), 10.0+16.0*variant);
      float rim = pow(1.0-sat(dot(normal, vec3(0.0,0.0,1.0))), 1.6);
      color = baseStone + warmLift;
      color = mix(color, vec3(0.05,0.05,0.06), outline*(0.08+0.05*variant));
      color += vec3(0.20,0.20,0.24) * spec * (0.10+0.16*d);
      color += vec3(0.12,0.14,0.20) * rim * (0.03+0.08*variant);
      color += (micro-0.5)*e*(0.02+0.02*variant);
      color = mix(color, vec3(0.84,0.84,0.90), structureRidge*(0.03+0.05*e));
      if(variant>0.5) {
        float prism = smoothstep(0.18,0.46,edge) * smoothstep(0.42,0.86,light);
        color += vec3(0.14,0.10,0.20) * prism * (0.05+0.11*e);
        color += vec3(0.06,0.11,0.16) * prism * (0.04+0.08*d);
      }
      if(macro>0.5) {
        float snap = smoothstep(0.62,0.90,noise2(floor(uv*vec2(20.0,14.0))+u_seed));
        color += vec3(0.10,0.10,0.12) * snap * (0.04+0.08*e);
      }
      color = mix(color, c, 0.12-0.04*variant);
    } else if (u_mode<3.5) {
      vec2 seepFlow = flow*(0.7+0.6*e) + vec2(noise2(field*0.42+t*0.03)-0.5, noise2(field*0.36-t*0.02)-0.5)*0.35;
      vec3 wetA = src(clamp(displaced + seepFlow*(0.010+0.016*e), vec2(0.001), vec2(0.999)));
      vec3 wetB = src(clamp(displaced - seepFlow*(0.008+0.012*e), vec2(0.001), vec2(0.999)));
      float liquid = l + structureField*(0.10+0.07*e) + (organ-0.50)*(0.18*e+0.10*variant)-outline*(0.05-0.02*variant);
      liquid += (noise2(field*0.48 + vec2(t*0.04,-t*0.02))-0.5)*e*(0.08+0.10*variant);
      liquid -= gesture*(0.05+0.09*e);
      float stain = smoothstep(0.24-0.08*d,0.56,liquid);
      float bloom = smoothstep(0.46-0.03*variant,0.76,liquid+medium*(0.10+0.08*variant));
      vec3 black = vec3(0.030,0.030,0.038);
      vec3 plum = mix(vec3(0.30,0.20,0.42), vec3(0.38,0.24,0.50), variant);
      vec3 pallid = mix(vec3(0.82,0.79,0.82), vec3(0.88,0.84,0.88), variant);
      color = mix(black,plum,stain);
      color = mix(color,pallid,bloom);
      float seep = smoothstep(0.54-0.04*variant,0.82,organ+outline*(0.10+0.10*variant))*(1.0-smoothstep(0.82,1.0,l));
      color = mix(color,mix(vec3(0.44,0.48,0.18), vec3(0.58,0.62,0.22), variant),seep*(0.08+0.20*e+0.10*variant));
      color = mix(color, wetA, 0.08+0.12*e);
      color = mix(color, wetB, 0.05+0.10*e);
      float film = smoothstep(0.42,0.84,organ+medium*0.14);
      color = mix(color, vec3(0.90,0.84,0.92), variant*film*(0.04+0.10*e));
      color *= (1.0-(0.12-0.03*variant)*outline);
      color += (micro-0.5)*(0.04+0.03*variant)*e;
      color = mix(color, c, 0.06-0.02*variant);
      color = mix(color,plum,structureRidge*(0.08+0.10*e));
      if(variant>0.5) {
        float thickness = l+0.16*medium+0.08*structureField+0.05*n;
        float interference = 0.5+0.5*sin(thickness*28.0+t*0.15+u_seed*0.5);
        float membrane = smoothstep(0.30,0.70,organ)*(1.0-0.36*outline);
        vec3 iridescent = mix(vec3(0.26,0.38,0.52),vec3(0.74,0.60,0.70),interference);
        color = mix(color,iridescent,membrane*(0.10+0.20*e));
      } else {
        float capillary = smoothstep(0.24,0.58,outline+abs(structureField)*0.10);
        color = mix(color,vec3(0.14,0.10,0.18),capillary*(0.10+0.16*e));
      }
      if(macro>0.5) {
        float hollowNoise = fbm(field*0.46 + vec2(t*0.04,-t*0.03) + vec2(u_seed*0.08,u_seed*0.04));
        float hollow = smoothstep(0.54,0.84, hollowNoise + organ*0.10 - outline*0.05);
        float pulse = 0.5 + 0.5*sin(t*0.34 + medium*4.2 + u_seed*0.6);
        float hollowMask = hollow*(0.40 + 0.60*pulse)*(1.0-0.32*outline);
        vec3 shadowTint = mix(vec3(0.08,0.06,0.10), vec3(0.12,0.08,0.16), variant);
        color = mix(color, shadowTint, hollowMask*(0.08+0.16*e));
        vec3 soak = src(clamp(displaced + seepFlow*(0.012+0.018*e)*hollowMask, vec2(0.001), vec2(0.999)));
        color = mix(color, soak, hollowMask*(0.04+0.08*e));
        color = mix(color, vec3(0.90,0.86,0.92), hollowMask*(0.03+0.06*variant));
      }
      if(u_historyMix>0.5) {
        vec3 residue = past(uv+flow*(0.003+0.010*e+0.010*variant));
        float pooling = (0.24+0.14*d+0.12*variant)*u_memory*(0.92+0.08*outline);
        color = mix(color,residue,pooling);
      }
    } else {
      vec2 chromaShift = vec2(0.0009+0.0027*e+0.0011*variant,0.0008+0.0018*e+0.0009*variant);
      chromaShift *= vec2(sin(t*(0.18+0.03*variant)+u_seed)*0.16+0.84,cos(t*(0.17+0.03*variant)+u_seed)*0.15+0.85);
      vec2 colorDrift = flow*(0.0018+0.0034*e+0.0016*variant) + vec2(-flow.y, flow.x)*(0.0008+0.0016*e);
      vec2 meltShift = flow*(0.006+0.010*e+0.003*variant);
      vec3 nearA = src(displaced + chromaShift + colorDrift);
      vec3 nearB = src(displaced - chromaShift*0.64 - colorDrift*0.48);
      vec3 nearC = src(displaced + vec2(-chromaShift.y, chromaShift.x)*0.56 + flow*0.0020);
      vec3 meltA = src(clamp(displaced + meltShift, vec2(0.001), vec2(0.999)));
      vec3 meltB = src(clamp(displaced - meltShift*0.72, vec2(0.001), vec2(0.999)));
      vec3 meltC = src(clamp(displaced + vec2(meltShift.y, -meltShift.x)*0.58, vec2(0.001), vec2(0.999)));
      vec3 melted = (c + meltA + meltB + meltC) * 0.25;
      corridor = fbm(uv*vec2(10.0,4.0)+vec2(-t*(0.10+0.03*variant),u_seed));
      float spreadMix = 0.07 + 0.05*e + 0.04*variant;
      float meltMix = 0.08 + 0.12*e + 0.05*variant;
      vec3 chromaVeil = vec3(nearA.r*0.82 + melted.r*0.18,
                             c.g*0.62 + nearB.g*0.22 + nearC.b*0.16,
                             nearB.b*0.72 + melted.b*0.28);
      color = mix(c, melted, meltMix);
      color = mix(color, chromaVeil, spreadMix);
      float lightBloom = smoothstep(0.44,0.92,l+outline*0.10);
      float edgeBloom = smoothstep(0.12,0.46,edge);
      float silhouetteHold = 1.0 - edgeBloom*0.36;
      color += vec3(0.10,0.03,0.14) * lightBloom * (0.018 + 0.050*e + 0.032*variant);
      color += vec3(0.02,0.06,0.08) * (corridor-0.50) * e * (0.06+0.08*variant);
      color += vec3(0.00,0.04,0.08) * edgeBloom * (0.018+0.040*variant);
      color += (micro-0.5)*e*(0.006+0.010*variant);
      color += vec3(0.08,0.04,0.11)*gesture*(0.04+0.06*e+0.035*variant);
      color = mix(color, vec3(0.050,0.054,0.074), 0.025+0.025*d+0.02*variant);
      color = mix(color, c, (0.46-0.06*variant) * silhouetteHold + edgeBloom*0.12);
      ghostPastUv = uv + colorDrift*(0.42+0.10*variant)
                      + vec2(sin(t*(0.22+0.04*variant)),cos(t*(0.20+0.04*variant)))*(0.0005+0.0008*variant);
      ghostPastUv += vec2(structureField,-structureField)*(0.0007+e*0.0019);
      color += vec3(0.09,0.04,0.15)*structureRidge*(0.014+0.028*e);
      if(u_historyMix>0.5) {
        vec2 memoryShiftA = colorDrift*(0.62+0.12*variant) + vec2(chromaShift.x*0.7,-chromaShift.y*0.7);
        vec2 memoryShiftB = vec2(-chromaShift.x*0.58, chromaShift.y*0.44) + flow*0.0018;
        vec3 memoryA = past(uv + memoryShiftA);
        vec3 memoryB = past(uv - memoryShiftB);
        vec3 memoryColor = vec3(memoryA.r*0.84 + color.r*0.16,
                                color.g*0.80 + memoryB.g*0.20,
                                memoryB.b*0.70 + memoryA.b*0.16 + color.b*0.14);
        float memoryBlend = (0.02 + 0.05*e + 0.03*variant) * (0.22 + 0.50*lightBloom + 0.28*edgeBloom);
        color = mix(color, memoryColor, memoryBlend);
      }
      if(variant>0.5) {
        vec2 denseOffset = vec2(0.0032+0.0048*e,-0.0012-0.0030*e);
        vec3 secondImage = src(displaced+denseOffset);
        vec3 doubleExposure = vec3(color.r*0.86+secondImage.b*0.14,
                                   color.g*0.78+secondImage.g*0.22,
                                   secondImage.r*0.28+color.b*0.72);
        color = mix(color,doubleExposure,0.025+0.04*e);
      }
      if(macro>0.5) {
        vec2 macroShift = vec2(0.004+0.006*e, 0.0) * (0.5 + 0.5*sin(t*0.16+u_seed));
        vec3 macroGhost = src(clamp(displaced+macroShift, vec2(0.001), vec2(0.999)));
        color = mix(color, vec3(macroGhost.r, color.g*0.88+macroGhost.g*0.12, macroGhost.b), 0.02+0.05*e);
      }
    }


    float opticWeight = (0.03 + 0.10*u_drift) * (0.55 + 0.45*variant) * (u_mode>3.5 ? 0.88 : 1.0);
    float leakSweep = smoothstep(0.74, 0.98, 0.5 + 0.5*sin(uv.x*1.9 + uv.y*0.8 + t*0.10 + u_seed*0.13));
    vec3 leakColor = mix(vec3(0.10,0.16,0.28), vec3(0.92,0.46,0.20), 0.5 + 0.5*sin(t*0.05 + u_seed*0.07));
    color += leakColor * leakSweep * opticWeight * smoothstep(0.36,0.92,organ);
    vec2 bleedStep = u_texel*(1.5 + 4.0*e);
    vec3 bleed = vec3(src(clamp(displaced+vec2(bleedStep.x,0.0),vec2(0.001),vec2(0.999))).r,
                      c.g,
                      src(clamp(displaced-vec2(0.0,bleedStep.y),vec2(0.001),vec2(0.999))).b);
    color = mix(color, bleed, opticWeight * 0.12 * smoothstep(0.40,0.88,l+outline*0.08));

    float retroWeight = (0.018 + 0.040*e + 0.020*u_drift) * (u_mode>3.5 ? 1.15 : 1.0);
    float scan = 0.5 + 0.5*sin(uv.y*u_resolution.y*0.78 + t*0.70 + u_seed*0.3);
    float lineMask = mix(1.0, 0.985 + 0.015*scan, retroWeight);
    color *= lineMask;
    float gate = (noise2(vec2(t*0.12, u_seed*0.21)) - 0.5) * retroWeight;
    color.r += gate*0.030;
    color.b -= gate*0.022;
    float phosphor = 0.5 + 0.5*sin(uv.x*u_resolution.x*0.18 + u_seed*0.7);
    color += vec3(0.015,-0.004,0.010) * (phosphor-0.5) * retroWeight;
    float vignette = (1.0 - smoothstep(0.22, 0.98, length((uv-0.5)*vec2(1.08, 1.0))));
    color *= mix(0.95, 1.0, vignette*0.95 + 0.05);
    float grain = (hash21(floor(uv*u_resolution*0.55) + floor(t*12.0)) - 0.5) * retroWeight;
    color += vec3(grain) * 0.05;

    if(u_mode < 0.5) {
      float scanner = 0.5 + 0.5*sin(uv.y*u_resolution.y*0.22 + t*0.24 + u_seed);
      float dust = smoothstep(0.988, 0.998, hash21(floor(uv*u_resolution*0.18) + floor(t*1.5) + u_seed));
      color *= 0.992 + 0.016*scanner*retroWeight;
      color += vec3(0.018,0.014,0.005) * scanner * retroWeight * 0.35;
      color = mix(color, vec3(0.92,0.86,0.72), dust * retroWeight * 0.10);
    } else if(u_mode < 1.5) {
      float paperFlicker = 0.5 + 0.5*sin(t*0.36 + u_seed*0.8);
      float silverGrain = hash21(floor(uv*u_resolution*0.95) + floor(t*8.0) + u_seed*3.0) - 0.5;
      color += vec3(silverGrain) * retroWeight * 0.040;
      color = mix(color, vec3(0.97,0.96,0.92), paperFlicker * retroWeight * 0.03);
    } else if(u_mode < 2.5) {
      float phosphorEdge = smoothstep(0.18,0.56,edge) * (0.5 + 0.5*sin(t*0.32 + uv.y*6.0));
      color += vec3(0.00,0.012,0.020) * phosphorEdge * retroWeight * 0.65;
      color *= 0.996 + 0.010*(0.5+0.5*sin(uv.y*u_resolution.y*0.55))*retroWeight;
    } else if(u_mode < 3.5) {
      vec2 smearStep = vec2(u_texel.x*(2.0 + 5.0*e), 0.0);
      vec3 tapeBleed = vec3(src(clamp(displaced+smearStep,vec2(0.001),vec2(0.999))).r,
                            color.g,
                            src(clamp(displaced-smearStep*1.2,vec2(0.001),vec2(0.999))).b);
      float drag = smoothstep(0.70,0.94,noise2(vec2(uv.y*12.0, t*0.10+u_seed)));
      color = mix(color, tapeBleed, retroWeight * 0.08 * drag);
    } else {
      vec2 lagStep = vec2(u_texel.x*(2.5 + 6.0*e), 0.0);
      vec3 lag = vec3(src(clamp(displaced+lagStep,vec2(0.001),vec2(0.999))).r,
                      color.g,
                      src(clamp(displaced-lagStep,vec2(0.001),vec2(0.999))).b);
      float persistence = 0.5 + 0.5*sin(t*0.18 + u_seed + uv.x*2.0);
      color = mix(color, lag, retroWeight * (0.07 + 0.04*variant) * persistence);
      color += vec3(0.010,0.024,0.032) * retroWeight * (corridor-0.5) * 0.8;
    }

    if(u_accident.x>0.001) {
      if(u_accident.y<0.5) {
        vec2 tearCell = floor((uv + vec2(structureField*0.04, medium*0.03))*vec2(18.0, 24.0));
        float tearNoise = noise2(tearCell + u_seed*0.9);
        float tear = smoothstep(0.80,0.96,tearNoise) * (0.45 + 0.55*outline);
        color = mix(color,vec3(0.025,0.010,0.042),incident*tear*(0.22+0.28*e));
      } else if(u_accident.y<1.5) {
        float chemical = 1.0-smoothstep(0.05,0.24,abs(l-0.46));
        vec3 reversal = vec3(1.0-color.b,1.0-color.r,0.66+color.g*0.18);
        color = mix(color,reversal,incident*chemical*(0.30+0.37*e));
      } else if(u_accident.y<2.5) {
        vec2 echoShift = vec2(0.010+0.020*e,-0.006-0.007*e);
        vec3 apparition = src(displaced+echoShift);
        if (u_historyMix>0.5) apparition = mix(apparition,past(uv-echoShift),0.50);
        color = mix(color,vec3(apparition.b,color.g*0.4+apparition.g*0.6,apparition.r),incident*(0.18+0.47*e));
      } else {
        float melt = smoothstep(0.48,0.77,organ+structureField*0.17);
        color = mix(color,vec3(0.70,0.36,0.66),incident*melt*(0.22+0.43*e));
        color += incident*(micro-0.5)*(0.08+0.20*e);
      }
    }
    float cl = lum(color);
    float srcLift = 0.18 + 0.72*l;
    float clampMix = 0.12 + 0.04*(1.0-variant);
    color = mix(color, color * (srcLift / max(0.10, cl)), clampMix);
    color = mix(vec3(cl), color, 0.92 + 0.02*variant);
    color = color * (0.955 + 0.02*variant) + vec3(0.018 - 0.004*variant);
    // Blend only after grading, so retained frames are not graded repeatedly.
    if (u_mode>3.5 && u_historyMix>0.5) {
      color = mix(color,past(ghostPastUv),u_trailRetention * (0.46 + 0.06*variant));
    }
    gl_FragColor = vec4(sat3(color),1.0);
  }
`;
function compileShader(type, text) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, text);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Shader compile error: ${log}`);
  }
  return shader;
}
function initGL() {
  gl = drawingContext;
  const vs = compileShader(gl.VERTEX_SHADER, VERTEX_SHADER);
  const fs = compileShader(gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
  program = gl.createProgram();
  gl.attachShader(program, vs); gl.attachShader(program, fs); gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
  gl.deleteShader(vs); gl.deleteShader(fs);
  gl.useProgram(program);
  buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([
    -1,-1,0,0, 1,-1,1,0, -1,1,0,1,
    -1,1,0,1, 1,-1,1,0, 1,1,1,1
  ]),gl.STATIC_DRAW);
  aPosition = gl.getAttribLocation(program,'a_position');
  aUv = gl.getAttribLocation(program,'a_uv');
  gl.enableVertexAttribArray(aPosition);
  gl.vertexAttribPointer(aPosition,2,gl.FLOAT,false,16,0);
  gl.enableVertexAttribArray(aUv);
  gl.vertexAttribPointer(aUv,2,gl.FLOAT,false,16,8);
  sourceTexture = gl.createTexture();
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D,sourceTexture);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,1,1,0,gl.RGBA,gl.UNSIGNED_BYTE,
    new Uint8Array([0,0,0,255]));
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);
  u = {};
  for (const name of ['u_source','u_history','u_historyMix','u_memory','u_trailRetention',
      'u_texel','u_resolution','u_pointer','u_touch','u_kinetic',
      'u_time','u_seed','u_mode','u_variant','u_macro','u_depth','u_erosion','u_drift',
      'u_structureA','u_structureB','u_accident']) {
    u[name] = gl.getUniformLocation(program,name);
  }
  gl.uniform1i(u.u_source,0);
  gl.uniform1i(u.u_history,1);
  sourceCanvas = document.createElement('canvas');
  sourceCtx = sourceCanvas.getContext('2d',{alpha:false});
  if (!sourceCtx) throw new Error('2D SOURCE CANVAS UNAVAILABLE');
}
function allocateSourceTexture(w, h) {
  state.sourceW = w;
  state.sourceH = h;
  sourceCanvas.width = w;
  sourceCanvas.height = h;
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, sourceTexture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  state.frameDirty = true;
  state.frameTime = -1;
}
function uploadSource() {
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, sourceTexture);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, sourceCanvas);
}
function sizeForLimit(w, h, edge) {
  const scale = Math.min(1, edge / Math.max(w, h));
  return [Math.max(2, Math.floor(w * scale / 2) * 2),
          Math.max(2, Math.floor(h * scale / 2) * 2)];
}
function previewSize() {
  return sizeForLimit(state.originalW, state.originalH, PERFORMANCE[state.quality].preview);
}
function outputPreset() {
  return OUTPUT_PRESETS[state.outputQuality] || OUTPUT_PRESETS.high;
}
function exportSize() {
  const preset = outputPreset();
  const edge = state.type === 'video' ? preset.video : preset.photo;
  return sizeForLimit(state.originalW, state.originalH, edge);
}
function historyEdgeForCurrentRender() {
  if (state.renderPurpose === 'preview') return PREVIEW_HISTORY_EDGE;
  const preset = outputPreset();
  return preset.history;
}
function resetFeedback() {
  state.historyReady = false;
  feedbackReadIndex = 0;
  if (!gl || !feedbackTextures.length) return;
  gl.bindFramebuffer(gl.FRAMEBUFFER, feedbackFramebuffer);
  for (const tex of feedbackTextures) {
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.clearColor(0,0,0,1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}
function initFeedback() {
  for (const tex of feedbackTextures) gl.deleteTexture(tex);
  if (feedbackFramebuffer) gl.deleteFramebuffer(feedbackFramebuffer);
  feedbackTextures = [];
  feedbackFramebuffer = gl.createFramebuffer();
  [state.historyW, state.historyH] = sizeForLimit(canvas.width, canvas.height, historyEdgeForCurrentRender());
  for (let i=0; i<2; i++) {
    const tex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,state.historyW,state.historyH,0,
      gl.RGBA,gl.UNSIGNED_BYTE,null);
    feedbackTextures.push(tex);
  }
  resetFeedback();
  gl.activeTexture(gl.TEXTURE0);
}
function drawPass(targetFramebuffer, w, h, now) {
  gl.bindFramebuffer(gl.FRAMEBUFFER, targetFramebuffer);
  gl.viewport(0,0,w,h);
  gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE);
  gl.useProgram(program);
  gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
  gl.enableVertexAttribArray(aPosition);gl.vertexAttribPointer(aPosition,2,gl.FLOAT,false,16,0);
  gl.enableVertexAttribArray(aUv);gl.vertexAttribPointer(aUv,2,gl.FLOAT,false,16,8);
  gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,sourceTexture);
  gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,feedbackTextures[feedbackReadIndex]);
  gl.uniform1i(u.u_source,0);
  gl.uniform1i(u.u_history,1);
  gl.uniform1f(u.u_historyMix, state.historyReady && (state.mode===0 || state.mode===3 || state.mode===4) ? 1 : 0);
  gl.uniform1f(u.u_memory, state.memoryFactor || 1);
  gl.uniform1f(u.u_trailRetention, state.trailRetention);
  gl.uniform2f(u.u_texel,1/state.sourceW,1/state.sourceH);
  gl.uniform2f(u.u_resolution,w,h);
  gl.uniform2f(u.u_pointer,state.pointer[0],state.pointer[1]);
  gl.uniform1f(u.u_touch,state.touchForce);
  gl.uniform1f(u.u_kinetic,state.kinetic);
  gl.uniform1f(u.u_time,now);
  gl.uniform1f(u.u_seed,state.seed);
  gl.uniform1f(u.u_mode,state.mode);
  gl.uniform1f(u.u_variant, state.modeVariants[state.mode] || 0);
  gl.uniform1f(u.u_macro, state.macro || 0);
  gl.uniform1f(u.u_depth,state.depth);
  gl.uniform1f(u.u_erosion,state.erosion);
  gl.uniform1f(u.u_drift,state.drift);
  const s = state.structure;
  gl.uniform4f(u.u_structureA,s.family,s.angle,s.scale,s.amount);
  gl.uniform4f(u.u_structureB,s.offsetX,s.offsetY,s.warp,s.bias);
  const incident = state.accident;
  const typeIndex = Math.max(0, Math.min(3, incident.kind | 0));
  const typeLevel = state.accidentLevels[typeIndex] ?? 0;
  gl.uniform4f(u.u_accident,incident.intensity * typeLevel,incident.kind,incident.x,incident.y);
  gl.drawArrays(gl.TRIANGLES,0,6);
}
function renderFrame(now, updateHistory=true) {
  if (!state.imageReady || !feedbackTextures.length) return;
  // Frame-rate independent memory retention; no CPU readback.
  const elapsed = state.lastRenderTime > 0 ? Math.max(1/60, Math.min(0.15, now-state.lastRenderTime)) : 1/24;
  state.lastRenderTime = now;
  state.memoryFactor = Math.pow(0.98, elapsed*24);
  // Ghost decay follows elapsed time directly; tuned for smoother color persistence over hard afterimages.
  const dense = state.modeVariants[4] === 1;
  const duration = (0.16 + 3.20 * Math.pow(state.trail, 1.80)) * (dense ? 1.10 : 0.96);
  state.trailRetention = Math.min(0.992, Math.exp(-elapsed / duration));
  drawPass(null, canvas.width, canvas.height, now);
  if ((state.mode===0 || state.mode===3 || state.mode===4) && updateHistory) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, feedbackFramebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,
      feedbackTextures[1-feedbackReadIndex],0);
    drawPass(feedbackFramebuffer,state.historyW,state.historyH,now);
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);
    feedbackReadIndex=1-feedbackReadIndex;
    state.historyReady=true;
  }
  gl.activeTexture(gl.TEXTURE0);
}
function setRenderSize(w,h,clearHistory=false) {
  if (!canvas || !gl) return;
  if (canvas.width!==w || canvas.height!==h) {
    resizeCanvas(w,h,true);
    state.renderW=w;state.renderH=h;
    if (clearHistory) initFeedback();
  } else if(clearHistory) resetFeedback();
  resizePreview();
}
function setSourceDimensions(w,h,preserveHistory=false) {
  state.originalW=w;state.originalH=h;
  const [sw,sh]=state.type==='photo' ? sizeForLimit(w,h,PREVIEW_PHOTO_SOURCE) : previewSize();
  allocateSourceTexture(sw,sh);
  const [pw,ph]=previewSize();
  // A source change needs a fresh history; returning from PNG export does not.
  setRenderSize(pw,ph,!preserveHistory);
  $('dimensionsTag').textContent=`${pw} × ${ph} · GPU`;
}
function changeVideoSourceSize(w,h) {
  if(state.type!=='video')return;
  if(state.sourceW!==w || state.sourceH!==h) allocateSourceTexture(w,h);
  state.frameDirty=true;
}
function changeQuality(q) {
  if (!PERFORMANCE[q] || state.isRecording || state.recordStarting || state.isExporting) return;
  state.quality=q;
  frameRate(PERFORMANCE[state.quality].fps);
  if(state.imageReady){
    const [w,h]=previewSize();
    if(state.type==='video')changeVideoSourceSize(w,h);
    setRenderSize(w,h,true);
    $('dimensionsTag').textContent=`${w} × ${h} · GPU`;
    if(state.type==='photo')state.frameDirty=true;
  }
  setStatus(`QUALITY / ${q.toUpperCase()}`);
}
function changeOutputQuality(q) {
  if (!OUTPUT_PRESETS[q] || state.isRecording || state.recordStarting || state.isExporting) return;
  state.outputQuality = q;
  saveOutputPreference();
  const preset = outputPreset();
  setStatus(`OUTPUT / ${q.toUpperCase()} · PHOTO ${preset.photo} / VIDEO ${preset.video}`);
}

function resizePreview() {
  if (!canvas) return;
  const box = $('stage').getBoundingClientRect();
  const scale = Math.min((box.width-4)/canvas.width,(box.height-4)/canvas.height);
  canvas.style.width=`${Math.max(2,canvas.width*scale)}px`;
  canvas.style.height=`${Math.max(2,canvas.height*scale)}px`;
}
function clearPreviousSource() {
  if (state.isRecording) stopRecording();
  const video=$('sourceVideo');
  video.pause(); video.onended=null; video.removeAttribute('src'); video.load();
  if (state.objectUrl) {URL.revokeObjectURL(state.objectUrl); state.objectUrl=null;}
  if (typeof ImageBitmap !== 'undefined' && state.element instanceof ImageBitmap) state.element.close();
  state.sourceGeneration++;
  state.type='none'; state.element=null; state.frameDirty=false; state.imageReady=false;
  $('timecode').textContent='';
  resetFeedback();
  state.videoReady=false;
  state.frameTime=-1; state.touchForce=0; state.touchTarget=0;
  scheduleAccident(performance.now(), true);
  state.kinetic=0; state.kineticTarget=0; state.pointerIsDown=false; state.lastRenderTime=0;
  clearExport();
}
// Image loading is transactional: a failed selection must not destroy the current image.
function withTimeout(promise, ms, message) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); })
  ]).finally(() => clearTimeout(timer));
}

function isHeicCandidate(file) {
  return /\.(heic|heif)$/i.test(file.name || '') ||
    /^image\/(heic|heif|heic-sequence|heif-sequence)$/i.test(file.type || '');
}

async function inspectHeicSignature(file) {
  if (isHeicCandidate(file)) return true;
  if (!(file instanceof Blob) || file.size < 12) return false;
  try {
    const raw = await file.slice(0, 32).arrayBuffer();
    const bytes = new Uint8Array(raw);
    const brand = Array.from(bytes.slice(4, Math.min(32, bytes.length)))
      .map(byte => String.fromCharCode(byte)).join('').toLowerCase();
    return brand.startsWith('ftyp') && /heic|heix|hevc|hevx|heim|heis|mif1|msf1/.test(brand);
  } catch { return false; }
}

async function decodeWithImageElement(blob) {
  const objectUrl = URL.createObjectURL(blob);
  const img = new Image();
  try {
    await withTimeout(new Promise((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('IMAGE DECODE FAILED'));
      img.src = objectUrl;
    }), 25000, 'IMAGE LOAD TIMEOUT');
    if (!img.naturalWidth || !img.naturalHeight) throw new Error('INVALID IMAGE DIMENSIONS');
    return { element: img, width: img.naturalWidth, height: img.naturalHeight, objectUrl };
  } catch (error) {
    img.onload = null;
    img.onerror = null;
    img.removeAttribute('src');
    URL.revokeObjectURL(objectUrl);
    throw error;
  }
}

async function decodeNativeImage(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await withTimeout(createImageBitmap(file), 20000, 'IMAGE BITMAP TIMEOUT');
      if (bitmap.width && bitmap.height) {
        return { element: bitmap, width: bitmap.width, height: bitmap.height, objectUrl: null };
      }
      bitmap.close();
    } catch (error) { console.info('ImageBitmap fallback:', error.message); }
  }
  return decodeWithImageElement(file);
}

let heicDecoderPromise = null;
function loadHeicDecoder() {
  if (typeof window.heic2any === 'function') return Promise.resolve(window.heic2any);
  if (!heicDecoderPromise) {
    heicDecoderPromise = withTimeout(new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/heic2any@0.0.4/dist/heic2any.min.js';
      script.async = true;
      script.onload = () => typeof window.heic2any === 'function'
        ? resolve(window.heic2any) : reject(new Error('HEIC DECODER UNAVAILABLE'));
      script.onerror = () => reject(new Error('HEIC DECODER NETWORK ERROR'));
      document.head.appendChild(script);
    }), 18000, 'HEIC DECODER TIMEOUT').catch(error => {
      heicDecoderPromise = null;
      throw error;
    });
  }
  return heicDecoderPromise;
}

async function decodePhoto(file) {
  const heic = await inspectHeicSignature(file);
  try {
    return await decodeNativeImage(file);
  } catch (nativeError) {
    if (!heic) throw nativeError;
    setStatus('DECODING HEIC');
    try {
      const heic2any = await loadHeicDecoder();
      const result = await withTimeout(heic2any({ blob: file, toType: 'image/jpeg', quality: 0.92 }),
        60000, 'HEIC CONVERSION TIMEOUT');
      const converted = Array.isArray(result) ? result[0] : result;
      if (!(converted instanceof Blob)) throw new Error('HEIC CONVERSION FAILED');
      return decodeNativeImage(converted);
    } catch (error) {
      console.warn('HEIC conversion failed:', error);
      throw new Error('HEIC UNAVAILABLE — TRY JPEG');
    }
  }
}

async function awaitVideoMetadata(video) {
  await withTimeout(new Promise((resolve, reject) => {
    if (video.readyState >= 1 && video.videoWidth > 0) { resolve(); return; }
    const success = () => { cleanup(); resolve(); };
    const failure = () => { cleanup(); reject(new Error('VIDEO DECODE FAILED')); };
    const cleanup = () => {
      video.removeEventListener('loadedmetadata', success);
      video.removeEventListener('error', failure);
    };
    video.addEventListener('loadedmetadata', success);
    video.addEventListener('error', failure);
  }), 25000, 'VIDEO LOAD TIMEOUT');
  if (!video.videoWidth || !video.videoHeight) throw new Error('INVALID VIDEO DIMENSIONS');
}

async function openFile(file) {
  if (!file || state.isRecording || state.recordStarting || state.isExporting) return;
  if (!gl || !sourceCtx || !program || state.renderingError) {
    setStatus('WEBGL INIT FAILED — RELOAD', true);
    return;
  }
  if (file.size === 0) { setStatus('EMPTY FILE', true); return; }
  const name = file.name || 'untitled';
  const isVideo = /^video\//i.test(file.type || '') || /\.(mov|mp4|m4v|webm)$/i.test(name);
  const isImage = /^image\//i.test(file.type || '') ||
    /\.(heic|heif|avif|png|jpe?g|webp|gif|bmp|tiff?)$/i.test(name);
  if (!isVideo && !isImage) { setStatus('UNSUPPORTED MEDIA TYPE', true); return; }
  const ticket = ++state.importGeneration;
  setStatus(isVideo ? 'LOADING VIDEO' : 'DECODING IMAGE');
  let prepared = null;
  let videoCommitted = false;
  try {
    if (!isVideo) {
      prepared = await decodePhoto(file);
      if (ticket !== state.importGeneration) {
        if (prepared.objectUrl) URL.revokeObjectURL(prepared.objectUrl);
        if (typeof ImageBitmap !== 'undefined' && prepared.element instanceof ImageBitmap) prepared.element.close();
        return;
      }
      clearPreviousSource();
      state.type = 'photo';
      state.fileName = name;
      state.element = prepared.element;
      state.objectUrl = prepared.objectUrl;
      setSourceDimensions(prepared.width, prepared.height);
      state.imageReady = true;
      state.frameDirty = true;
      $('timecode').textContent = '';
      $('sourceTag').textContent = 'PHOTO';
      $('assetName').textContent = name;
      $('emptyState').hidden = true;
      $('emptyState').style.display = 'none';
      $('stage').classList.add('has-source');
      $('playButton').disabled = true;
      $('saveButton').disabled = false;
      $('recordButton').disabled = !canRecord();
      setStatus(canRecord() ? 'IMAGE READY' : 'IMAGE READY / RECORD UNSUPPORTED');
    } else {
      const probeUrl = URL.createObjectURL(file);
      const probe = document.createElement('video');
      probe.preload = 'metadata';
      probe.muted = true;
      probe.playsInline = true;
      probe.src = probeUrl;
      probe.load();
      try {
        await awaitVideoMetadata(probe);
      } catch (error) {
        probe.removeAttribute('src');
        probe.load();
        URL.revokeObjectURL(probeUrl);
        throw error;
      }
      const videoWidth = probe.videoWidth;
      const videoHeight = probe.videoHeight;
      probe.pause();
      probe.removeAttribute('src');
      probe.load();
      if (ticket !== state.importGeneration) {
        URL.revokeObjectURL(probeUrl);
        return;
      }
      // Commit only after the incoming video has decoded successfully.
      clearPreviousSource();
      videoCommitted = true;
      state.type = 'video';
      state.fileName = name;
      const video = $('sourceVideo');
      state.element = video;
      state.objectUrl = probeUrl;
      video.loop = true;
      video.muted = true;
      video.playsInline = true;
      video.src = state.objectUrl;
      video.load();
      await awaitVideoMetadata(video);
      if (ticket !== state.importGeneration) return;
      setSourceDimensions(videoWidth, videoHeight);
      state.imageReady = true;
      state.videoReady = true;
      state.frameDirty = true;
      video.ontimeupdate = () => { state.frameDirty = true; };
      if (typeof video.requestVideoFrameCallback === 'function') {
        const generation = state.sourceGeneration;
        const onVideoFrame = () => {
          if (state.sourceGeneration !== generation || state.type !== 'video') return;
          state.frameDirty = true;
          video.requestVideoFrameCallback(onVideoFrame);
        };
        video.requestVideoFrameCallback(onVideoFrame);
      }
      video.onended = () => { if (state.isRecording) stopRecording(); };
      $('sourceTag').textContent = 'VIDEO';
      $('assetName').textContent = name;
      $('timecode').textContent = secondsToClock(0);
      $('emptyState').hidden = true;
      $('emptyState').style.display = 'none';
      $('stage').classList.add('has-source');
      $('playButton').disabled = false;
      $('recordButton').disabled = !canRecord();
      $('saveButton').disabled = false;
      $('playLabel').textContent = 'PAUSE';
      $('playIcon').textContent = 'Ⅱ';
      let started = true;
      try { await video.play(); } catch {
        started = false;
        $('playLabel').textContent = 'PLAY';
        $('playIcon').textContent = '▶';
      }
      setStatus(started ? 'VIDEO READY' : 'VIDEO READY / PRESS PLAY');
    }
  } catch (error) {
    if (ticket !== state.importGeneration) return;
    console.error('Import failed:', {name, type:file.type, bytes:file.size}, error);
    // A probe/decode failure must not clear the previously displayed image or video.
    if (isVideo && videoCommitted) {
      clearPreviousSource();
      $('emptyState').hidden = false;
      $('emptyState').style.display = 'flex';
      $('stage').classList.remove('has-source');
      $('sourceTag').textContent = 'NO SIGNAL';
      $('assetName').textContent = 'NO SOURCE LOADED';
      $('timecode').textContent = '';
    }
    setStatus(`IMPORT FAILED · ${error.message}`, true);
  }
}

function secondsToClock(t) {
  if (!Number.isFinite(t)||t<0) return '--:--';
  const n=Math.floor(t);
  return String(Math.floor(n/60)).padStart(2,'0')+':'+String(n%60).padStart(2,'0');
}
function setStatus(message, error=false) {
  if (!$('status')) return;
  $('status').textContent=message;
  $('status').style.color=error?'#f6a69f':'#86847c';
}
function togglePlay() {
  if (state.type!=='video'||!state.videoReady || state.recordStarting) return;
  const v=state.element;
  if (state.isRecording) {stopRecording();return;}
  if (v.paused) {
    v.play().then(()=>{$('playLabel').textContent='PAUSE';$('playIcon').textContent='Ⅱ';})
      .catch(err=>setStatus(`PLAYBACK FAILED: ${err.message}`,true));
  } else {
    v.pause();
    $('playLabel').textContent='PLAY';$('playIcon').textContent='▶';
  }
}
function toBlobAsync(c,type,quality) {
  return new Promise((resolve,reject)=>c.toBlob(b=>b?resolve(b):reject(new Error('IMAGE ENCODE FAILED')),type,quality));
}
function safeBaseName(name) {
  return (name||'capture').replace(/\.[^.]+$/,'').replace(/[^a-zA-Z0-9ぁ-んァ-ン一-龥_\-]/g,'_').slice(0,55);
}
function downloadBlob(blob,name) {
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),30000);
}
async function shareOrSave(blob,name,preferShare=true) {
  const file=new File([blob],name,{type:blob.type});
  if (preferShare && navigator.share && navigator.canShare && navigator.canShare({files:[file]})) {
    try {await navigator.share({files:[file],title:'HIDDEN SIDE'});return;}
    catch (e) {if (e.name==='AbortError') return;}
  }
  downloadBlob(blob,name);
}
async function saveStill() {
  if (!state.imageReady || state.isRecording || state.recordStarting || state.isExporting) return;
  state.isExporting = true;
  syncRecordControls(false);
  const originalPurpose = state.renderPurpose;
  const [exportW,exportH] = exportSize();
  let blob = null;
  try {
    state.renderPurpose = 'export';
    // Preserve the existing history texture instead of clearing it.
    // GHOST and SEEP need that accumulated temporal information in the PNG.
    setRenderSize(exportW,exportH,false);
    if (state.type === 'photo') {
      allocateSourceTexture(exportW,exportH);
    } else if (state.type === 'video') {
      changeVideoSourceSize(exportW,exportH);
    }
    sourceCtx.drawImage(state.element,0,0,state.sourceW,state.sourceH);
    uploadSource();
    state.frameDirty = false;
    // Render a still against the current preview history, without advancing it.
    renderFrame(performance.now()*0.001,false);
    blob = await toBlobAsync(canvas,'image/png');
  } catch(error) {
    setStatus(`EXPORT FAILED: ${error.message}`,true);
    console.error(error);
  } finally {
    state.renderPurpose = originalPurpose;
    try {
      if (state.imageReady) {
        // Restore preview textures without dropping the temporal state.
        setSourceDimensions(state.originalW,state.originalH,true);
        if (state.type === 'photo') {
          sourceCtx.drawImage(state.element,0,0,state.sourceW,state.sourceH);
          uploadSource();
          state.frameDirty = false;
        } else {
          state.frameDirty = true;
        }
      }
    } catch(error) {
      setStatus(`PREVIEW RESTORE FAILED: ${error.message}`,true);
      console.error(error);
    } finally {
      state.isExporting = false;
      syncRecordControls(false);
    }
  }
  if (!blob) return;
  const name=`hidden_${safeBaseName(state.fileName)}_m${state.mode+1}_${state.outputQuality}.png`;
  try {
    // Share only after restoring the lightweight preview; iOS share sheets can stay open.
    await shareOrSave(blob,name,true);
    setStatus(`IMAGE EXPORTED · ${exportW} × ${exportH} · ${state.outputQuality.toUpperCase()}`);
  } catch(error) {
    setStatus(`SAVE FAILED: ${error.message}`,true);
    console.error(error);
  }
}

function canRecord() {
  return !!canvas && typeof canvas.captureStream === 'function' &&
    typeof MediaRecorder !== 'undefined';
}
function pickMimeType() {
  if (typeof MediaRecorder === 'undefined') return '';
  const apple = /iPhone|iPad|iPod|Macintosh/i.test(navigator.userAgent) &&
    !/Chrome|CriOS|Edg/i.test(navigator.userAgent);
  const webm = ['video/webm;codecs=vp8', 'video/webm;codecs=vp9', 'video/webm'];
  const mp4 = ['video/mp4;codecs=avc1.42E01E', 'video/mp4'];
  const ordered = apple ? [...mp4, ...webm] : [...webm, ...mp4];
  if (typeof MediaRecorder.isTypeSupported !== 'function') return '';
  return ordered.find(mime => MediaRecorder.isTypeSupported(mime)) || '';
}
function syncRecordControls(busy = false) {
  const locked = busy || state.isRecording || state.recordStarting || state.isExporting;
  $('recordButton').disabled = locked || !state.imageReady || !canRecord();
  $('importButton').disabled = locked;
  $('playButton').disabled = locked || state.type !== 'video' || !state.videoReady;
  $('saveButton').disabled = locked || !state.imageReady;
  $('renderQuality').disabled = locked;
  $('outputQuality').disabled = locked;
}
async function startRecording() {
  if (!state.imageReady || state.isRecording || state.recordStarting || state.isExporting) return;
  if (!canRecord()) {
    setStatus('RECORD UNSUPPORTED IN THIS BROWSER', true);
    return;
  }
  state.recordStarting = true;
  syncRecordControls(true);
  clearExport();
  let stream = null;
  let started = false;
  const videoInput = state.type === 'video';
  const video = videoInput ? state.element : null;
  try {
    if (videoInput) {
      if (!state.videoReady) throw new Error('VIDEO NOT READY');
      video.pause();
      video.loop = false;
      if (video.currentTime > 0.01) {
        video.currentTime = 0;
        if (video.seeking) await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('VIDEO SEEK TIMEOUT')), 4000);
          video.addEventListener('seeked', () => { clearTimeout(timeout); resolve(); }, { once:true });
        });
      }
    }
    const preset = outputPreset();
    const [recordW, recordH] = sizeForLimit(
      state.originalW, state.originalH, preset.video
    );
    state.renderPurpose = 'record';
    if (videoInput) {
      changeVideoSourceSize(recordW, recordH);
    } else {
      allocateSourceTexture(recordW, recordH);
    }
    setRenderSize(recordW, recordH, true);
    sourceCtx.drawImage(state.element, 0, 0, state.sourceW, state.sourceH);
    uploadSource();
    state.frameDirty = false;
    state.frameTime = videoInput ? video.currentTime : -1;
    renderFrame(performance.now() * .001);

    stream = canvas.captureStream(PERFORMANCE[state.quality].fps);
    const mime = pickMimeType();
    const options = {
      videoBitsPerSecond: Math.max(3500000, Math.min(preset.bitrate, Math.round(recordW * recordH * 5.0)))
    };
    if (mime) options.mimeType = mime;
    let recorder;
    try {
      recorder = new MediaRecorder(stream, options);
    } catch (codecError) {
      if (!mime) throw codecError;
      recorder = new MediaRecorder(stream, { videoBitsPerSecond: options.videoBitsPerSecond });
    }
    const chunks = [];
    state.stream = stream;
    state.recorder = recorder;
    recorder.ondataavailable = event => {
      if (event.data && event.data.size > 0) chunks.push(event.data);
    };
    recorder.onerror = event => {
      setStatus(`RECORD FAILED: ${event.error?.message || 'UNKNOWN'}`, true);
      stopRecording();
    };
    recorder.onstop = () => {
      stream.getTracks().forEach(track => track.stop());
      const elapsed = Math.min(MAX_RECORD_SECONDS,
        Math.max(0, (performance.now() - state.recordStartedAt) / 1000));
      state.recordDuration = elapsed;
      state.isRecording = false;
      state.recordStarting = false;
      state.recorder = null;
      state.stream = null;
      document.body.classList.remove('is-recording');
      $('recordLabel').textContent = 'RECORD';
      $('recState').textContent = '';
      state.renderPurpose = 'preview';
      if (videoInput && state.type === 'video') {
        video.loop = true;
        $('playLabel').textContent = 'PLAY';
        $('playIcon').textContent = '▶';
      }
      if (state.imageReady) {
        setSourceDimensions(state.originalW, state.originalH);
        if (state.type === 'photo') {
          sourceCtx.drawImage(state.element,0,0,state.sourceW,state.sourceH);
          uploadSource();
          state.frameDirty = false;
        } else {
          state.frameDirty = true;
        }
        $('dimensionsTag').textContent = `${canvas.width} × ${canvas.height} · GPU`;
      }
      syncRecordControls(false);
      if (!chunks.length) {
        setStatus('NO VIDEO DATA', true);
        return;
      }
      const actualMime = recorder.mimeType || mime || 'video/webm';
      const extension = /mp4/i.test(actualMime) ? 'mp4' : 'webm';
      const blob = new Blob(chunks, { type: actualMime });
      state.recordedBlob = blob;
      state.recordedName = `hidden_${safeBaseName(state.fileName)}_${Date.now()}.${extension}`;
      $('exportDetails').textContent = `${secondsToClock(elapsed)} / ${recordW} × ${recordH} / ${extension.toUpperCase()} / SILENT / ${(blob.size / 1048576).toFixed(1)} MB`;
      $('exportPanel').hidden = false;
      try {
        const file = new File([blob], state.recordedName, { type: blob.type });
        $('shareVideo').disabled = !(navigator.share && navigator.canShare && navigator.canShare({ files: [file] }));
      } catch (_) { $('shareVideo').disabled = true; }
      setStatus(`VIDEO READY · ${state.outputQuality.toUpperCase()}`);
    };
    recorder.start(300);
    state.recordStartedAt = performance.now();
    state.isRecording = true;
    started = true;
    document.body.classList.add('is-recording');
    $('recordLabel').textContent = 'STOP';
    $('recState').textContent = '● REC 00:00';
    syncRecordControls(false);
    if (videoInput) {
      try {
        await video.play();
        $('playLabel').textContent = 'PAUSE';
        $('playIcon').textContent = 'Ⅱ';
      } catch (playError) {
        stopRecording();
        throw new Error(`VIDEO PLAYBACK FAILED: ${playError.message}`);
      }
    }
    setStatus(videoInput ? 'RECORDING VIDEO · 45S MAX' : 'RECORDING STILL · 45S MAX');
  } catch (error) {
    state.renderPurpose = 'preview';
    if (state.recorder && state.recorder.state !== 'inactive') {
      state.recorder.onstop = null;
      state.recorder.stop();
    }
    if (stream) stream.getTracks().forEach(track => track.stop());
    state.isRecording = false;
    state.recorder = null;
    state.stream = null;
    state.recordStarting = false;
    document.body.classList.remove('is-recording');
    $('recordLabel').textContent = 'RECORD';
    $('recState').textContent = '';
    if (state.imageReady) {
      if (videoInput && state.type === 'video') {
        video.loop = true;
        $('playLabel').textContent = 'PLAY';
        $('playIcon').textContent = '▶';
      }
      setSourceDimensions(state.originalW, state.originalH);
      if (state.type === 'photo') {
        sourceCtx.drawImage(state.element,0,0,state.sourceW,state.sourceH);
        uploadSource();
        state.frameDirty = false;
      } else {
        state.frameDirty = true;
      }
    }
    syncRecordControls(false);
    setStatus(`RECORD FAILED: ${error.message}`, true);
    console.error(error);
  } finally {
    if (!started) syncRecordControls(false);
  }
}
function stopRecording() {
  if (!state.isRecording || !state.recorder) return;
  const recorder = state.recorder;
  state.isRecording = false;
  $('recordButton').disabled = true;
  if (state.type === 'video' && state.element) state.element.pause();
  if (recorder.state !== 'inactive') recorder.stop();
}
function clearExport() {state.recordedBlob=null;state.recordedName='';$('exportPanel').hidden=true;}
function setMode(mode) {
  if (state.mode!==mode) resetFeedback();
  state.mode=mode;
  $('modeIndex').textContent=String(mode+1).padStart(2,'0')+' / 05';
  document.querySelectorAll('.mode-button').forEach(b=>{
    const active=Number(b.dataset.mode)===mode;
    b.classList.toggle('active',active);
    b.setAttribute('aria-pressed',String(active));
  });
  updateVariantUI();
  updateTrailUI();
  updateMacroUI();
}

const VARIANT_LABELS = [
  ['QUIET', 'SPLIT'],
  ['PRINT', 'BLEACH'],
  ['STONE', 'HALO'],
  ['STAIN', 'FILM'],
  ['SOFT', 'DENSE']
];

function updateVariantUI() {
  const labels = VARIANT_LABELS[state.mode] || ['A', 'B'];
  const buttons = document.querySelectorAll('.variant-button');
  buttons.forEach((button, index) => {
    button.textContent = labels[index] || (index === 0 ? 'A' : 'B');
    const active = (state.modeVariants[state.mode] || 0) === index;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
}

function setVariant(index) {
  state.modeVariants[state.mode] = index;
  resetFeedback();
  updateVariantUI();
}


function updateMacroUI() {
  document.querySelectorAll('.macro-button').forEach((button, index) => {
    const active = (state.macro || 0) === index;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
}

function setMacro(index) {
  state.macro = index;
  resetFeedback();
  updateMacroUI();
  setStatus(index === 0 ? 'CALM RANGE' : 'BREAK RANGE');
}

function updateAccidentUI() {
  document.querySelectorAll('.accident-button').forEach(button => {
    const onButton = button.dataset.accident === 'on';
    const active = state.accidentEnabled ? onButton : !onButton;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
}

function setAccidentEnabled(enabled) {
  state.accidentEnabled = !!enabled;
  const a = state.accident;
  a.intensity = 0;
  a.active = false;
  a.manualPreview = false;
  if (state.accidentEnabled) {
    scheduleAccident(performance.now(), true);
    setStatus('ACCIDENT / ON');
  } else {
    a.nextAt = 0;
    setStatus('ACCIDENT / OFF');
  }
  updateAccidentUI();
  saveAccidentPreferences();
}

const ACCIDENT_NAMES = ['FRACTURE', 'REVERSAL', 'ECHO', 'BLEED'];
const ACCIDENT_STORAGE_KEY = 'hidden-side-v2-accident-settings';

function loadAccidentPreferences() {
  try {
    const prefs = JSON.parse(localStorage.getItem(ACCIDENT_STORAGE_KEY) || 'null');
    if (!prefs || typeof prefs !== 'object') return;
    if (typeof prefs.enabled === 'boolean') state.accidentEnabled = prefs.enabled;
    if (Array.isArray(prefs.levels) && prefs.levels.length === 4) {
      state.accidentLevels = prefs.levels.map((level, i) =>
        Number.isFinite(Number(level)) ? Math.min(1, Math.max(0, Number(level))) : state.accidentLevels[i]);
    }
  } catch (_) { /* Storage may be blocked in privacy mode. */ }
}

function saveAccidentPreferences() {
  try {
    localStorage.setItem(ACCIDENT_STORAGE_KEY, JSON.stringify({
      enabled: state.accidentEnabled,
      levels: state.accidentLevels
    }));
  } catch (_) { /* A blocked storage API must not prevent image processing. */ }
}

const OUTPUT_STORAGE_KEY = 'hidden-side-v2-output-quality';
function loadOutputPreference() {
  try {
    const saved = localStorage.getItem(OUTPUT_STORAGE_KEY);
    if (saved && OUTPUT_PRESETS[saved]) state.outputQuality = saved;
  } catch (_) { /* Storage may be blocked. */ }
}
function saveOutputPreference() {
  try { localStorage.setItem(OUTPUT_STORAGE_KEY, state.outputQuality); }
  catch (_) { /* Storage may be blocked. */ }
}

function updateAccidentLevelUI() {
  document.querySelectorAll('[data-accident-level]').forEach(input => {
    const kind = Number(input.dataset.accidentLevel);
    const value = Math.round((state.accidentLevels[kind] || 0) * 100);
    input.value = String(value);
    const output = $('accidentLevel' + kind);
    if (output) output.textContent = String(value).padStart(2, '0');
  });
}

function openAccidentPanel() {
  updateAccidentLevelUI();
  $('accidentPanel').hidden = false;
  $('closeAccidentPanel').focus({ preventScroll: true });
}

function closeAccidentPanel() {
  $('accidentPanel').hidden = true;
  $('accidentTuneButton').focus({ preventScroll: true });
}

// TEST is intentionally independent of spontaneous ON/OFF scheduling.
// A user-triggered preview is the only exception when ACCIDENT is OFF.
function previewAccident(kind) {
  if (!state.imageReady || state.renderingError) {
    setStatus('IMPORT IMAGE TO TEST', true);
    return;
  }
  if (!Number.isInteger(kind) || kind < 0 || kind >= 4) return;
  if (state.accidentLevels[kind] <= 0) {
    setStatus('LEVEL 00 / NO EFFECT');
    return;
  }
  const now = performance.now();
  const a = state.accident;
  a.kind = kind;
  a.x = 0.5;
  a.y = 0.5;
  a.startAt = now;
  a.duration = 3200;
  a.intensity = 0;
  a.active = true;
  a.manualPreview = true;
  setStatus('TEST / ' + ACCIDENT_NAMES[kind]);
}

function updateTrailUI() {
  const isGhost = state.mode === 4;
  $('trailControl').hidden = !isGhost;
  $('variantRow').classList.toggle('has-trail', isGhost);
  $('trailValue').textContent = String(Math.round(state.trail * 100)).padStart(2, '0');
}

const STRUCTURE_NAMES = ['LAMINA', 'SHEAR', 'CURVE', 'FIELD', 'LENS', 'DRIFT'];

function scheduleAccident(now, first = false) {
  const a = state.accident;
  a.intensity = 0;
  a.active = false;
  if (!state.accidentEnabled) {
    a.nextAt = 0;
    return;
  }
  a.nextAt = now + (first ? 22000 + Math.random() * 31000
    : 37000 + Math.random() * 55000);
}

function updateAccident(now) {
  const a = state.accident;
  // Manual preview is explicit and works even while automatic events are OFF.
  if (a.manualPreview) {
    const progress = (now - a.startAt) / a.duration;
    if (progress >= 1) {
      a.manualPreview = false;
      scheduleAccident(now, !state.accidentEnabled);
    } else {
      const attack = Math.min(1, progress / 0.13);
      const release = Math.pow(Math.max(0, 1 - progress), 0.75);
      a.intensity = Math.max(0, Math.min(1, attack * release * 0.96));
    }
    return;
  }
  if (!state.accidentEnabled) {
    a.intensity = 0;
    a.active = false;
    a.nextAt = 0;
    return;
  }
  // A zero-strength type is fully excluded from random selection.
  const available = state.accidentLevels
    .map((level, kind) => (level > 0.001 ? kind : -1))
    .filter(kind => kind >= 0);
  if (!available.length) {
    a.intensity = 0;
    a.active = false;
    a.nextAt = 0;
    return;
  }
  if (!a.nextAt) scheduleAccident(now, true);
  if (!a.active && now >= a.nextAt) {
    a.active = true;
    a.kind = available[Math.floor(Math.random() * available.length)];
    a.x = 0.22 + Math.random() * 0.56;
    a.y = 0.22 + Math.random() * 0.56;
    a.startAt = now;
    a.duration = 1150 + Math.random() * 1600;
  }
  if (a.active) {
    const progress = (now - a.startAt) / a.duration;
    if (progress >= 1) {
      scheduleAccident(now);
    } else {
      const attack = Math.min(1, progress / 0.17);
      const release = Math.pow(Math.max(0,1 - progress), 1.15);
      const motion = Math.min(1, Math.max(0, state.drift * 5));
      a.intensity = Math.max(0, Math.min(1, attack * release * motion * 0.96));
    }
  } else {
    a.intensity = 0;
  }
}

function reseedStructure() {
  if (state.isRecording || state.recordStarting) return;
  const previousFamily = state.structure.family;
  const step = 1 + Math.floor(Math.random() * 5);
  const nextFamily = (previousFamily + step) % 6;
  state.seed = 1 + Math.random() * 119;
  state.structure = {
    family: nextFamily,
    angle: (Math.random() * 2 - 1) * Math.PI,
    scale: 0.84 + Math.random() * 0.94,
    warp: 0.12 + Math.random() * 0.52,
    offsetX: (Math.random() * 2 - 1) * 2.2,
    offsetY: (Math.random() * 2 - 1) * 2.2,
    bias: (Math.random() * 2 - 1) * 0.28,
    amount: 0.22 + Math.random() * 0.34
  };
  resetFeedback();
  state.lastRenderTime = 0;
  scheduleAccident(performance.now(), true);
  setStatus('RESEED / ' + STRUCTURE_NAMES[nextFamily]);
}

function bindEvents() {
  loadAccidentPreferences();
  ['depth','erosion','drift'].forEach(id=>{
    $(id).addEventListener('input',()=>{
      const val=Number($(id).value);
      state[id]=val/100;
      $(id+'Value').textContent=String(val).padStart(2,'0');
    });
  });
  document.querySelectorAll('.mode-button').forEach(button=>{
    button.addEventListener('click',()=>setMode(Number(button.dataset.mode)));
  });
  $('reroll').addEventListener('click', reseedStructure);
  $('trail').addEventListener('input',()=>{
    const value=Number($('trail').value);
    state.trail=value/100;
    $('trailValue').textContent=String(value).padStart(2,'0');
  });
  document.querySelectorAll('.variant-button').forEach(button=>{
    button.addEventListener('click', ()=> setVariant(Number(button.dataset.variant)));
  });
  document.querySelectorAll('.macro-button').forEach(button=>{
    button.addEventListener('click', ()=> setMacro(Number(button.dataset.macro)));
  });
  document.querySelectorAll('.accident-button').forEach(button=>{
    button.addEventListener('click', ()=> setAccidentEnabled(button.dataset.accident === 'on'));
  });
  $('accidentTuneButton').addEventListener('click', openAccidentPanel);
  $('closeAccidentPanel').addEventListener('click', closeAccidentPanel);
  $('accidentPanel').addEventListener('pointerdown', event => {
    if (event.target === $('accidentPanel')) closeAccidentPanel();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !$('accidentPanel').hidden) closeAccidentPanel();
  });
  document.querySelectorAll('[data-accident-level]').forEach(input => {
    input.addEventListener('input', () => {
      const kind = Number(input.dataset.accidentLevel);
      state.accidentLevels[kind] = Math.max(0, Math.min(1, Number(input.value) / 100));
      $('accidentLevel' + kind).textContent = String(Math.round(state.accidentLevels[kind] * 100)).padStart(2, '0');
      saveAccidentPreferences();
      if (state.accidentLevels[kind] === 0 && state.accident.active && state.accident.kind === kind) {
        state.accident.intensity = 0;
        state.accident.active = false;
        state.accident.manualPreview = false;
      }
    });
  });
  document.querySelectorAll('[data-accident-test]').forEach(button => {
    button.addEventListener('click', () => previewAccident(Number(button.dataset.accidentTest)));
  });
  $('renderQuality').addEventListener('change',e=>changeQuality(e.target.value));
  $('outputQuality').addEventListener('change',e=>changeOutputQuality(e.target.value));
  $('importButton').addEventListener('click',()=>{if(!state.isRecording && !state.recordStarting)$('fileInput').click();});
  $('emptyImport').addEventListener('click',()=>$('fileInput').click());
  $('fileInput').addEventListener('change',async event=>{
    const f=event.target.files?.[0];
    event.target.value='';
    if(f)await openFile(f);
  });
  $('playButton').addEventListener('click',togglePlay);
  $('saveButton').addEventListener('click',saveStill);
  $('recordButton').addEventListener('click',()=>state.isRecording?stopRecording():startRecording());
  $('closeExport').addEventListener('click',()=>$('exportPanel').hidden=true);
  $('downloadVideo').addEventListener('click',()=>{
    if(state.recordedBlob)downloadBlob(state.recordedBlob,state.recordedName);
  });
  $('shareVideo').addEventListener('click',()=>{
    if(state.recordedBlob)shareOrSave(state.recordedBlob,state.recordedName,true);
  });
  $('exportPanel').addEventListener('click',e=>{
    if(e.target===$('exportPanel'))$('exportPanel').hidden=true;
  });
  $('canvas-host').addEventListener('pointerdown',event=>{
    if(!state.imageReady)return;
    state.pointerIsDown=true;state.pointerTime=0;updateTouch(event);state.touchTarget=1;
    if(event.target===canvas) canvas.setPointerCapture(event.pointerId);
  });
  $('canvas-host').addEventListener('pointermove',event=>{
    if(state.pointerIsDown)updateTouch(event);
  });
  ['pointerup','pointercancel','pointerleave'].forEach(type=>{
    $('canvas-host').addEventListener(type,()=>{state.touchTarget=0;state.pointerIsDown=false;state.kineticTarget=0;});
  });
  $('stage').addEventListener('dragover',event=>event.preventDefault());
  $('stage').addEventListener('drop',event=>{
    event.preventDefault();if(event.dataTransfer?.files?.[0])openFile(event.dataTransfer.files[0]);
  });
  window.addEventListener('resize',resizePreview,{passive:true});
  if (typeof ResizeObserver!=='undefined') new ResizeObserver(resizePreview).observe($('stage'));
  document.addEventListener('visibilitychange',()=>{
    if(document.hidden&&state.isRecording)stopRecording();
  });
  setMode(0);
  updateVariantUI();
  updateAccidentUI();
  updateAccidentLevelUI();
  $('trail').value = Math.round(state.trail * 100);
  updateTrailUI();
  $('renderQuality').value=state.quality;
  $('outputQuality').value=state.outputQuality;
  $('depthValue').textContent=String(Math.round(state.depth*100)).padStart(2,'0');
  $('erosionValue').textContent=String(Math.round(state.erosion*100)).padStart(2,'0');
  $('driftValue').textContent=String(Math.round(state.drift*100)).padStart(2,'0');
  $('depth').value=Math.round(state.depth*100);
  $('erosion').value=Math.round(state.erosion*100);
  $('drift').value=Math.round(state.drift*100);
  setInterval(()=>{
    if(state.isRecording){
      const elapsed=Math.min(MAX_RECORD_SECONDS,(performance.now()-state.recordStartedAt)/1000);
      $('recState').textContent=`● REC ${secondsToClock(elapsed)}`;
      if (elapsed >= MAX_RECORD_SECONDS) stopRecording();
    }
  },250);
}
function updateTouch(event) {
  const rect=canvas.getBoundingClientRect();
  if (rect.width<=0 || rect.height<=0) return;
  const point=[
    Math.max(0,Math.min(1,(event.clientX-rect.left)/rect.width)),
    Math.max(0,Math.min(1,1-(event.clientY-rect.top)/rect.height))
  ];
  const now=performance.now();
  if(state.pointerTime>0) {
    const dt=Math.max(0.012,(now-state.pointerTime)/1000);
    const travel=Math.hypot((point[0]-state.pointer[0])*rect.width/rect.height,point[1]-state.pointer[1]);
    state.kineticTarget=Math.min(1,travel/dt*0.32);
  }
  state.pointer=point;
  state.pointerTime=now;
}

document.addEventListener('DOMContentLoaded',()=>{
  bindEvents();
  if ('serviceWorker' in navigator && location.protocol==='https:') {
    navigator.serviceWorker.register('./sw.js', {updateViaCache:'none'}).catch(()=>{});
  }
});
