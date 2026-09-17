import { defineTransition } from '../registry';
import type { Direction, PrismorphImageFit } from '../types';
import { WebGpuParticleLayerEffect } from './webgpu-particle-layer';

export type FiberFlowDirection = 'auto' | 'right' | 'left' | 'down';

export interface FiberFlowOptions {
  strandCount?: number;
  segmentsPerStrand?: number;
  width?: number;
  density?: number;
  curl?: number;
  glow?: number;
  direction?: FiberFlowDirection;
  imageFit?: PrismorphImageFit;
}

function counts(options: Readonly<Record<string, unknown>>): { strands: number; segments: number } {
  return {
    strands: Math.min(1_000, Math.max(96, Math.round(Number(options.strandCount ?? 520)))),
    segments: Math.min(128, Math.max(12, Math.round(Number(options.segmentsPerStrand ?? 64)))),
  };
}

function createShader(options: Readonly<Record<string, unknown>>): string {
  const { strands, segments } = counts(options);
  return /* wgsl */ `
    struct Uniforms {
      viewport: vec4f,
      motion: vec4f,
      look: vec4f,
      sourceSize: vec4f,
      nextSize: vec4f,
      misc: vec4f,
    };

    @group(0) @binding(0) var<storage, read> segments: array<vec4f>;
    @group(0) @binding(1) var<uniform> uniforms: Uniforms;
    @group(0) @binding(2) var imageSampler: sampler;
    @group(0) @binding(3) var sourceImage: texture_2d<f32>;
    @group(0) @binding(4) var nextImage: texture_2d<f32>;

    fn hash11(value: f32) -> f32 {
      return fract(sin(value * 127.113 + 17.17) * 43758.5453123);
    }

    fn hash12(point: vec2f) -> f32 {
      let p3 = fract(vec3f(point.xyx) * 0.1031);
      let mixed = p3 + dot(p3, p3.yzx + 33.33);
      return fract((mixed.x + mixed.y) * mixed.z);
    }

    fn noise2(point: vec2f) -> f32 {
      let cell = floor(point);
      let local = fract(point);
      let curve = local * local * (3.0 - 2.0 * local);
      return mix(
        mix(hash12(cell), hash12(cell + vec2f(1.0, 0.0)), curve.x),
        mix(hash12(cell + vec2f(0.0, 1.0)), hash12(cell + vec2f(1.0, 1.0)), curve.x),
        curve.y
      );
    }

    fn fbm(point: vec2f) -> f32 {
      var sum = 0.0;
      var amplitude = 0.52;
      var p = point;
      for (var octave = 0; octave < 4; octave = octave + 1) {
        sum += noise2(p) * amplitude;
        p = mat2x2f(1.73, -1.03, 1.03, 1.73) * p + vec2f(4.1, 2.8);
        amplitude *= 0.48;
      }
      return sum;
    }

    fn fittedUv(uv: vec2f, imageSize: vec2f, contain: f32) -> vec3f {
      let viewAspect = uniforms.viewport.z / max(uniforms.viewport.w, 1.0);
      let imageAspect = imageSize.x / max(imageSize.y, 1.0);
      var mapped = uv;
      if (contain > 0.5) {
        if (imageAspect > viewAspect) {
          let displayHeight = viewAspect / imageAspect;
          mapped.y = (uv.y - 0.5) / displayHeight + 0.5;
        } else {
          let displayWidth = imageAspect / viewAspect;
          mapped.x = (uv.x - 0.5) / displayWidth + 0.5;
        }
      } else {
        if (imageAspect > viewAspect) { mapped.x = (uv.x - 0.5) * viewAspect / imageAspect + 0.5; }
        else { mapped.y = (uv.y - 0.5) * imageAspect / viewAspect + 0.5; }
      }
      let inside = step(0.0, mapped.x) * step(mapped.x, 1.0) * step(0.0, mapped.y) * step(mapped.y, 1.0);
      return vec3f(mapped, inside);
    }

    fn sampleImage(uv: vec2f, imageTexture: texture_2d<f32>, imageSize: vec2f) -> vec3f {
      let fit = fittedUv(uv, imageSize, uniforms.look.z);
      let imageColor = textureSampleLevel(imageTexture, imageSampler, clamp(fit.xy, vec2f(0.0), vec2f(1.0)), 0.0).rgb;
      let coverUv = fittedUv(uv, imageSize, 0.0).xy;
      let backdrop = textureSampleLevel(imageTexture, imageSampler, coverUv, 0.0).rgb;
      let muted = vec3f(dot(backdrop, vec3f(0.2126, 0.7152, 0.0722))) * 0.055 + backdrop * 0.035;
      return mix(muted, imageColor, fit.z);
    }

    fn flowCoord(uv: vec2f) -> f32 {
      let direction = uniforms.look.y;
      if (direction < 0.5) { return uv.x; }
      if (direction < 1.5) { return 1.0 - uv.x; }
      return uv.y;
    }

    fn toUv(flow: f32, cross: f32) -> vec2f {
      let direction = uniforms.look.y;
      if (direction < 0.5) { return vec2f(flow, cross); }
      if (direction < 1.5) { return vec2f(1.0 - flow, cross); }
      return vec2f(cross, flow);
    }

    struct PlaneOutput {
      @builtin(position) position: vec4f,
      @location(0) uv: vec2f,
    };

    @vertex
    fn planeVertex(@builtin(vertex_index) vertexIndex: u32) -> PlaneOutput {
      var vertices = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
      let point = vertices[vertexIndex];
      var output: PlaneOutput;
      output.position = vec4f(point, 0.0, 1.0);
      output.uv = vec2f(point.x * 0.5 + 0.5, 0.5 - point.y * 0.5);
      return output;
    }

    @fragment
    fn planeFragment(input: PlaneOutput) -> @location(0) vec4f {
      let uv = input.uv;
      let progress = uniforms.viewport.y;
      if (progress <= 0.001) { return vec4f(sampleImage(uv, sourceImage, uniforms.sourceSize.xy), 1.0); }
      if (progress >= 0.999) { return vec4f(sampleImage(uv, nextImage, uniforms.nextSize.xy), 1.0); }
      let sourceColor = sampleImage(uv, sourceImage, uniforms.sourceSize.xy);
      let targetColor = sampleImage(uv, nextImage, uniforms.nextSize.xy);
      let sourceGuard = 1.0 - smoothstep(0.012, 0.052, progress);
      let targetGuard = smoothstep(0.948, 0.995, progress);
      let ambient = vec3f(0.003, 0.006, 0.008) + vec3f(0.004 * (0.5 + 0.5 * sin(uv.y * 8.0)));
      var color = mix(ambient, sourceColor, sourceGuard);
      color = mix(color, targetColor, targetGuard);
      return vec4f(max(color, vec3f(0.0)), 1.0);
    }

    struct ParticleOutput {
      @builtin(position) position: vec4f,
      @location(0) local: vec2f,
      @location(1) sampleUv: vec2f,
      @location(2) alpha: f32,
      @location(3) mode: f32,
      @location(4) movement: f32,
      @location(5) seed: f32,
      @location(6) depth: f32,
    };

    fn strandEvent(flow: f32, base: f32, seed: f32) -> f32 {
      let broad = noise2(vec2f(base * 4.3 + seed * 2.0, base * 11.0 - seed * 3.0)) - 0.5;
      let fine = hash11(seed * 89.0 + floor(base * 521.0)) - 0.5;
      return clamp(0.035 + flow * 0.93 + broad * 0.075 + fine * 0.022, 0.012, 0.988);
    }

    fn deformedUv(flow: f32, base: f32, seed: f32, depth: f32, mode: f32, progress: f32) -> vec2f {
      let event = strandEvent(flow, base, seed);
      let curl = uniforms.motion.w;
      var movedFlow = flow;
      var movedCross = base;
      if (mode > 0.5) {
        let life = clamp((progress - event) / 0.17, 0.0, 1.25);
        let travel = life * life;
        movedFlow += travel * mix(0.045, 0.22, depth);
        movedCross += sin(flow * 14.0 + seed * 39.0 + life * 6.0) * travel * curl * mix(0.016, 0.072, depth);
        movedCross += sin(flow * 31.0 - seed * 21.0) * travel * curl * 0.010;
      } else {
        let arrival = clamp((progress - event + 0.14) / 0.23, 0.0, 1.0);
        let remaining = 1.0 - smoothstep(0.0, 1.0, arrival);
        movedFlow -= remaining * mix(0.055, 0.21, depth);
        movedCross += sin(flow * 13.0 - seed * 43.0 + arrival * 5.0) * remaining * curl * mix(0.018, 0.078, depth);
        movedCross += sin(flow * 29.0 + seed * 17.0) * remaining * curl * 0.011;
      }
      return toUv(movedFlow, movedCross);
    }

    @vertex
    fn particleVertex(
      @builtin(vertex_index) vertexIndex: u32,
      @builtin(instance_index) instanceIndex: u32
    ) -> ParticleOutput {
      var corners = array<vec2f, 6>(
        vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
        vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0)
      );
      let local = corners[vertexIndex];
      let segment = segments[instanceIndex];
      let t = segment.x;
      let base = segment.y;
      let seed = segment.z;
      let mode = select(0.0, 1.0, segment.w > 0.0);
      let depth = abs(segment.w);
      let progress = uniforms.viewport.y;
      let envelope = smoothstep(0.012, 0.052, progress) * (1.0 - smoothstep(0.948, 0.996, progress));
      let segmentSpan = 1.0 / ${segments}.0;
      let flow0 = t - segmentSpan * 0.59;
      let flow1 = t + segmentSpan * 0.59;
      let uv0 = deformedUv(flow0, base, seed, depth, mode, progress);
      let uv1 = deformedUv(flow1, base, seed, depth, mode, progress);
      let pixel0 = vec2f(uv0.x * uniforms.viewport.z, uv0.y * uniforms.viewport.w);
      let pixel1 = vec2f(uv1.x * uniforms.viewport.z, uv1.y * uniforms.viewport.w);
      let tangent = normalize(pixel1 - pixel0 + vec2f(0.00001));
      let normal = vec2f(-tangent.y, tangent.x);
      let centerPixel = (pixel0 + pixel1) * 0.5;
      let event = strandEvent(t, base, seed);
      var strandAlpha = 0.0;
      var movement = 0.0;
      if (mode > 0.5) {
        let life = clamp((progress - event) / 0.17, 0.0, 1.25);
        strandAlpha = 1.0 - smoothstep(0.18, 0.94, life);
        movement = clamp(life, 0.0, 1.0);
      } else {
        let arrival = clamp((progress - event + 0.14) / 0.23, 0.0, 1.0);
        strandAlpha = smoothstep(0.08, 0.72, arrival);
        movement = 1.0 - smoothstep(0.0, 1.0, arrival);
      }
      let halfLength = length(pixel1 - pixel0) * mix(0.58, 1.46, movement);
      let crossPixels = select(uniforms.viewport.w, uniforms.viewport.z, uniforms.look.y > 1.5);
      let rowSpacing = crossPixels / ${strands}.0;
      let widthPx = rowSpacing * uniforms.motion.y * mix(0.54, 0.84, depth)
        * mix(0.92, 1.08, hash11(seed * 29.0))
        * mix(1.0, mix(0.34, 0.52, uniforms.motion.z), movement);
      let positionPixel = centerPixel + tangent * local.x * halfLength + normal * local.y * widthPx;
      let position = vec2f(positionPixel.x / uniforms.viewport.z * 2.0 - 1.0, 1.0 - positionPixel.y / uniforms.viewport.w * 2.0);
      var output: ParticleOutput;
      output.position = vec4f(position, 0.0, 1.0);
      output.local = local;
      let sampleFlow0 = t - segmentSpan * 0.5;
      let sampleFlow1 = t + segmentSpan * 0.5;
      output.sampleUv = toUv(mix(sampleFlow0, sampleFlow1, local.x * 0.5 + 0.5), base);
      output.alpha = envelope * strandAlpha;
      output.mode = mode;
      output.movement = movement;
      output.seed = seed;
      output.depth = depth;
      return output;
    }

    @fragment
    fn particleFragment(input: ParticleOutput) -> @location(0) vec4f {
      let cap = 1.0 - smoothstep(0.82, 1.0, abs(input.local.x));
      let core = 1.0 - smoothstep(0.48, 0.66, abs(input.local.y));
      let halo = 1.0 - smoothstep(0.46, 1.0, abs(input.local.y));
      let outerHalo = max(halo - core, 0.0);
      let haloStrength = input.movement * uniforms.look.x;
      let fibreMask = cap * max(core, outerHalo * haloStrength * 0.22);
      let shapeReveal = smoothstep(0.035, 0.28, input.movement);
      let alpha = input.alpha * mix(1.0, fibreMask, shapeReveal);
      if (alpha < 0.002) { discard; }
      var sampled = sampleImage(input.sampleUv, nextImage, uniforms.nextSize.xy);
      if (input.mode > 0.5) { sampled = sampleImage(input.sampleUv, sourceImage, uniforms.sourceSize.xy); }
      let spectral = 0.5 + 0.5 * cos(vec3f(0.0, 2.094, 4.188) + input.seed * 17.0 + input.depth * 6.0);
      let accentFiber = smoothstep(0.965, 0.995, hash11(input.seed * 109.0));
      var color = mix(sampled, spectral, accentFiber * input.movement * uniforms.look.x * 0.10);
      color = mix(color, vec3f(1.0), outerHalo * haloStrength * 0.42);
      color *= 0.96 + input.movement * uniforms.look.x * 0.16;
      return vec4f(color * alpha, alpha);
    }
  `;
}

