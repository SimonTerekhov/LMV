import { initAudio, AudioData } from "./audio.js";
import GUI from "https://muigui.org/dist/0.x/muigui.module.js";

initAudio();

if (!("gpu" in navigator)) throw new Error("WebGPU not supported in this browser.");

const adapter = await navigator.gpu.requestAdapter();
if (!adapter) throw new Error("No compatible GPU adapter found.");

const device = await adapter.requestDevice();

export const canvas = document.querySelector("canvas");
export const audioEl = document.querySelector("#audio");

const ctx = canvas.getContext("webgpu");
const canvasFormat = navigator.gpu.getPreferredCanvasFormat();
ctx.configure({ device, format: canvasFormat});

let wasPaused = false;
let pauseStartMs = 0;
let pausedAccumMs = 0;
let frozenSimTime = 0;
let activated = false;

document.getElementById("fileInput")?.addEventListener("change", () => {
  randomizeControls();
  activated = true;
});


let frozen = {
  rmsZ: 0,
  bpm: 120,
  energy: 0,
  onsetEnv: 0,
  lastBeatTime: 0,
  tone: 0,
  lowBand: 0,
};

const isPaused = () => {
  return audioEl ? audioEl.paused : false;
};

const controls = {
  petalsWeight: 0.7,
  gridWeight: 0.4,
  flowWeight: 0.55,

  petalCount: 6,

  hueShift: 0.0,
  saturation: 0.8,
  exposure: 1.0,
  paletteMode: 0,

  glowAmount: 0.4,
  ringDensity: 1.5,
  warpAmount: 0.8,
  tempoBias: 1.0,

  baseScale: 1.3,
  centerOffsetX: 0.0,
  centerOffsetY: 0.0,
  baseSize: 0.20,
  minSoft: 0.004,
  petalBulge: 0.15,
  echoBase: 0.8,
  ringRFreq: 10.0,
  ringTFreq: 5.0,
  ringsLo: 0.20,
  ringsHi: 0.25,

  gridFreqBase: 1.0,
  gridEdgeLo: 0.48,
  gridEdgeHi: 0.50,
  gridMode: 3,

  flowLo: 0.35,
  flowHi: 0.95,
  flowGain: 0.2,

  fbmLacunarity: 2.0,
  noiseABY: 0.0,
  noiseBBY: 0.0,
  mirrorMode: 0
};

export const gui = new GUI();

const fColors = gui.addFolder("Colors");
fColors.add(controls, "paletteMode", { keyValues: { Triad: 0, Complementary: 1, Analogic: 2 } }).name("Mode");
fColors.add(controls, "hueShift", 0, 1, 0.01).name("Hue Shift");
fColors.add(controls, "saturation", 0, 1, 0.01).name("Saturation");
fColors.add(controls, "exposure", 0.5, 1.5, 0.01).name("Exposure");

const fPos = gui.addFolder("Position & Scale");
fPos.add(controls, "baseScale", 0.5, 5, 0.01).name("Base Scale");
fPos.add(controls, "centerOffsetX", -2, 2, 0.01).name("Center X");
fPos.add(controls, "centerOffsetY", -2, 2, 0.01).name("Center Y");
fPos.add({ Center: () => { controls.centerOffsetX = 0; controls.centerOffsetY = 0; } }, "Center");
fPos.add(controls, "mirrorMode", { keyValues: { Off: 0, X: 1, Y: 2, Both: 3 } }).name("Mirror");

const fRings = gui.addFolder("Rings & Blob");
fRings.add(controls, "petalsWeight", 0, 1, 0.01).name("Opacity");
fRings.add(controls, "petalCount", 1, 12, 1).name("Blob Divisions");
fRings.add(controls, "baseSize", 0.05, 5.0, 0.01).name("Blob Size");
fRings.add(controls, "minSoft", 0.0, 1.0, 0.001).name("Edge Softness");
fRings.add(controls, "petalBulge", 0.0, 5.0, 0.01).name("Blob Dent Size");
fRings.add(controls, "echoBase", 0.0, 10.0, 0.01).name("Rings Opacity");
fRings.add(controls, "ringRFreq", 0.0, 20.0, 0.01).name("Ring Frequency Size");
fRings.add(controls, "ringDensity", 0, 3, 0.01).name("Ring Density");
fRings.add(controls, "ringsLo", 0.0, 1.0, 0.001).name("Rings Treshold Low");
fRings.add(controls, "ringsHi", 0.0, 1.0, 0.001).name("Rings Treshold High");

