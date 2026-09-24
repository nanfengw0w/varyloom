import { defineTransition } from '../registry';
import type { Direction, VaryloomImageFit } from '../types';
import { WebGpuParticleLayerEffect } from './webgpu-particle-layer';

export type ChromaticDustDirection = 'auto' | 'right' | 'left' | 'radial';

export interface ChromaticDustOptions {
  crystalCount?: number;
  crystalSize?: number;
  density?: number;
  turbulence?: number;
  dispersion?: number;
  direction?: ChromaticDustDirection;
  imageFit?: VaryloomImageFit;
}

const shader = /* wgsl */ `
  struct Uniforms {
    viewport: vec4f,
    motion: vec4f,
    look: vec4f,
    sourceSize: vec4f,
    nextSize: vec4f,
    misc: vec4f,
  };

  @group(0) @binding(0) var<storage, read> particles: array<vec4f>;
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
    var amplitude = 0.53;
    var p = point;
    for (var octave = 0; octave < 5; octave = octave + 1) {
      sum += noise2(p) * amplitude;
      p = mat2x2f(1.71, -1.08, 1.08, 1.71) * p + vec2f(3.7, 5.2);
      amplitude *= 0.47;
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
    let safeUv = clamp(fit.xy, vec2f(0.0), vec2f(1.0));
    let imageColor = textureSampleLevel(imageTexture, imageSampler, safeUv, 0.0).rgb;
    let coverFit = fittedUv(uv, imageSize, 0.0);
    let backdrop = textureSampleLevel(imageTexture, imageSampler, coverFit.xy, 0.0).rgb;
    let luma = dot(backdrop, vec3f(0.2126, 0.7152, 0.0722));
    return mix(vec3f(luma) * 0.075 + backdrop * 0.025, imageColor, fit.z);
  }

  fn flowCoord(uv: vec2f) -> f32 {
    let direction = uniforms.look.y;
    if (direction < 0.5) { return uv.x; }
    if (direction < 1.5) { return 1.0 - uv.x; }
    return length((uv - vec2f(0.5)) * vec2f(uniforms.viewport.x, 1.0))
      / max(0.5 * length(vec2f(uniforms.viewport.x, 1.0)), 0.001);
  }

  fn flowVector(uv: vec2f) -> vec2f {
    let direction = uniforms.look.y;
    if (direction < 0.5) { return vec2f(1.0, 0.0); }
    if (direction < 1.5) { return vec2f(-1.0, 0.0); }
    return normalize((uv - vec2f(0.5)) * vec2f(uniforms.viewport.x, 1.0) + vec2f(0.0001));
  }

  fn transitionTime(uv: vec2f) -> f32 {
    let coarse = fbm(uv * vec2f(4.2, 3.4) + vec2f(2.1, -4.7));
    let fine = noise2(uv * vec2f(18.0, 13.0) + vec2f(-7.4, 1.8));
    return clamp(0.08 + flowCoord(uv) * 0.84 + (coarse - 0.48) * 0.115 + (fine - 0.5) * 0.025, 0.025, 0.975);
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
    let event = transitionTime(uv);
    let mask = smoothstep(event - 0.035, event + 0.045, progress);
    let edge = 1.0 - smoothstep(0.0, 0.095, abs(progress - event));
    let direction = flowVector(uv);
    let dispersion = uniforms.look.x;
    let shift = direction * edge * dispersion * 0.0065;
    let oldR = sampleImage(uv + shift, sourceImage, uniforms.sourceSize.xy).r;
    let oldG = sampleImage(uv, sourceImage, uniforms.sourceSize.xy).g;
    let oldB = sampleImage(uv - shift, sourceImage, uniforms.sourceSize.xy).b;
    let newR = sampleImage(uv - shift, nextImage, uniforms.nextSize.xy).r;
    let newG = sampleImage(uv, nextImage, uniforms.nextSize.xy).g;
    let newB = sampleImage(uv + shift, nextImage, uniforms.nextSize.xy).b;
    var color = mix(vec3f(oldR, oldG, oldB), vec3f(newR, newG, newB), mask);
    let spectral = 0.5 + 0.5 * cos(vec3f(0.0, 2.1, 4.2) + flowCoord(uv) * 13.0 + progress * 8.0);
    color += spectral * edge * dispersion * 0.075;
    color *= 1.0 - edge * 0.08;
    return vec4f(max(color, vec3f(0.0)), 1.0);
  }

  struct ParticleOutput {
    @builtin(position) position: vec4f,
    @location(0) local: vec2f,
    @location(1) homeUv: vec2f,
    @location(2) alpha: f32,
    @location(3) seed: f32,
    @location(4) mode: f32,
  };

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
    let particle = particles[instanceIndex];
    let home = particle.xy;
    let seed = particle.z;
    let outgoing = select(0.0, 1.0, particle.w > 0.0);
    let progress = uniforms.viewport.y;
    let event = transitionTime(home);
    let direction = flowVector(home);
    let tangent = vec2f(-direction.y, direction.x);
    let turbulence = uniforms.motion.w;
    let densityGate = step(1.0 - uniforms.motion.z, hash11(seed * 53.7));
    var center = home;
    var alpha = 0.0;
    var life = 0.0;
    if (outgoing > 0.5) {
      life = (progress - event + 0.025) / 0.235;
      let visibility = smoothstep(0.0, 0.11, life) * (1.0 - smoothstep(0.66, 1.0, life));
      let travel = max(life, 0.0);
      let swirl = sin(seed * 41.0 + travel * 8.0) * turbulence;
      center += direction * travel * travel * mix(0.07, 0.31, hash11(seed * 17.0));
      center += tangent * (sin(travel * 7.0 + seed * 29.0) * 0.027 + swirl * 0.015) * travel;
      alpha = visibility * densityGate;
    } else {
      life = (progress - event + 0.13) / 0.29;
      let visibility = smoothstep(0.0, 0.13, life) * (1.0 - smoothstep(0.72, 1.0, life));
      let arrival = smoothstep(0.02, 0.88, life);
      let remaining = 1.0 - arrival;
      center -= direction * remaining * mix(0.055, 0.22, hash11(seed * 19.0));
      center += tangent * sin(seed * 37.0 + life * 9.0) * remaining * turbulence * 0.055;
      alpha = visibility * densityGate * 0.92;
    }
    let randomSize = mix(0.48, 2.8, pow(hash11(seed * 73.0), 2.1));
    let sizePx = uniforms.motion.y * randomSize * mix(0.8, 1.22, sin(clamp(life, 0.0, 1.0) * 3.14159));
    let angle = seed * 31.0 + life * mix(-2.7, 2.7, hash11(seed * 13.0));
    let rotation = mat2x2f(cos(angle), -sin(angle), sin(angle), cos(angle));
    let shape = vec2f(mix(0.45, 1.0, hash11(seed * 7.0)), mix(0.7, 1.5, hash11(seed * 11.0)));
    let rotated = rotation * (local * shape);
    let ndc = vec2f(center.x * 2.0 - 1.0, 1.0 - center.y * 2.0);
    let pixelToNdc = vec2f(2.0 / uniforms.viewport.z, 2.0 / uniforms.viewport.w);
    var output: ParticleOutput;
    output.position = vec4f(ndc + rotated * sizePx * pixelToNdc, 0.0, 1.0);
    output.local = local;
    output.homeUv = home;
    output.alpha = alpha;
    output.seed = seed;
    output.mode = outgoing;
    return output;
  }

  @fragment
  fn particleFragment(input: ParticleOutput) -> @location(0) vec4f {
    let diamond = abs(input.local.x) + abs(input.local.y);
    let notch = sin(atan2(input.local.y, input.local.x) * 4.0 + input.seed * 31.0) * 0.055;
    let edge = 1.0 - smoothstep(0.72 + notch, 1.02 + notch, diamond);
    let alpha = edge * input.alpha;
    if (alpha < 0.002) { discard; }
    var sampled = sampleImage(input.homeUv, nextImage, uniforms.nextSize.xy);
    if (input.mode > 0.5) { sampled = sampleImage(input.homeUv, sourceImage, uniforms.sourceSize.xy); }
    let prism = 0.5 + 0.5 * cos(vec3f(0.0, 2.094, 4.188) + input.seed * 19.0);
    let dispersion = uniforms.look.x;
    var color = mix(sampled, prism, 0.08 + dispersion * 0.25);
    let facet = smoothstep(0.72, 0.0, diamond) * (0.35 + 0.65 * hash11(input.seed * 97.0));
    color = color * (0.72 + facet * 1.05) + vec3f(facet * dispersion * 0.35);
    return vec4f(color * alpha, alpha);
  }
`;