function hash(value: number): number {
  let number = value | 0;
  number = Math.imul(number ^ (number >>> 16), 0x21f0aaad);
  number = Math.imul(number ^ (number >>> 15), 0x735a2d97);
  number ^= number >>> 15;
  return (number >>> 0) / 4_294_967_296;
}

function createInstanceData(options: Readonly<Record<string, unknown>>): Float32Array {
  const { strands, segments } = counts(options);
  const fieldSize = strands * segments;
  const data = new Float32Array(fieldSize * 2 * 4);
  for (let field = 0; field < 2; field += 1) {
    for (let strand = 0; strand < strands; strand += 1) {
      const seed = hash(strand * 83 + field * 997 + 17) * 0.999 + 0.0005;
      const jitter = (hash(strand * 31 + field * 641 + 7) - 0.5) * 0.42 / strands;
      const base = Math.min(0.9995, Math.max(0.0005, (strand + 0.5) / strands + jitter));
      const depth = 0.08 + hash(strand * 47 + field * 379 + 29) * 0.92;
      for (let segment = 0; segment < segments; segment += 1) {
        const offset = (field * fieldSize + strand * segments + segment) * 4;
        data[offset] = (segment + 0.5) / segments;
        data[offset + 1] = base;
        data[offset + 2] = seed;
        data[offset + 3] = field === 0 ? depth : -depth;
      }
    }
  }
  return data;
}

function directionValue(options: Readonly<Record<string, unknown>>, direction: Direction): number {
  const requested = options.direction as FiberFlowDirection | undefined;
  const resolved = requested === 'auto' || !requested ? (direction > 0 ? 'right' : 'left') : requested;
  return resolved === 'left' ? 1 : resolved === 'down' ? 2 : 0;
}

export const fiberFlowTransition = defineTransition({
  name: 'fiber-flow',
  backend: 'webgpu',
  phaseEasing: 'none',
  defaults: {
    strandCount: 520,
    segmentsPerStrand: 64,
    width: 1.55,
    density: 0.66,
    curl: 0.6,
    glow: 0.64,
    direction: 'auto',
    imageFit: 'cover',
  },
  supported: () => typeof navigator !== 'undefined' && Boolean(navigator.gpu),
  create: () => new WebGpuParticleLayerEffect({
    label: 'prismorph-fiber-flow',
    createShader,
    createInstanceData,
    parameters: (options, dpr, direction) => [
      Number(options.width ?? 1.55) * dpr,
      Number(options.density ?? 0.66),
      Number(options.curl ?? 0.6),
      Number(options.glow ?? 0.64),
      directionValue(options, direction),
    ],
  }),
});

