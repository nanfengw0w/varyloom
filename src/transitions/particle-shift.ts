import { Buffer, elementKernel, GpuContext } from 'wgpu-kit';

import { defineTransition } from '../registry';
import type {
  Direction,
  LoadedImage,
  VaryloomImageFit,
  TransitionEffect,
  TransitionEffectContext,
  TransitionFrame,
} from '../types';

export type ParticleExitDirection = 'right' | 'left' | 'up' | 'down';
export type ParticleEnterDirection = 'right' | 'left' | 'top' | 'bottom';

export interface ParticleShiftOptions {
  particleCount?: number;
  particleSize?: number;
  turbulence?: number;
  exitDirection?: ParticleExitDirection | 'auto';
  /** Defaults to the side opposite exitDirection. */
  enterDirection?: ParticleEnterDirection;
  imageFit?: VaryloomImageFit;
}

type ExitDirection = ParticleExitDirection;
type EnterDirection = ParticleEnterDirection;

const MOTION_REFERENCE_DURATION = 3.5;
const MOTION_REFERENCE_ASPECT = 6 / 11;
const EXIT_VECTORS: Record<ExitDirection, [number, number]> = {
  right: [1, 0],
  left: [-1, 0],
  up: [0, 1],
  down: [0, -1],
};
const ENTER_VECTORS: Record<EnterDirection, [number, number]> = {
  right: [1, 0],
  left: [-1, 0],
  top: [0, 1],
  bottom: [0, -1],
};
const OPPOSITE_ENTER: Record<ExitDirection, EnterDirection> = {
  right: 'left',
  left: 'right',
  up: 'bottom',
  down: 'top',
};

function createComputeKernel() {
  return elementKernel({
    name: 'varyloom-particle-shift',
    state: { pos: 'vec2f', vel: 'vec2f' },
    inputs: { home: 'vec2f', seeds: 'f32' },
    uniforms: {
      dt: 'f32',
      progress: 'f32',
      time: 'f32',
      exitX: 'f32',
      exitY: 'f32',
      enterX: 'f32',
      enterY: 'f32',
      aspect: 'f32',
      turbulence: 'f32',
    },
    workgroupSize: 256,
    code: /* wgsl */ `
      fn hash11(p: f32) -> f32 {
        return fract(sin(p * 127.113) * 43758.5453123);
      }

      fn directionOrder(uv: vec2f, direction: vec2f) -> f32 {
        let centered = vec2f(uv.x - 0.5, 0.5 - uv.y);
        let span = max(abs(direction.x) + abs(direction.y), 0.001);
        return dot(centered, direction) / span + 0.5;
      }

      fn userFn(
        idx: u32,
        dt: f32,
        progress: f32,
        time: f32,
        exitX: f32,
        exitY: f32,
        enterX: f32,
        enterY: f32,
        aspect: f32,
        turbulence: f32
      ) {
        let origin = home[idx];
        let particleSeed = seeds[idx];

        if (progress <= 0.001) {
          pos[idx] = origin;
          vel[idx] = vec2f(0.0);
          return;
        }

        let uv = vec2f(origin.x / aspect * 0.5 + 0.5, 0.5 - origin.y * 0.5);
        let exitDirection = normalize(vec2f(exitX, exitY) + vec2f(0.00001));
        let noise = (hash11(particleSeed * 91.7 + 4.1) - 0.5) * 0.18;
        let exitOrder = clamp(directionOrder(uv, exitDirection) + noise, 0.025, 0.975);
        let exitClock = smoothstep(0.015, 0.59, progress) * 1.18;
        let released = smoothstep(exitOrder, exitOrder + 0.14, exitClock);

        if (released <= 0.0001) {
          pos[idx] = origin;
          vel[idx] = vec2f(0.0);
          return;
        }

        var position = pos[idx];
        var velocity = vel[idx];
        let referenceAspect = ${MOTION_REFERENCE_ASPECT};
        let aspectScale = vec2f(aspect / referenceAspect, 1.0);
        let normalizedPosition = vec2f(position.x / max(aspect, 0.001) * referenceAspect, position.y);
        let phaseA = time * 1.75 + particleSeed * 13.0;
        let phaseB = time * 1.21 - particleSeed * 9.0;
        let curl = vec2f(
          sin(normalizedPosition.y * 7.4 + phaseA) + cos(normalizedPosition.x * 4.1 - phaseB) * 0.55,
          -cos(normalizedPosition.x * 7.1 - phaseA) + sin(normalizedPosition.y * 4.6 + phaseB) * 0.55
        ) * aspectScale;
        let flicker = hash11(particleSeed * 44.3 + floor(time * 8.0)) - 0.5;
        let windStrength = 0.62 + hash11(particleSeed * 31.2) * 0.7;
        let side = vec2f(-exitDirection.y, exitDirection.x);
        let wind = (exitDirection * windStrength + side * flicker * 0.34) * aspectScale;
        let middle = smoothstep(0.24, 0.5, progress) * (1.0 - smoothstep(0.58, 0.83, progress));
        velocity += (wind + curl * turbulence * (0.44 + middle * 0.1)) * released * dt;
        let exitTail = smoothstep(0.68, 1.0, progress);
        let damping = 0.82 + exitTail * 1.7;
        velocity *= exp(-damping * dt);
        position += velocity * dt;
        pos[idx] = position;
        vel[idx] = velocity;
      }
    `,
  });
}