const fGrid = gui.addFolder("Grid");
fGrid.add(controls, "gridMode", { keyValues: { Off: 0, Vertical: 1, Horizontal: 2, Both: 3 } }).name("Mode");
fGrid.add(controls, "gridWeight", 0, 1, 0.01).name("Grid Opacity");
fGrid.add(controls, "gridFreqBase", 0.0, 20.0, 0.01).name("Grid Frequency");
fGrid.add(controls, "gridEdgeLo", 0.0, 1.0, 0.001).name("Grid Treshold Low");
fGrid.add(controls, "gridEdgeHi", 0.0, 1.0, 0.001).name("Grid Treshold High");

const fFlow = gui.addFolder("Flow Clouds");
fFlow.add(controls, "flowWeight", 0, 2, 0.01).name("Flow Intensity");
fFlow.add(controls, "flowLo", 0.0, 1.0, 0.001).name("Flow Treshold Low");
fFlow.add(controls, "flowHi", 0.0, 1.0, 0.001).name("Flow Treshold High");
fFlow.add(controls, "flowGain", 0.0, 5.0, 0.01).name("Gain");

const fFX = gui.addFolder("FX & Tempo");
fFX.add(controls, "warpAmount", 0, 2, 0.01).name("Warp Intensity");
fFX.add(controls, "tempoBias", 0, 2, 0.01).name("Movement Speed");
fFX.add(controls, "fbmLacunarity", 0.0, 20.0, 0.01).name("Fractal Detail");
fFX.add(controls, "noiseABY", 0.0, 1.0, 1).name("Noise X");
fFX.add(controls, "noiseBBY", 0.0, 1.0, 1).name("Noise Y");

const actions = { randomize: () => randomizeControls() };
const fQuick = gui.addFolder("Quick");
fQuick.add(actions, "randomize").name("Randomize");
fQuick.open(true);

const randomizeControls = () => {
  const rnd  = (a, b) => a + Math.random() * (b - a);
  const rndi = (a, b) => Math.floor(rnd(a, b + 1));

  controls.paletteMode = rndi(0, 2);
  controls.hueShift    = rnd(0, 1);
  controls.saturation  = rnd(0, 1);
  controls.exposure    = rnd(0.5, 1.5);

  controls.flowWeight   = rnd(0, 1);

  controls.baseScale     = rnd(0.5, 5);
  controls.centerOffsetX = rnd(-2, 2);
  controls.centerOffsetY = rnd(-2, 2);
  controls.mirrorMode    = rndi(0, 3);

  controls.petalsWeight = rnd(0, 1);
  controls.petalCount   = rndi(1, 12);
  controls.baseSize     = rnd(0.05, 5.0);
  controls.minSoft      = rnd(0.0, 1.0);
  controls.petalBulge   = rnd(0.0, 5.0);
  controls.echoBase     = rnd(0.0, 10.0);
  controls.ringRFreq    = rnd(0.0, 20.0);
  controls.ringDensity  = rnd(0, 3);

  const ringsLo = rnd(0.0, 1.0);
  const ringsHi = rnd(ringsLo, 1.0);
  controls.ringsLo = ringsLo;
  controls.ringsHi = ringsHi;

  controls.gridMode     = rndi(0, 3);
  controls.gridWeight   = rnd(0, 1);
  controls.gridFreqBase = rnd(0.0, 20.0);

  const gridLo = rnd(0.0, 1.0);
  const gridHi = rnd(gridLo, 1.0);
  controls.gridEdgeLo = gridLo;
  controls.gridEdgeHi = gridHi;

  const flowLo = rnd(0.0, 1.0);
  const flowHi = rnd(flowLo, 1.0);
  controls.flowLo  = flowLo;
  controls.flowHi  = flowHi;
  controls.flowGain = rnd(0.0, 5.0);

  controls.warpAmount     = rnd(0, 2);
  controls.tempoBias      = rnd(0, 2);
  controls.fbmLacunarity  = rnd(0.0, 20.0);
  controls.noiseABY       = rndi(0, 1);
  controls.noiseBBY       = rndi(0, 1);
};

