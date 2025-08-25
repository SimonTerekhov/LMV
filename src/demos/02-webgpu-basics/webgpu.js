import { initAudio, AudioData } from "./audio.js";

initAudio();

if (!navigator.gpu) {
  throw new Error("WebGPU not supported");
}

const adapter = await navigator.gpu.requestAdapter();
const device = await adapter.requestDevice();

const canvas = document.querySelector("canvas");
const context = canvas.getContext("webgpu");
const format = navigator.gpu.getPreferredCanvasFormat();
context.configure({ device, format });

const shader = device.createShaderModule({
  code: `
    struct Uniforms {
      spectralCentroid: f32,
    }
    @group(0) @binding(0) var<uniform> uniforms: Uniforms;

    @vertex fn vs(@location(0) pos: vec2f) -> @builtin(position) vec4f {
      return vec4f(pos, 0.0, 1.0);
    }

    @fragment fn fs() -> @location(0) vec4f {

      let t = uniforms.spectralCentroid / 60;

      return vec4f(1.0, t, 0.0, 1.0);
    }
  `
});

const degToRad = (deg) => deg * (Math.PI / 180);

const bindGroupLayout = device.createBindGroupLayout({
  entries: [
    { binding: 0, visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.VERTEX, resource: {} },
  ],
});

const pipelineLayout = device.createPipelineLayout({
  bindGroupLayouts: [bindGroupLayout],
});

const pipeline = device.createRenderPipeline({
  layout: pipelineLayout,
  vertex: {
    module: shader,
    entryPoint: "vs",
    buffers: [
      {
        arrayStride: 2 * 4,
        attributes: [
          { shaderLocation: 0, offset: 0, format: "float32x2" },
        ]}
    ]},
  fragment: {
    module: shader,
    entryPoint: "fs",
    targets: [{ format }]
  },
});

const linePipeline = device.createRenderPipeline({
  layout: pipelineLayout,
  vertex: {
    module: shader,
    entryPoint: "vs",
    buffers: [
      {
        arrayStride: 2 * 4,
        attributes: [
          { shaderLocation: 0, offset: 0, format: "float32x2" }
        ],
      }
    ],
  },
  fragment: {
    module: shader,
    entryPoint: "fs",
    targets: [{ format }]
  },
  primitive: {
    topology: "line-list",
  },
});

const uniformBuffer = device.createBuffer({
  size: 4,
  usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
});

const bindGroup = device.createBindGroup({
  layout: bindGroupLayout,
  entries: [
    { binding: 0, resource: { buffer: uniformBuffer } },
  ]
});

const kPoints = 3 * 12;
const kBars = 60;

const vertexBuffer = device.createBuffer({
  size: kPoints * 2 * 4,
  usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
});

const barsVertexBuffer = device.createBuffer({
  size: kBars * 2 * 2 * 4,
  usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
});

let f = null;
let flashAlpha = 0;
let sC = 0;

const audioElement = document.querySelector("#audio");

const render = (time) => {
  
  time *= 0.005;
  const aspect = canvas.width / canvas.height;
  let lastFeatures = AudioData.latestFeatures || f;
  const uniformsData = new Float32Array([sC]);

  device.queue.writeBuffer(uniformBuffer, 0, uniformsData );


  if(lastFeatures?.rms > 0){
    f = lastFeatures;
    sC = lastFeatures.spectralCentroid || sC;
  }
  const beatTime = AudioData.lastBeatTime;
  if (AudioData.isOnset && f?.rms > 0.25 && audioElement.currentTime - beatTime > 0.25) {
    flashAlpha = 1;
  }
  flashAlpha *= 0.9;
  const points = [];
  const bars = [];
  const numPoints = 60;
  const numTriangles = numPoints / 5;
  const volumeOffset = (f?.rms + 1)*2 || 1;

  for (let i = 0; i < numPoints; i++) {
    const t = i / 5;
    if( i % 5 === 0) {
      const angle1 = degToRad((360 / numTriangles) * t);
      const angle2 = degToRad((360 / numTriangles) * (t + 1));
      
      const base = 0.1;
      const intensity = 0.05;

      const scale1 = 1 + (f?.mfcc[t+1] || 0) * intensity;
      const scale2 = 1 + (f?.mfcc[(t+2) % numTriangles] || 0) * intensity;
      const r1 = base * scale1 * volumeOffset;
      const r2 = base * scale2 * volumeOffset;

      const x1 = (Math.cos(angle1) / aspect) * r1;
      const y1 = Math.sin(angle1) * r1;
      const x2 = (Math.cos(angle2) / aspect) * r2;
      const y2 = Math.sin(angle2) * r2;

      points.push(0, 0, x1, y1, x2, y2);
    }
    const angle1 = degToRad((360 / numPoints) * i);
    
    const base = 0.2;
    const intensity = 0.5; 
    const scale = 1 + (f?.amplitudeSpectrum[i+1] || 0) * intensity;
    const r = base * scale;
    const x1 = (Math.cos(angle1) / aspect) * 0.12 * volumeOffset;
    const y1 = Math.sin(angle1) * 0.12 * volumeOffset;
    const x2 = (Math.cos(angle1) / aspect) * r * volumeOffset;
    const y2 = Math.sin(angle1) * r * volumeOffset;

    bars.push(x1, y1, x2, y2);
  }

  const vertices = new Float32Array(points);
  device.queue.writeBuffer(vertexBuffer, 0, vertices);
  const barsVertices = new Float32Array(bars);
  device.queue.writeBuffer(barsVertexBuffer, 0, barsVertices);

  const encoder = device.createCommandEncoder();
  const pass = encoder.beginRenderPass({
    colorAttachments: [{
      view: context.getCurrentTexture().createView(),
      loadOp: "clear",
      storeOp: "store",
      clearValue: [flashAlpha, flashAlpha, flashAlpha, 1],
    }],
  });

  pass.setPipeline(pipeline);
  pass.setVertexBuffer(0, vertexBuffer);
  pass.setBindGroup(0, bindGroup);
  pass.draw(kPoints);

  pass.setPipeline(linePipeline);
  pass.setVertexBuffer(0, barsVertexBuffer);
  pass.setBindGroup(0, bindGroup);
  pass.draw(kBars * 2);

  pass.end();
  device.queue.submit([encoder.finish()]);
  requestAnimationFrame(render);
};

requestAnimationFrame(render);

const observer = new ResizeObserver(entries => {
  for (const entry of entries) {
    const c = entry.target;
    const w = entry.contentBoxSize[0].inlineSize;
    const h = entry.contentBoxSize[0].blockSize;
    c.width = Math.max(1, Math.min(w, device.limits.maxTextureDimension2D));
    c.height = Math.max(1, Math.min(h, device.limits.maxTextureDimension2D));
  }
});
observer.observe(canvas);