const renderShader = /* wgsl */ `
  struct RenderUniforms {
    viewport: vec4f,
    directions: vec4f,
    style: vec4f,
    grid: vec4f,
    imageSizes: vec4f,
  };

  @group(0) @binding(0) var<storage, read> positions: array<vec2f>;
  @group(0) @binding(1) var<storage, read> velocities: array<vec2f>;
  @group(0) @binding(2) var<storage, read> homes: array<vec2f>;
  @group(0) @binding(3) var<storage, read> randomSeeds: array<f32>;
  @group(0) @binding(4) var<uniform> uniforms: RenderUniforms;
  @group(0) @binding(5) var imageSampler: sampler;
  @group(0) @binding(6) var sourceImage: texture_2d<f32>;
  @group(0) @binding(7) var targetImage: texture_2d<f32>;

  fn hash12(p: vec2f) -> f32 {
    let p3 = fract(vec3f(p.xyx) * 0.1031);
    let mixed = p3 + dot(p3, p3.yzx + 33.33);
    return fract((mixed.x + mixed.y) * mixed.z);
  }

  fn fitUv(uv: vec2f, imageSize: vec2f) -> vec2f {
    let viewportSize = max(uniforms.viewport.zw, vec2f(1.0));
    let safeImageSize = max(imageSize, vec2f(1.0));
    let coverScale = max(viewportSize.x / safeImageSize.x, viewportSize.y / safeImageSize.y);
    let containScale = min(viewportSize.x / safeImageSize.x, viewportSize.y / safeImageSize.y);
    let scale = select(coverScale, containScale, uniforms.style.w > 0.5);
    let drawnSize = safeImageSize * scale;
    return (uv - vec2f(0.5)) * (viewportSize / drawnSize) + vec2f(0.5);
  }

  fn imageMask(uv: vec2f) -> f32 {
    if (uniforms.style.w < 0.5) { return 1.0; }
    let inside = step(vec2f(0.0), uv) * step(uv, vec2f(1.0));
    return inside.x * inside.y;
  }

  fn directionOrder(uv: vec2f, direction: vec2f) -> f32 {
    let centered = vec2f(uv.x - 0.5, 0.5 - uv.y);
    let span = max(abs(direction.x) + abs(direction.y), 0.001);
    return dot(centered, direction) / span + 0.5;
  }

  fn maskState(uv: vec2f, particleNoise: f32) -> vec2f {
    let progress = uniforms.viewport.y;
    let exitDirection = normalize(uniforms.directions.xy + vec2f(0.00001));
    let enterOrigin = normalize(uniforms.directions.zw + vec2f(0.00001));
    let exitNoise = (particleNoise - 0.5) * 0.18;
    let exitOrder = clamp(directionOrder(uv, exitDirection) + exitNoise, 0.025, 0.975);
    let enterSide = vec2f(-enterOrigin.y, enterOrigin.x);
    let centered = vec2f(uv.x - 0.5, 0.5 - uv.y);
    let crossCoordinate = dot(centered, enterSide);
    let boundaryWarp = sin(crossCoordinate * 8.0 + 0.85) * 0.12
      + sin(crossCoordinate * 19.0 - 1.7) * 0.06
      + sin(crossCoordinate * 43.0 + 2.2) * 0.025;
    let enterNoise = (particleNoise - 0.5) * 0.08;
    let enterOrder = clamp(
      1.0 - directionOrder(uv, enterOrigin) + boundaryWarp + enterNoise,
      0.025,
      0.975
    );
    let exitClock = smoothstep(0.015, 0.59, progress) * 1.18;
    let enterClock = smoothstep(0.26, 1.0, progress) * 1.5;
    let released = smoothstep(exitOrder, exitOrder + 0.14, exitClock);
    let enterDuration = 0.46 + particleNoise * 0.04;
    let gathered = smoothstep(enterOrder, enterOrder + enterDuration, enterClock);
    return vec2f(released, gathered);
  }

  fn incomingFlowPosition(
    home: vec2f,
    enterDirection: vec2f,
    seed: f32,
    arrival: f32,
    aspect: f32,
    turbulence: f32
  ) -> vec2f {
    let enterSide = vec2f(-enterDirection.y, enterDirection.x);
    let travelSpan = abs(enterDirection.x) * aspect * 2.2 + abs(enterDirection.y) * 2.2;
    let travelDistance = travelSpan * (0.72 + fract(seed * 31.2) * 0.58);
    let dispersed = home + enterDirection * travelDistance;
    let curveTime = arrival * arrival * (3.0 - 2.0 * arrival);
    let envelope = sin(arrival * 3.14159265);
    let referenceAspect = ${MOTION_REFERENCE_ASPECT};
    let aspectScale = vec2f(aspect / referenceAspect, 1.0);
    let normalizedHome = vec2f(home.x / max(aspect, 0.001) * referenceAspect, home.y);
    let phaseA = arrival * 4.8 + seed * 13.0;
    let phaseB = arrival * 3.3 - seed * 9.0;
    let curl = vec2f(
      sin(normalizedHome.y * 7.4 + phaseA) + cos(normalizedHome.x * 4.1 - phaseB) * 0.55,
      -cos(normalizedHome.x * 7.1 - phaseA) + sin(normalizedHome.y * 4.6 + phaseB) * 0.55
    );
    let sideCurl = dot(curl, enterSide);
    let forwardCurl = dot(curl, -enterDirection);
    let seedDrift = fract(seed * 44.3 + 0.27) - 0.5;
    let flowOffset = (enterSide * (sideCurl * turbulence * 0.14 + seedDrift * 0.12)
      - enterDirection * forwardCurl * turbulence * 0.035) * aspectScale;
    return mix(dispersed, home, curveTime) + flowOffset * envelope;
  }

  struct PlaneOutput {
    @builtin(position) position: vec4f,
    @location(0) uv: vec2f,
  };

  @vertex
  fn planeVertex(@builtin(vertex_index) vertexIndex: u32) -> PlaneOutput {
    let triangle = array<vec2f, 3>(
      vec2f(-1.0, -1.0),
      vec2f(3.0, -1.0),
      vec2f(-1.0, 3.0)
    );
    let p = triangle[vertexIndex];
    var output: PlaneOutput;
    output.position = vec4f(p, 0.0, 1.0);
    output.uv = vec2f(p.x * 0.5 + 0.5, 0.5 - p.y * 0.5);
    return output;
  }

  @fragment
  fn planeFragment(input: PlaneOutput) -> @location(0) vec4f {
    let uv = clamp(input.uv, vec2f(0.0), vec2f(1.0));
    let pixelNoise = hash12(floor(uv * vec2f(420.0, 770.0)) + vec2f(3.7, 9.1));
    let masks = maskState(uv, pixelNoise);
    let sourceUv = fitUv(uv, uniforms.imageSizes.xy);
    let targetUv = fitUv(uv, uniforms.imageSizes.zw);
    let source = textureSample(sourceImage, imageSampler, clamp(sourceUv, vec2f(0.0), vec2f(1.0))).rgb;
    let targetColor = textureSample(targetImage, imageSampler, clamp(targetUv, vec2f(0.0), vec2f(1.0))).rgb;
    let sourceVisibility = (1.0 - masks.x) * imageMask(sourceUv);
    let targetVisibility = smoothstep(0.72, 0.9, masks.y) * imageMask(targetUv);
    let targetOver = targetVisibility;
    let sourceUnder = sourceVisibility * (1.0 - targetOver);
    let coverage = clamp(targetOver + sourceUnder, 0.0, 1.0);
    let backdrop = vec3f(0.012, 0.014, 0.016);
    let color = targetColor * targetOver + source * sourceUnder + backdrop * (1.0 - coverage);
    return vec4f(color, 1.0);
  }

  struct ParticleOutput {
    @builtin(position) position: vec4f,
    @location(0) uv: vec2f,
    @location(1) local: vec2f,
    @location(2) fade: f32,
    @location(3) sparkle: f32,
    @location(4) gather: f32,
    @location(5) kind: f32,
  };

  @vertex
  fn particleVertex(
    @builtin(vertex_index) vertexIndex: u32,
    @builtin(instance_index) instanceIndex: u32
  ) -> ParticleOutput {
    let corners = array<vec2f, 6>(
      vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
      vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0)
    );
    let local = corners[vertexIndex];
    let particleCount = u32(uniforms.grid.z);
    var dataIndex = instanceIndex;
    var kind = 0.0;
    if (instanceIndex >= particleCount) {
      dataIndex = (instanceIndex - particleCount) * u32(uniforms.grid.w);
      kind = 1.0;
    }

    var position = positions[dataIndex];
    var velocity = velocities[dataIndex];
    let home = homes[dataIndex];
    let seed = randomSeeds[dataIndex];
    let aspect = uniforms.viewport.x;
    let uv = vec2f(home.x / aspect * 0.5 + 0.5, 0.5 - home.y * 0.5);
    let masks = maskState(uv, fract(seed * 91.7 + 0.17));
    var particleFade = masks.x * (1.0 - smoothstep(0.5, 0.98, masks.y));
    var gatherBand = 0.0;
    if (kind > 0.5) {
      let enterDirection = normalize(uniforms.directions.zw + vec2f(0.00001));
      let arrival = masks.y;
      position = incomingFlowPosition(home, enterDirection, seed, arrival, aspect, uniforms.style.z);
      let previousArrival = max(arrival - 0.014, 0.0);
      let previousPosition = incomingFlowPosition(
        home, enterDirection, seed, previousArrival, aspect, uniforms.style.z
      );
      velocity = (position - previousPosition) / 0.014;
      particleFade = smoothstep(0.015, 0.14, arrival)
        * (1.0 - smoothstep(0.86, 1.0, arrival)) * 0.9;
      gatherBand = smoothstep(0.03, 0.3, arrival)
        * (1.0 - smoothstep(0.72, 1.0, arrival));
    }

    let velocityNdc = vec2f(velocity.x / aspect, velocity.y);
    let speed = length(velocityNdc);
    let axis = normalize(velocityNdc + vec2f(0.00001, 0.0));
    let normal = vec2f(-axis.y, axis.x);
    let sizeVariation = 0.62 + fract(seed * 37.19) * 0.92;
    let pointPx = uniforms.style.x * sizeVariation * (1.0 + gatherBand * 0.2);
    let stretch = 1.0 + min(speed * 8.0, 3.7) + gatherBand * 1.35;
    let pixelNdc = vec2f(2.0 / uniforms.viewport.z, 2.0 / uniforms.viewport.w);
    let oriented = normal * local.x * pointPx + axis * local.y * pointPx * stretch;
    let center = vec2f(position.x / aspect, position.y);

    var output: ParticleOutput;
    output.position = vec4f(center + oriented * pixelNdc, 0.0, 1.0);
    output.uv = uv;
    output.local = vec2f(local.x, local.y / stretch);
    output.fade = particleFade;
    output.sparkle = fract(seed * 119.73 + 0.31);
    output.gather = masks.y;
    output.kind = kind;
    return output;
  }

  @fragment
  fn particleFragment(input: ParticleOutput) -> @location(0) vec4f {
    let sourceUv = fitUv(input.uv, uniforms.imageSizes.xy);
    let targetUv = fitUv(input.uv, uniforms.imageSizes.zw);
    let source = textureSample(sourceImage, imageSampler, clamp(sourceUv, vec2f(0.0), vec2f(1.0))).rgb;
    let targetColor = textureSample(targetImage, imageSampler, clamp(targetUv, vec2f(0.0), vec2f(1.0))).rgb;
    let progress = uniforms.viewport.y;
    var imageColor = mix(source, targetColor, input.kind);
    let luminance = dot(imageColor, vec3f(0.2126, 0.7152, 0.0722));
    let middle = smoothstep(0.27, 0.48, progress) * (1.0 - smoothstep(0.62, 0.88, progress));
    let ash = mix(vec3f(luminance), vec3f(luminance * 0.82 + 0.14), 0.58);
    imageColor = mix(imageColor, ash, middle * 0.64);
    imageColor += vec3f(0.16, 0.095, 0.045) * middle * input.sparkle;
    let radius = length(input.local * vec2f(0.88, 0.72));
    let halo = 1.0 - smoothstep(0.18, 1.05, radius);
    let core = 1.0 - smoothstep(0.0, 0.34, radius);
    let twinkle = 0.72 + 0.5 * sin(uniforms.style.y * (4.0 + input.sparkle * 7.0) + input.sparkle * 19.0);
    let gatherGlow = smoothstep(0.04, 0.46, input.gather)
      * (1.0 - smoothstep(0.8, 1.0, input.gather));
    let imageCoverage = mix(imageMask(sourceUv), imageMask(targetUv), input.kind);
    let alpha = input.fade * imageCoverage * halo * (0.53 + core * 0.47)
      * clamp(twinkle, 0.42, 1.25) * (1.0 + gatherGlow * 0.58);
    var color = imageColor * (0.88 + core * (0.65 + input.sparkle * 0.5));
    color += vec3f(0.08, 0.12, 0.15) * gatherGlow * (0.35 + input.sparkle * 0.4);
    return vec4f(color * alpha, alpha);
  }
`;

