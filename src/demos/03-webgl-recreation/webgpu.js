import { initAudio, AudioData } from "./audio.js";
import GUI from 'https://muigui.org/dist/0.x/muigui.module.js';

initAudio();

if (!navigator.gpu) throw new Error("WebGPU not supported");

const adapter = await navigator.gpu.requestAdapter();
const device = await adapter.requestDevice();

const canvas = document.querySelector("canvas");
const context = canvas.getContext("webgpu");
const format = navigator.gpu.getPreferredCanvasFormat();
context.configure({ device, format });

const segments = 256;
const rings = 60;
let head = 0;

const levels = new Float32Array(rings);
const colors = new Float32Array(rings * 3);
let noisePos = 0;

let yaw = 0.0;
let pitch = 0.15;
let zoom = 0.65;

const waveformBuffer = device.createBuffer({
  size: segments * 4,
  usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
});

const levelsBuffer = device.createBuffer({
  size: rings * 4,
  usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
});

const colorsBuffer = device.createBuffer({
  size: rings * 3 * 4,
  usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
});

const uniformBuffer = device.createBuffer({
  size: 16 * 4,
  usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
});

const shader = device.createShaderModule({
  code: `
    const twoPI = 6.28318530718;

    struct Uniform {
      aspect: f32,
      base: f32,
      spacing: f32,
      segments: f32,
      rings: f32,
      head: f32,
      yaw: f32,
      pitch: f32,
      zoom: f32,
      zExtrude: f32,
      isColored: f32,
    };

    @group(0) @binding(0) var<uniform> u: Uniform;
    @group(0) @binding(1) var<storage, read> waveform: array<f32>;
    @group(0) @binding(2) var<storage, read> levels: array<f32>;
    @group(0) @binding(3) var<storage, read> colors: array<f32>;

    struct VSOut {
      @builtin(position) pos: vec4f,
      @location(0) which: f32,
      @location(1) age: f32,
    };

    fn rotYawPitch(p: vec3f, yaw: f32, pitch: f32) -> vec3f {
      let cy = cos(yaw); let sy = sin(yaw);
      let cx = cos(pitch); let sx = sin(pitch);
      var v = vec3f(p.x * cy + p.z * sy, p.y, -p.x * sy + p.z * cy);
      v = vec3f(v.x, v.y * cx - v.z * sx, v.y * sx + v.z * cx);
      return v;
    }

    @vertex fn vs(@builtin(vertex_index) vertexIndex: u32, @builtin(instance_index) instanceIndex: u32) -> VSOut {
      let totalSegments = u32(u.segments);
      let segment = vertexIndex / 2u;
      let isSecondVertex = (vertexIndex & 1u) == 1u;
      let segmentIndex = select(segment, (segment + 1u) % totalSegments, isSecondVertex);

      let sample = waveform[segmentIndex];
      let angle = (f32(segmentIndex) / f32(totalSegments)) * twoPI;

      let radius = u.base;
      let scale = 1.0 + f32(instanceIndex) * u.spacing;
      let r = radius * scale;

      let s = select(sample, 0.5, sample == 0) - 0.5;
      let z = s * u.zExtrude;

      var p = vec3f(cos(angle) * r, sin(angle) * r, z);

      p = rotYawPitch(p, u.yaw, u.pitch);
      p *= (1.0 / max(0.0001, u.zoom));

      let x = p.x / u.aspect;
      let y = p.y;

      var out: VSOut;
      out.pos = vec4f(x, y, 0.0, 1.0);

      let totalRings = u32(u.rings);
      let headIndex = u32(u.head);
      let whichRing = (i32(headIndex) - i32(instanceIndex) + i32(totalRings)) % i32(totalRings);

      out.which = f32(whichRing);
      out.age = f32(instanceIndex) / max(1.0, f32(totalRings - 1u));
      return out;
    }

    @fragment fn fs(in: VSOut) -> @location(0) vec4f {
      let idx = u32(clamp(in.which, 0.0, u.rings - 1.0));
      let i3 = idx * 3u;

      let v = clamp(levels[idx], 0.0, 1.0);
      let baseRGB = vec3f(colors[i3], colors[i3 + 1u], colors[i3 + 2u]);

      let useColor = u.isColored < 1.0;
      var rgb = baseRGB * v;
      rgb = mix(rgb, vec3f(1.0, 1.0, 1.0), v * v);

      let a = max(0.10, 1.0 - in.age * 0.85);
      let color = select(rgb, vec3f(1,1,1), useColor);
      return vec4f(color, a);
    }
  `
});