function hash(value: number): number {
  let number = value | 0;
  number = Math.imul(number ^ (number >>> 16), 0x21f0aaad);
  number = Math.imul(number ^ (number >>> 15), 0x735a2d97);
  number ^= number >>> 15;
  return (number >>> 0) / 4_294_967_296;
}

function createInstanceData(options: Readonly<Record<string, unknown>>): Float32Array {
  const perField = Math.min(80_000, Math.max(4_000, Math.round(Number(options.crystalCount ?? 30_000))));
  const data = new Float32Array(perField * 2 * 4);
  const columns = Math.ceil(Math.sqrt(perField * 1.65));
  const rows = Math.ceil(perField / columns);
  for (let field = 0; field < 2; field += 1) {
    for (let index = 0; index < perField; index += 1) {
      const offset = (field * perField + index) * 4;
      const column = index % columns;
      const row = Math.floor(index / columns);
      data[offset] = (column + hash(index * 17 + field * 131)) / columns;
      data[offset + 1] = (row + hash(index * 29 + field * 197)) / rows;
      data[offset + 2] = hash(index * 47 + field * 263) * 0.999 + 0.0005;
      const sizeSeed = 0.2 + hash(index * 71 + field * 311) * 0.8;
      data[offset + 3] = field === 0 ? sizeSeed : -sizeSeed;
    }
  }
  return data;
}

function directionValue(options: Readonly<Record<string, unknown>>, direction: Direction): number {
  const requested = options.direction as ChromaticDustDirection | undefined;
  const resolved = requested === 'auto' || !requested ? (direction > 0 ? 'right' : 'left') : requested;
  return resolved === 'left' ? 1 : resolved === 'radial' ? 2 : 0;
}

export const chromaticDustTransition = defineTransition({
  name: 'chromatic-dust',
  backend: 'webgpu',
  phaseEasing: 'none',
  defaults: {
    crystalCount: 30_000,
    crystalSize: 1.45,
    density: 0.78,
    turbulence: 0.62,
    dispersion: 0.56,
    direction: 'auto',
    imageFit: 'cover',
  },
  supported: () => typeof navigator !== 'undefined' && Boolean(navigator.gpu),
  create: () => new WebGpuParticleLayerEffect({
    label: 'varyloom-chromatic-dust',
    createShader: () => shader,
    createInstanceData,
    parameters: (options, dpr, direction) => [
      Number(options.crystalSize ?? 1.45) * dpr,
      Number(options.density ?? 0.78),
      Number(options.turbulence ?? 0.62),
      Number(options.dispersion ?? 0.56),
      directionValue(options, direction),
    ],
  }),
});