class ParticleShiftEffect implements TransitionEffect {
  readonly canvas = document.createElement('canvas');
  private readonly computeKernel = createComputeKernel();
  private context!: GPUCanvasContext;
  private device!: GPUDevice;
  private format!: GPUTextureFormat;
  private items: LoadedImage[] = [];
  private textures: GPUTexture[] = [];
  private positionBuffer!: Awaited<ReturnType<typeof Buffer.create>>;
  private velocityBuffer!: Awaited<ReturnType<typeof Buffer.create>>;
  private homeBuffer!: Awaited<ReturnType<typeof Buffer.create>>;
  private seedBuffer!: Awaited<ReturnType<typeof Buffer.create>>;
  private renderUniformBuffer!: GPUBuffer;
  private sampler!: GPUSampler;
  private bindGroupLayout!: GPUBindGroupLayout;
  private bindGroup?: GPUBindGroup;
  private planePipeline!: GPURenderPipeline;
  private particlePipeline!: GPURenderPipeline;
  private homeData!: Float32Array;
  private positionData!: Float32Array;
  private velocityData!: Float32Array;
  private seedData!: Float32Array;
  private columns = 1;
  private rows = 1;
  private particleCount = 1;
  private renderParticleCount = 1;
  private aspect = 1;
  private dpr = 1;
  private elapsed = 0;
  private fromIndex = 0;
  private toIndex = 0;
  private reportError: (error: Error) => void = () => undefined;