const shader = device.createShaderModule({
  code: `
    const PI = 3.141592653589793;

    fn hsv2rgb(c: vec3f) -> vec3f {
      let K = vec4f(1.0, 2.0/3.0, 1.0/3.0, 3.0);
      let p = abs(fract(vec3f(c.x) + K.xyz) * 6.0 - K.www);
      return c.z * mix(K.xxx, clamp(p - K.xxx, vec3f(0.0), vec3f(1.0)), c.y);
    }

    fn hash21(p: vec2f) -> f32 {
      let h = dot(p, vec2f(127.1, 311.7));
      return fract(sin(h) * 43758.5453123);
    }

    fn noise(p: vec2f, aby: f32, bby: f32) -> f32 {
      let i = floor(p);
      let f = fract(p);
      let a = hash21(i + vec2f(0.0, aby));
      let b = hash21(i + vec2f(1.0, bby));
      let c = hash21(i + vec2f(0.0, 1.0));
      let d = hash21(i + vec2f(1.0, 1.0));
      let u = f*f*(3.0-2.0*f);
      return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
    }

    fn fbm(p: vec2f, lacunarity: f32, aby: f32, bby: f32) -> f32 {
      var f = 0.0;
      var amp = 0.5;
      var q = p;
      for (var i = 0; i < 4; i++) {
        f += amp * noise(q, aby, bby);
        q = q * lacunarity + 31.416;
        amp *= 0.5;
      }
      return f;
    }

    struct UniformBuffer {
      rmsZ: f32,
      bpm: f32,
      energy: f32,
      onset: f32,
      lastBeatTime: f32,
      tone: f32,
      lowBand: f32,
      time: f32,
      resX: f32,
      resY: f32,

      petalsWeight: f32,
      gridWeight: f32,
      flowWeight: f32,
      petalCount: f32,
      hueShift: f32,
      saturation: f32,
      exposure: f32,
      glowAmount: f32,
      ringDensity: f32,
      warpAmount: f32,
      tempoBias: f32,
      paletteMode: f32,
      baseScale: f32,
      centerOffsetX: f32,
      centerOffsetY: f32,
      baseSize: f32,
      minSoft: f32,
      petalBulge: f32,
      echoBase: f32,
      ringRFreq: f32,
      ringTFreq: f32,
      ringsLo: f32,
      ringsHi: f32,
      gridFreqBase: f32,
      gridEdgeLo: f32,
      gridEdgeHi: f32,
      gridMode: f32,
      flowLo: f32,
      flowHi: f32,
      flowGain: f32,
      fbmLacunarity: f32,
      noiseABY: f32,
      noiseBBY: f32,
      mirrorMode: f32
    };
    
    @group(0) @binding(0) var<uniform> u: UniformBuffer;

    fn palette(baseHue: f32, satCap: f32, valCap: f32, mode: i32) -> array<vec3f,3> {
      var cols: array<vec3f,3>;
      if (mode == 0) {
        cols[0] = hsv2rgb(vec3f(fract(baseHue),        satCap, valCap));
        cols[1] = hsv2rgb(vec3f(fract(baseHue+1.0/3.0),satCap, valCap));
        cols[2] = hsv2rgb(vec3f(fract(baseHue+2.0/3.0),satCap, valCap));
      } else if (mode == 1) {
        cols[0] = hsv2rgb(vec3f(fract(baseHue),      satCap, valCap));
        cols[1] = hsv2rgb(vec3f(fract(baseHue+0.5),  satCap, valCap));
        cols[2] = hsv2rgb(vec3f(fract(baseHue+0.08), satCap, valCap*0.9));
      } else {
        cols[0] = hsv2rgb(vec3f(fract(baseHue-0.06), satCap, valCap));
        cols[1] = hsv2rgb(vec3f(fract(baseHue),      satCap, valCap));
        cols[2] = hsv2rgb(vec3f(fract(baseHue+0.06), satCap, valCap));
      }
      return cols;
    }

    @vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
      var pos = array(
        vec2f(-1.0, -1.0), vec2f( 1.0, -1.0), vec2f(-1.0,  1.0),
        vec2f(-1.0,  1.0), vec2f( 1.0, -1.0), vec2f( 1.0,  1.0)
      );
      return vec4f(pos[i], 0.0, 1.0);
    }

    @fragment fn fs(@builtin(position) fragPos: vec4f) -> @location(0) vec4f {
      let res = vec2f(u.resX, u.resY);
      let uv01 = fragPos.xy / res;
      let aspect = res.x / max(1.0, res.y);
      var uv = (uv01 * 2.0 - 1.0) * vec2f(aspect, 1.0);

      // mirror (u.mirrorMode: 0 Off, 1 X, 2 Y, 3 Both)
      let mm = i32(round(u.mirrorMode));
      if (mm == 1) {
        uv.x = abs(uv.x);
      } else if (mm == 2) {
        uv.y = abs(uv.y);
      } else if (mm == 3) {
        uv = abs(uv);
      }

      // center offset
      uv += vec2f(u.centerOffsetX, u.centerOffsetY);

      let t = u.time;
      let bpmPhase = t * (u.bpm * u.tempoBias) * PI / 60.0;

      // palette base hue
      let baseHue = fract(mix(0.05, 0.65, clamp(u.tone, 0.0, 1.0)) + u.hueShift + 0.02 * u.energy);
      let cols = palette(baseHue, u.saturation, u.exposure, i32(round(u.paletteMode)));

      // warp
      var p = uv * (u.baseScale + 0.6 * u.energy);
      let w = u.warpAmount * (0.4 + 0.6 * clamp(u.energy, 0.0, 1.0));
      let warp = vec2f(
        fbm(p + vec2f(0.0, t*0.15), u.fbmLacunarity, u.noiseABY, u.noiseBBY) - 0.5,
        fbm(p + vec2f(4.2, t*0.12), u.fbmLacunarity, u.noiseABY, u.noiseBBY) - 0.5
      );
      p += warp * w;

      // blobs / rings
      let r = length(p);
      let ang = atan2(p.y, p.x);
      let k = max(2.0, round(u.petalCount));
      let petals = 0.5 + 0.5*cos(ang * k + bpmPhase);

      let size = u.baseSize + 0.003 * clamp(u.lowBand, 0.0, 3000.0);
      let soft = mix(u.minSoft, 0.5, clamp(u.energy, 0.0, 1.0));
      let ring = 1.0 - smoothstep(size - soft, size + soft, r * (1.0 + u.petalBulge * petals));

      let echo = u.onset * (u.echoBase + 0.2*u.energy);
      let vibes = 0.5 + 0.5 * cos((r*u.ringRFreq + t*u.ringTFreq) * u.ringDensity);
      let rings = smoothstep(u.ringsLo, u.ringsHi, vibes) * echo;

      // grid
      let gridFreq = u.gridFreqBase + 16.0 * u.energy;
      let g1 = abs(fract((p.x + 0.15*sin(bpmPhase*0.5)) * gridFreq) - 0.5);
      let g2 = abs(fract((p.y + 0.15*cos(bpmPhase*0.5)) * gridFreq) - 0.5);
      let gv = 0.5 - g1;
      let gh = 0.5 - g2;
      let mode = i32(round(u.gridMode));
      var pick = 0.0;
      if (mode == 0) {
        pick = -10.0;
      } else if (mode == 1) {
        pick = gv;
      } else if (mode == 2) {
        pick = gh;
      } else {
        pick = max(gv, gh);
      }
      let grid = smoothstep(u.gridEdgeLo, u.gridEdgeHi, pick);

      // flow field
      let flow = fbm(p * 2.0 + vec2f(0.0, t*0.2), u.fbmLacunarity, u.noiseABY, u.noiseBBY);
      let flowSoft = smoothstep(u.flowLo, u.flowHi, flow);

      // compose
      var c = vec3f(0.0);
      let bgHue = fract(baseHue + 0.03*sin(bpmPhase*0.25));
      let bg = hsv2rgb(vec3f(bgHue, u.saturation*0.6, u.exposure*0.6));
      c += bg * (0.6 + 0.4*flowSoft) * (1.0 - u.petalsWeight*0.35);

      let aLayer = clamp(ring + rings, 0.0, 1.0);
      c += cols[0] * aLayer * u.petalsWeight;
      c += cols[0] * pow(aLayer, 4.0) * u.petalsWeight * 1.5;

      c = mix(c, c + cols[1]*grid*u.gridWeight, 0.8);

      c += cols[2] * flowSoft * u.flowWeight * u.flowGain;

      // exposure / onset
      let exposure = 0.70 + 0.40 * clamp(u.rmsZ, -1.5, 1.5);
      c *= exposure;
      c *= (1.0 + 0.35 * clamp(u.onset, 0.0, 1.0));

      return vec4f(clamp(c, vec3f(0.0), vec3f(10.0)), 1.0);
    }
  `
});