const pipeline = device.createRenderPipeline({
  layout: "auto",
  vertex: { module: shader, entryPoint: "vs" },
  fragment: { module: shader, entryPoint: "fs", targets: [{ format }] },
  primitive: { topology: "line-list" },
});

const bindGroup = device.createBindGroup({
  layout: pipeline.getBindGroupLayout(0),
  entries: [
    { binding: 0, resource: { buffer: uniformBuffer } },
    { binding: 1, resource: { buffer: waveformBuffer } },
    { binding: 2, resource: { buffer: levelsBuffer } },
    { binding: 3, resource: { buffer: colorsBuffer } },
  ],
});

const nextRGB = () => {
  noisePos += 0.0025;
  const t = noisePos * 2 * Math.PI;
  const r = 0.5 + 0.5 * Math.cos(t);
  const g = 0.5 + 0.5 * Math.cos(t - Math.PI*2 / 3);
  const b = 0.5 + 0.5 * Math.cos(t + Math.PI*2 / 3);
  return [r, g, b];
};

const onMouseMove = (e) => {
  const rect = canvas.getBoundingClientRect();
  const nx = (e.clientX - rect.left) / rect.width;
  const ny = (e.clientY - rect.top) / rect.height;
  yaw = (nx - 0.5) * 2.0 * Math.PI;
  pitch = (0.5 - ny) * 2.0 * Math.PI;
};

canvas.addEventListener("mousemove", onMouseMove);

canvas.addEventListener("wheel", (e) => {
  zoom *= (1 + Math.sign(e.deltaY) * 0.08);
}, { passive: true });

new ResizeObserver(entries => {
  for (const entry of entries) {
    const c = entry.target;
    const w = entry.contentBoxSize?.[0]?.inlineSize ?? c.clientWidth;
    const h = entry.contentBoxSize?.[0]?.blockSize ?? c.clientHeight;
    c.width = Math.max(1, Math.min(w, device.limits.maxTextureDimension2D));
    c.height = Math.max(1, Math.min(h, device.limits.maxTextureDimension2D));
  }
}).observe(canvas);

const settings = {
  enableColor: false,
  base: 0.1,
  spacing: 0.08,
  zExtrude: 0.40,
}

const gui = new GUI();
gui.add(settings, "enableColor");
gui.add(settings, "base", 0.01, 0.1)
gui.add(settings, "spacing", 0.01, 0.2);
gui.add(settings, "zExtrude", 0.01, 1.0);

const render = () => {
  if (AudioData.waveform && AudioData.waveform.length === segments) {
    device.queue.writeBuffer(waveformBuffer, 0, AudioData.waveform.buffer);
  }

  const level = Math.min(1, Math.max(0, (AudioData.latestFeatures?.rms ?? 0) * 2.0));
  const [r, g, b] = nextRGB();

  levels[head] = level + 0.01;
  colors[head * 3 + 0] = r;
  colors[head * 3 + 1] = g;
  colors[head * 3 + 2] = b;

  device.queue.writeBuffer(levelsBuffer, 0, levels);
  device.queue.writeBuffer(colorsBuffer, 0, colors);

  const uniforms = new Float32Array([canvas.width / canvas.height || 1, settings.base, settings.spacing, segments, rings, head, yaw, pitch, zoom, settings.zExtrude, settings.enableColor ? 1 : 0]);
  device.queue.writeBuffer(uniformBuffer, 0, uniforms);

  const encoder = device.createCommandEncoder();
  const pass = encoder.beginRenderPass({
    colorAttachments: [{
      view: context.getCurrentTexture().createView(),
      loadOp: "clear",
      storeOp: "store",
      clearValue: [0, 0, 0, 1],
    }],
  });

  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bindGroup);
  pass.draw(segments * 2, rings);
  pass.end();

  device.queue.submit([encoder.finish()]);

  head = (head + 1) % rings;
  requestAnimationFrame(render);
};

requestAnimationFrame(render);