  async init(context: TransitionEffectContext): Promise<void> {
    this.items = context.items;
    this.reportError = context.reportError;
    const targetParticles = Math.min(300_000, Math.max(16_000, Number(context.options.particleCount ?? 206_976)));
    this.aspect = context.width / Math.max(context.height, 1);
    this.rows = Math.max(32, Math.round(Math.sqrt(targetParticles / Math.max(this.aspect, 0.2))));
    this.columns = Math.max(32, Math.round(this.rows * this.aspect));
    this.particleCount = this.columns * this.rows;
    this.renderParticleCount = this.particleCount + Math.floor(this.particleCount / 2);

    const gpu = await GpuContext.get();
    this.device = gpu.device;
    const canvasContext = this.canvas.getContext('webgpu');
    if (!canvasContext || !navigator.gpu) throw new Error('WebGPU is required for particle-shift.');
    this.context = canvasContext;
    this.format = navigator.gpu.getPreferredCanvasFormat();
    this.context.configure({ device: this.device, format: this.format, alphaMode: 'opaque' });
    context.host.appendChild(this.canvas);

    this.createParticleData(this.aspect);
    await this.createBuffers();
    this.createRenderResources();
    await this.loadTextures();
    await this.createPipelines();
    this.resize(context.width, context.height, context.dpr);
    this.device.lost.then((info) => {
      this.reportError(new Error(`WebGPU device lost: ${info.message || info.reason}`));
    });
  }