const bindGroupLayout = device.createBindGroupLayout({
  entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } }]
});

const pipeline = device.createRenderPipeline({
  layout: device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
  vertex: { module: shader, entryPoint: "vs" },
  fragment: { module: shader, entryPoint: "fs", targets: [{ format: canvasFormat }] },
  primitive: { topology: "triangle-list" }
});

const U = {
  rmsZ: 0,
  bpm: 1,
  energy: 2,
  onset: 3,
  lastBeatTime: 4,
  tone: 5,
  lowBand: 6,
  time: 7,
  resX: 8,
  resY: 9,

  petalsWeight: 10,
  gridWeight: 11,
  flowWeight: 12,
  petalCount: 13,
  hueShift: 14,
  saturation: 15,
  exposure: 16,
  glowAmount: 17,
  ringDensity: 18,
  warpAmount: 19,
  tempoBias: 20,
  paletteMode: 21,
  baseScale: 22,
  centerOffsetX: 23,
  centerOffsetY: 24,
  baseSize: 25,
  minSoft: 26,
  petalBulge: 27,
  echoBase: 28,
  ringRFreq: 29,
  ringTFreq: 30,
  ringsLo: 31,
  ringsHi: 32,
  gridFreqBase: 33,
  gridEdgeLo: 34,
  gridEdgeHi: 35,
  gridMode: 36,
  flowLo: 37,
  flowHi: 38,
  flowGain: 39,
  fbmLacunarity: 40,
  noiseABY: 41,
  noiseBBY: 42,
  mirrorMode: 43
};

