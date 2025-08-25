if (!navigator.gpu) {
  throw new error("WebGPU not supported");
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
      time: f32,
      aspect: f32,
    };

    struct VSOut {
      @builtin(position) pos: vec4f,
      @location(0) uv: vec2f,
    };

    @binding(0) @group(0) var<uniform> uniforms: Uniforms;
    
    @vertex fn vs(@location(0) pos: vec2f, @location(1) uv: vec2f) -> VSOut {
      var out: VSOut;
      out.pos = vec4f(pos, 0.0, 1.0);
      out.uv = uv * 2.0 - 1.0;
      return out;
    }

    @fragment fn fs(@location(0) uv: vec2f) -> @location(0) vec4f {
      let t = uniforms.time * 0.4;
      let u = uv.x * uniforms.aspect;
      let v = uv.y;
      let r = length(vec2f(u, v));
      let stripes = cos(r * 12.0 - t * 10.0) * 0.5 + 0.5;
      
      let color = vec3f(
        1.0 + 0.5 * sin(t * 5.0),
        0.25 + 0.01 * sin(t * 2.0),
        stripes
      );

      return vec4f(color, 1.0);
    }
  `
});

const vertices = new Float32Array([
// x   y  u  v
  -1, -1, 0, 0,
   1, -1, 1, 0,
  -1,  1, 0, 1,

  -1,  1, 0, 1,
   1, -1, 1, 0,
   1,  1, 1, 1
]);

const vertexBuffer = device.createBuffer({
  size: vertices.byteLength,
  usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
});
device.queue.writeBuffer(vertexBuffer, 0, vertices);

const pipeline = device.createRenderPipeline({
  layout: 'auto',
  vertex:{
    module: shader, 
    entryPoint: "vs",
    buffers: [
      {
        arrayStride: 4 * 4,
        attributes: [
          { shaderLocation: 0, offset: 0, format: "float32x2" },
          { shaderLocation: 1, offset: 2 * 4, format: "float32x2" }
        ]
      },
    ]
  },
  fragment:{
    module: shader,
    entryPoint: "fs",
    targets: [{ format }]
  }
});

const uniformBuffer = device.createBuffer({
  size: 16,
  usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
});

const bindGroup = device.createBindGroup({
  layout: pipeline.getBindGroupLayout(0),
  entries: [{ binding: 0, resource: { buffer: uniformBuffer } }]
});

const render = (time) => {
  time *= 0.001;
  const aspect = canvas.width / canvas.height;

  const uniformsData = new Float32Array([time, aspect]);

  device.queue.writeBuffer(uniformBuffer, 0, uniformsData );

  const encoder = device.createCommandEncoder();
  const pass = encoder.beginRenderPass({
    colorAttachments: [{
      view: context.getCurrentTexture().createView(),
      loadOp: "clear",
      clearValue: [0, 0, 0, 1],
      storeOp: "store"
    }]
  });
  pass.setPipeline(pipeline);
  pass.setVertexBuffer(0, vertexBuffer);
  pass.setBindGroup(0, bindGroup);
  pass.draw(6);
  pass.end();
  device.queue.submit([encoder.finish()]);

  requestAnimationFrame(render);
};

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

requestAnimationFrame(render);