  private createParticleData(aspect: number): void {
    this.homeData = new Float32Array(this.particleCount * 2);
    this.positionData = new Float32Array(this.particleCount * 2);
    this.velocityData = new Float32Array(this.particleCount * 2);
    this.seedData = new Float32Array(this.particleCount);
    let index = 0;
    for (let y = 0; y < this.rows; y += 1) {
      for (let x = 0; x < this.columns; x += 1) {
        const u = (x + 0.5) / this.columns;
        const v = (y + 0.5) / this.rows;
        const px = (u * 2 - 1) * aspect;
        const py = 1 - v * 2;
        this.homeData[index * 2] = px;
        this.homeData[index * 2 + 1] = py;
        this.positionData[index * 2] = px;
        this.positionData[index * 2 + 1] = py;
        this.seedData[index] = this.hash(index + 17);
        index += 1;
      }
    }
  }

  private hash(value: number): number {
    let number = value | 0;
    number = Math.imul(number ^ (number >>> 16), 0x21f0aaad);
    number = Math.imul(number ^ (number >>> 15), 0x735a2d97);
    number ^= number >>> 15;
    return (number >>> 0) / 4_294_967_296;
  }

  private async createBuffers(): Promise<void> {
    [this.positionBuffer, this.velocityBuffer, this.homeBuffer, this.seedBuffer] = await Promise.all([
      Buffer.create('vec2f', this.particleCount),
      Buffer.create('vec2f', this.particleCount),
      Buffer.create('vec2f', this.particleCount),
      Buffer.create('f32', this.particleCount),
    ]);
    this.resetBuffers();
    this.homeBuffer.write(this.homeData as Float32Array<ArrayBuffer>);
    this.seedBuffer.write(this.seedData as Float32Array<ArrayBuffer>);
  }