const uniforms = new Float32Array(44);
const uniformBuffer = device.createBuffer({
  size: Math.ceil(uniforms.byteLength / 16) * 16,
  usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
});

const bindGroup = device.createBindGroup({
  layout: bindGroupLayout,
  entries: [{ binding: 0, resource: { buffer: uniformBuffer } }]
});

let onsetEnv = 0;
const decay = 0.9;

const updateUniforms = (tsMs) => {
  const paused = isPaused();
  
  if (paused && !wasPaused) {
    pauseStartMs = tsMs;
    frozen.rmsZ = AudioData.rmsZ ?? frozen.rmsZ;
    frozen.bpm = AudioData.bpm ?? frozen.bpm;
    frozen.energy = AudioData.energy ?? frozen.energy;
    frozen.lastBeatTime = AudioData.lastBeatTime ?? frozen.lastBeatTime;
    frozen.tone = AudioData.tone ?? frozen.tone;
    frozen.lowBand = AudioData.lowBand ?? frozen.lowBand;
    frozen.onsetEnv = onsetEnv;
    frozenSimTime = (tsMs - pausedAccumMs) * 0.001;
  } else if (!paused && wasPaused) {
    pausedAccumMs += (tsMs - pauseStartMs);
  }
  wasPaused = paused;

  const simTimeSec = paused ? frozenSimTime : (tsMs - pausedAccumMs) * 0.001;

  if (!paused) {
    onsetEnv *= decay;
    if (AudioData.isOnset) onsetEnv = 1;
  } else {
    onsetEnv = frozen.onsetEnv;
  }

  const rmsZ = paused ? frozen.rmsZ : (AudioData.rmsZ ?? frozen.rmsZ);
  const bpm = paused ? frozen.bpm : (AudioData.bpm ?? frozen.bpm);
  const energy = paused ? frozen.energy : (AudioData.energy ?? frozen.energy);
  const lastBeat = paused ? frozen.lastBeatTime : (AudioData.lastBeatTime ?? frozen.lastBeatTime);
  const tone = paused ? frozen.tone : (AudioData.tone ?? frozen.tone);
  const lowBand = paused ? frozen.lowBand : (AudioData.lowBand ?? frozen.lowBand);

  if (!paused) {
    frozen.rmsZ = rmsZ;
    frozen.bpm = bpm;
    frozen.energy = energy;
    frozen.lastBeatTime = lastBeat;
    frozen.tone = tone;
    frozen.lowBand = lowBand;
    frozen.onsetEnv = onsetEnv;
  }

  uniforms[U.rmsZ] = rmsZ;
  uniforms[U.bpm] = bpm;
  uniforms[U.energy] = energy;
  uniforms[U.onset] = onsetEnv;
  uniforms[U.lastBeatTime] = lastBeat;
  uniforms[U.tone] = tone;
  uniforms[U.lowBand] = lowBand;
  uniforms[U.time] = simTimeSec;
  uniforms[U.resX] = canvas.width;
  uniforms[U.resY] = canvas.height;

  uniforms[U.petalsWeight] = controls.petalsWeight;
  uniforms[U.gridWeight] = controls.gridWeight;
  uniforms[U.flowWeight] = controls.flowWeight;
  uniforms[U.petalCount] = controls.petalCount;
  uniforms[U.hueShift] = controls.hueShift;
  uniforms[U.saturation] = controls.saturation;
  uniforms[U.exposure] = controls.exposure;
  uniforms[U.glowAmount] = controls.glowAmount;

  uniforms[U.ringDensity] = controls.ringDensity;
  uniforms[U.warpAmount] = controls.warpAmount;
  uniforms[U.tempoBias] = controls.tempoBias;
  uniforms[U.paletteMode] = controls.paletteMode;

  uniforms[U.baseScale] = controls.baseScale;
  uniforms[U.centerOffsetX] = controls.centerOffsetX;
  uniforms[U.centerOffsetY] = controls.centerOffsetY;
  uniforms[U.baseSize] = controls.baseSize;

  uniforms[U.minSoft] = controls.minSoft;
  uniforms[U.petalBulge] = controls.petalBulge;
  uniforms[U.echoBase] = controls.echoBase;
  uniforms[U.ringRFreq] = controls.ringRFreq;

  uniforms[U.ringTFreq] = controls.ringTFreq;
  uniforms[U.ringsLo] = controls.ringsLo;
  uniforms[U.ringsHi] = controls.ringsHi;
  uniforms[U.gridFreqBase] = controls.gridFreqBase;

  uniforms[U.gridEdgeLo] = controls.gridEdgeLo;
  uniforms[U.gridEdgeHi] = controls.gridEdgeHi;
  uniforms[U.gridMode] = controls.gridMode;
  uniforms[U.flowLo] = controls.flowLo;

  uniforms[U.flowHi] = controls.flowHi;
  uniforms[U.flowGain] = controls.flowGain;
  uniforms[U.fbmLacunarity] = controls.fbmLacunarity;
  uniforms[U.noiseABY] = controls.noiseABY;

  uniforms[U.noiseBBY] = controls.noiseBBY;
  uniforms[U.mirrorMode] = controls.mirrorMode;

  device.queue.writeBuffer(uniformBuffer, 0, uniforms);
};

const render = (time) => {
  updateUniforms(time);

  const encoder = device.createCommandEncoder();
  const pass = encoder.beginRenderPass({
    colorAttachments: [{
      view: ctx.getCurrentTexture().createView(),
      loadOp: "clear",
      storeOp: "store",
      clearValue: [0, 0, 0, 1]
    }]
  });

  if (activated) {
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(6);
  }
  pass.end();

  device.queue.submit([encoder.finish()]);
  requestAnimationFrame(render);
};
requestAnimationFrame(render);