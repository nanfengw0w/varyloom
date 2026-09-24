import { Buffer, GpuContext } from 'wgpu-kit';

import type {
  Direction,
  LoadedImage,
  VaryloomImageFit,
  TransitionEffect,
  TransitionEffectContext,
  TransitionFrame,
} from '../types';

export interface WebGpuParticleLayerConfig {
  label: string;
  createShader(options: Readonly<Record<string, unknown>>): string;
  createInstanceData(options: Readonly<Record<string, unknown>>): Float32Array;
  parameters(
    options: Readonly<Record<string, unknown>>,
    dpr: number,
    direction: Direction,
  ): readonly number[];
  clearColor?: GPUColor;
}

export class WebGpuParticleLayerEffect implements TransitionEffect {
  readonly canvas = document.createElement('canvas');

  private context!: GPUCanvasContext;
  private device!: GPUDevice;
  private format!: GPUTextureFormat;
  private items: LoadedImage[] = [];
  private textures: GPUTexture[] = [];
  private instanceBuffer!: Awaited<ReturnType<typeof Buffer.create>>;
  private uniformBuffer!: GPUBuffer;
  private sampler!: GPUSampler;
  private bindGroupLayout!: GPUBindGroupLayout;
  private bindGroup?: GPUBindGroup;
  private planePipeline!: GPURenderPipeline;
  private particlePipeline!: GPURenderPipeline;
  private instanceCount = 0;
  private fromIndex = 0;
  private toIndex = 0;
  private aspect = 1;
  private dpr = 1;
  private elapsed = 0;
  private lastProgress = 0;
  private reportError: (error: Error) => void = () => undefined;

  constructor(private readonly config: WebGpuParticleLayerConfig) {}

  async init(context: TransitionEffectContext): Promise<void> {
    this.items = context.items;
    this.reportError = context.reportError;

    const gpu = await GpuContext.get();
    this.device = gpu.device;
    const canvasContext = this.canvas.getContext('webgpu');
    if (!canvasContext || !navigator.gpu) {
      throw new Error(`WebGPU is required for ${this.config.label}.`);
    }
    this.context = canvasContext;
    this.format = navigator.gpu.getPreferredCanvasFormat();
    this.context.configure({ device: this.device, format: this.format, alphaMode: 'opaque' });
    context.host.appendChild(this.canvas);

    const instanceData = this.config.createInstanceData(context.options);
    this.instanceCount = instanceData.length / 4;
    this.instanceBuffer = await Buffer.create('vec4f', this.instanceCount);
    this.instanceBuffer.write(instanceData as Float32Array<ArrayBuffer>);

    this.createResources();
    await this.loadTextures();
    await this.createPipelines(this.config.createShader(context.options));
    this.resize(context.width, context.height, context.dpr);
    this.device.lost.then((info) => {
      this.reportError(new Error(`WebGPU device lost: ${info.message || info.reason}`));
    });
  }