  private resetBuffers(): void {
    this.positionBuffer?.write(this.positionData as Float32Array<ArrayBuffer>);
    this.velocityBuffer?.write(this.velocityData as Float32Array<ArrayBuffer>);
  }

  private createRenderResources(): void {
    this.renderUniformBuffer = this.device.createBuffer({
      label: 'varyloom-particle-uniforms',
      size: 80,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.sampler = this.device.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
      mipmapFilter: 'linear',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
    });
    this.bindGroupLayout = this.device.createBindGroupLayout({
      label: 'varyloom-particle-layout',
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
        { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
        { binding: 2, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
        { binding: 3, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
        { binding: 4, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
        { binding: 5, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
        { binding: 6, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
        { binding: 7, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
      ],
    });
  }

  private async loadTextures(): Promise<void> {
    this.textures = [];
    for (const item of this.items) {
      const texture = this.device.createTexture({
        label: item.caption || item.alt || 'Varyloom image',
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

  private async createPipelines(): Promise<void> {
    const module = this.device.createShaderModule({ label: 'varyloom-particle-shader', code: renderShader });
    const diagnostics = await module.getCompilationInfo();
    const errors = diagnostics.messages.filter((message) => message.type === 'error');
    if (errors.length) {
      throw new Error(errors.map((error) => `WGSL ${error.lineNum}:${error.linePos} ${error.message}`).join('\n'));
    }
    const layout = this.device.createPipelineLayout({ bindGroupLayouts: [this.bindGroupLayout] });
    this.planePipeline = await this.device.createRenderPipelineAsync({
      label: 'varyloom-particle-plane',
      layout,
      vertex: { module, entryPoint: 'planeVertex' },
      fragment: { module, entryPoint: 'planeFragment', targets: [{ format: this.format }] },
      primitive: { topology: 'triangle-list' },
    });
    this.particlePipeline = await this.device.createRenderPipelineAsync({
      label: 'varyloom-particle-billboards',
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
    this.resetBuffers();
    this.bindGroup = this.device.createBindGroup({
      label: `varyloom-particle-pair-${fromIndex}-${toIndex}`,
      layout: this.bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.positionBuffer.gpuBuffer } },
        { binding: 1, resource: { buffer: this.velocityBuffer.gpuBuffer } },
        { binding: 2, resource: { buffer: this.homeBuffer.gpuBuffer } },
        { binding: 3, resource: { buffer: this.seedBuffer.gpuBuffer } },
        { binding: 4, resource: { buffer: this.renderUniformBuffer } },
        { binding: 5, resource: this.sampler },
        { binding: 6, resource: this.textures[fromIndex].createView() },
        { binding: 7, resource: this.textures[toIndex].createView() },
      ],
    });
  }

  resize(width: number, height: number, dpr: number): void {
    this.dpr = dpr;
    const nextAspect = width / Math.max(height, 1);
    const pixelWidth = Math.max(1, Math.round(width * dpr));
    const pixelHeight = Math.max(1, Math.round(height * dpr));
    this.canvas.width = pixelWidth;
    this.canvas.height = pixelHeight;
    if (Math.abs(nextAspect - this.aspect) > 0.002 && this.homeBuffer) {
      this.aspect = nextAspect;
      this.createParticleData(this.aspect);
      this.homeBuffer.write(this.homeData as Float32Array<ArrayBuffer>);
      this.seedBuffer.write(this.seedData as Float32Array<ArrayBuffer>);
      this.resetBuffers();
    }
  }

  private resolveDirections(frame: TransitionFrame): {
    exit: [number, number];
    enter: [number, number];
  } {
    const options = frame.options as { exitDirection?: ExitDirection | 'auto'; enterDirection?: EnterDirection };
    const exitName: ExitDirection = options.exitDirection === 'auto'
      ? frame.direction > 0 ? 'right' : 'left'
      : options.exitDirection ?? 'right';
    const enterName = options.enterDirection ?? OPPOSITE_ENTER[exitName];
    return { exit: EXIT_VECTORS[exitName], enter: ENTER_VECTORS[enterName] };
  }

  private kernelResources() {
    return {
      pos: this.positionBuffer,
      vel: this.velocityBuffer,
      home: this.homeBuffer,
      seeds: this.seedBuffer,
    };
  }

  async render(frame: TransitionFrame): Promise<void> {
    if (!this.bindGroup) return;
    const options = frame.options as {
      turbulence?: number;
      particleSize?: number;
      imageFit?: VaryloomImageFit;
    };
    const directions = this.resolveDirections(frame);
    if (frame.active) {
      const targetElapsed = Math.min(1, Math.max(0, frame.progress)) * MOTION_REFERENCE_DURATION;
      const rewinding = targetElapsed + 0.0001 < this.elapsed;
      if (rewinding) {
        this.resetBuffers();
        this.elapsed = 0;
      }

      const remaining = Math.max(0, targetElapsed - this.elapsed);
      const maxSteps = rewinding ? 8 : 2;
      const steps = Math.min(maxSteps, Math.max(1, Math.ceil(remaining / (1 / 20))));
      const stepDelta = remaining / steps;
      for (let step = 0; step < steps && stepDelta > 0.000001; step += 1) {
        this.elapsed += stepDelta;
        await this.computeKernel.run(this.kernelResources(), {
          dt: stepDelta,
          progress: Math.min(frame.progress, this.elapsed / MOTION_REFERENCE_DURATION),
          time: this.elapsed,
          exitX: directions.exit[0],
          exitY: directions.exit[1],
          enterX: directions.enter[0],
          enterY: directions.enter[1],
          aspect: this.aspect,
          turbulence: options.turbulence ?? 1,
        });
      }
    }

    const pointSize = Math.max(1.45 * this.dpr, (this.canvas.width / this.columns) * 1.06)
      * (options.particleSize ?? 1);
    const sourceItem = this.items[this.fromIndex];
    const targetItem = this.items[this.toIndex];
    this.device.queue.writeBuffer(this.renderUniformBuffer, 0, new Float32Array([
      this.aspect, frame.progress, this.canvas.width, this.canvas.height,
      directions.exit[0], directions.exit[1], directions.enter[0], directions.enter[1],
      pointSize, this.elapsed, options.turbulence ?? 1, options.imageFit === 'contain' ? 1 : 0,
      this.columns, this.rows, this.particleCount, 2,
      sourceItem.width, sourceItem.height, targetItem.width, targetItem.height,
    ]));

    const encoder = this.device.createCommandEncoder({ label: 'varyloom-particle-frame' });
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: this.context.getCurrentTexture().createView(),
        clearValue: { r: 0.007, g: 0.009, b: 0.011, a: 1 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });
    pass.setBindGroup(0, this.bindGroup);
    pass.setPipeline(this.planePipeline);
    pass.draw(3);
    pass.setPipeline(this.particlePipeline);
    pass.draw(6, this.renderParticleCount);
    pass.end();
    this.device.queue.submit([encoder.finish()]);
  }

  destroy(): void {
    this.computeKernel.destroy();
    this.positionBuffer?.destroy();
    this.velocityBuffer?.destroy();
    this.homeBuffer?.destroy();
    this.seedBuffer?.destroy();
    this.renderUniformBuffer?.destroy();
    this.textures.forEach((texture) => texture.destroy());
    this.context?.unconfigure();
    this.canvas.remove();
  }
}

export const particleShiftTransition = defineTransition({
  name: 'particle-shift',
  backend: 'webgpu',
  phaseEasing: 'none',
  defaults: {
    particleCount: 206_976,
    particleSize: 1,
    turbulence: 1,
    exitDirection: 'right',
    imageFit: 'cover',
  },
  supported: () => typeof navigator !== 'undefined' && Boolean(navigator.gpu),
  create: () => new ParticleShiftEffect(),
});