  private createResources(): void {
    this.uniformBuffer = this.device.createBuffer({
      label: `${this.config.label}-uniforms`,
      size: 96,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.sampler = this.device.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
    });
    this.bindGroupLayout = this.device.createBindGroupLayout({
      label: `${this.config.label}-layout`,
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
        { binding: 1, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
        { binding: 2, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
        { binding: 3, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
        { binding: 4, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
      ],
    });
  }

  private async loadTextures(): Promise<void> {
    this.textures = [];
    for (const item of this.items) {
      const texture = this.device.createTexture({
        label: item.caption || item.alt || `${this.config.label} image`,
        size: [item.width, item.height, 1],
        format: 'rgba8unorm',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
      });
      this.device.queue.copyExternalImageToTexture(
        { source: item.source },
        { texture },
        [item.width, item.height],
      );
      this.textures.push(texture);
    }
  }

  private async createPipelines(shader: string): Promise<void> {
    const module = this.device.createShaderModule({ label: `${this.config.label}-shader`, code: shader });
    const diagnostics = await module.getCompilationInfo();
    const errors = diagnostics.messages.filter((message) => message.type === 'error');
    if (errors.length) {
      throw new Error(errors.map((error) => `WGSL ${error.lineNum}:${error.linePos} ${error.message}`).join('\n'));
    }
    const layout = this.device.createPipelineLayout({ bindGroupLayouts: [this.bindGroupLayout] });
    this.planePipeline = await this.device.createRenderPipelineAsync({
      label: `${this.config.label}-plane`,
      layout,
      vertex: { module, entryPoint: 'planeVertex' },
      fragment: { module, entryPoint: 'planeFragment', targets: [{ format: this.format }] },
      primitive: { topology: 'triangle-list' },
    });
    this.particlePipeline = await this.device.createRenderPipelineAsync({
      label: `${this.config.label}-particles`,
      layout,
      vertex: { module, entryPoint: 'particleVertex' },
      fragment: {
        module,
        entryPoint: 'particleFragment',
        targets: [{
          format: this.format,
          blend: {
            color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
            alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
          },
        }],
      },
      primitive: { topology: 'triangle-list' },
    });
  }

  prepare(fromIndex: number, toIndex: number, _direction: Direction): void {
    this.fromIndex = fromIndex;
    this.toIndex = toIndex;
    this.elapsed = 0;
    this.lastProgress = 0;
    this.bindGroup = this.device.createBindGroup({
      label: `${this.config.label}-pair-${fromIndex}-${toIndex}`,
      layout: this.bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.instanceBuffer.gpuBuffer } },
        { binding: 1, resource: { buffer: this.uniformBuffer } },
        { binding: 2, resource: this.sampler },
        { binding: 3, resource: this.textures[fromIndex].createView() },
        { binding: 4, resource: this.textures[toIndex].createView() },
      ],
    });
  }

  resize(width: number, height: number, dpr: number): void {
    this.dpr = dpr;
    this.aspect = width / Math.max(height, 1);
    this.canvas.width = Math.max(1, Math.round(width * dpr));
    this.canvas.height = Math.max(1, Math.round(height * dpr));
  }

  render(frame: TransitionFrame): void {
    if (!this.bindGroup) return;
    if (frame.progress + 0.0001 < this.lastProgress) this.elapsed = frame.progress * frame.duration;
    else if (frame.active) this.elapsed += frame.delta;
    this.lastProgress = frame.progress;

    const parameters = this.config.parameters(frame.options, this.dpr, frame.direction);
    const values = new Float32Array(24);
    values.set([
      this.aspect, frame.progress, this.canvas.width, this.canvas.height,
      this.elapsed, parameters[0] ?? 0, parameters[1] ?? 0, parameters[2] ?? 0,
      parameters[3] ?? 0, parameters[4] ?? 0,
      (frame.options.imageFit as VaryloomImageFit | undefined) === 'contain' ? 1 : 0,
      this.instanceCount,
      this.items[this.fromIndex].width, this.items[this.fromIndex].height, 0, 0,
      this.items[this.toIndex].width, this.items[this.toIndex].height, 0, 0,
      parameters[5] ?? 0, parameters[6] ?? 0, 0, 0,
    ]);
    this.device.queue.writeBuffer(this.uniformBuffer, 0, values);

    const encoder = this.device.createCommandEncoder({ label: `${this.config.label}-frame` });
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: this.context.getCurrentTexture().createView(),
        clearValue: this.config.clearColor ?? { r: 0.006, g: 0.009, b: 0.011, a: 1 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });
    pass.setBindGroup(0, this.bindGroup);
    pass.setPipeline(this.planePipeline);
    pass.draw(3);
    pass.setPipeline(this.particlePipeline);
    pass.draw(6, this.instanceCount);
    pass.end();
    this.device.queue.submit([encoder.finish()]);
  }

  destroy(): void {
    this.instanceBuffer?.destroy();
    this.uniformBuffer?.destroy();
    this.textures.forEach((texture) => texture.destroy());
    this.context?.unconfigure();
    this.canvas.remove();
  }
}

