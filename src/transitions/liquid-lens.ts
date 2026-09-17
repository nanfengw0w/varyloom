import { defineTransition } from '../registry';
import type {
  Direction,
  LoadedImage,
  PrismorphImageFit,
  TransitionEffect,
  TransitionEffectContext,
  TransitionFrame,
  TransitionPointer,
} from '../types';
import {
  bindWebGL2Texture,
  createWebGL2Program,
  createWebGL2Texture,
} from './webgl2-utils';

export type LiquidLensOrigin = 'pointer' | 'center' | readonly [number, number];

export interface LiquidLensOptions {
  /** Number of independently seeded liquid drops. */
  dropCount?: number;
  /** Strength of the optical displacement inside each liquid surface. */
  refraction?: number;
  /** Tightness and visual thickness of the merged liquid boundary. */
  surfaceTension?: number;
  /** Strength of the travelling surface ripple and caustic response. */
  ripple?: number;
  /** RGB separation around the liquid rim. */
  dispersion?: number;
  /** Rate at which independent drops expand into the shared liquid field. */
  mergeSpeed?: number;
  /** Liquid attraction origin, a preset or normalized `[x, y]` coordinates. */
  origin?: LiquidLensOrigin;
  /** How each image is fitted inside the transition viewport. */
  imageFit?: PrismorphImageFit;
}

const fragmentShader = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;

uniform sampler2D uCurrent;
uniform sampler2D uNext;
uniform vec2 uResolution;
uniform vec2 uCurrentSize;
uniform vec2 uNextSize;
uniform vec2 uOrigin;
uniform float uProgress;
uniform float uTime;
uniform float uImageFit;
uniform float uDropCount;
uniform float uRefraction;
uniform float uSurfaceTension;
uniform float uRipple;
uniform float uDispersion;
uniform float uMergeSpeed;

const float PI = 3.14159265359;
const vec3 BACKDROP = vec3(0.006, 0.013, 0.014);

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float smoother(float x) {
  x = clamp(x, 0.0, 1.0);
  return x * x * x * (x * (x * 6.0 - 15.0) + 10.0);
}

vec2 fitUV(vec2 uv, vec2 imageSize) {
  float viewAspect = uResolution.x / max(uResolution.y, 1.0);
  float imageAspect = imageSize.x / max(imageSize.y, 1.0);
  float ratio = viewAspect / max(imageAspect, 0.0001);
  vec2 scale = vec2(1.0);
  if (uImageFit > 0.5) {
    if (ratio > 1.0) scale.x = ratio;
    else scale.y = 1.0 / ratio;
  } else {
    if (ratio > 1.0) scale.y = 1.0 / ratio;
    else scale.x = ratio;
  }
  return (uv - 0.5) * scale + 0.5;
}

float imageMask(vec2 uv) {
  if (uImageFit < 0.5) return 1.0;
  vec2 inside = step(vec2(0.0), uv) * step(uv, vec2(1.0));
  return inside.x * inside.y;
}

vec3 sampleImage(sampler2D tex, vec2 screenUv, vec2 imageSize) {
  vec2 uv = fitUV(screenUv, imageSize);
  return mix(BACKDROP, texture(tex, clamp(uv, 0.0, 1.0)).rgb, imageMask(uv));
}

vec3 sampleDispersed(sampler2D tex, vec2 screenUv, vec2 imageSize, vec2 split) {
  vec2 uv = fitUV(screenUv, imageSize);
  float coverage = imageMask(uv);
  vec3 sampled = vec3(
    texture(tex, clamp(uv + split, 0.0, 1.0)).r,
    texture(tex, clamp(uv, 0.0, 1.0)).g,
    texture(tex, clamp(uv - split, 0.0, 1.0)).b
  );
  return mix(BACKDROP, sampled, coverage);
}

vec2 dropCenter(float index, float phase) {
  float seedA = hash21(vec2(index * 7.17 + 2.3, index * 1.91 + 8.4));
  float seedB = hash21(vec2(index * 3.73 + 9.2, index * 5.41 + 1.7));
  vec2 center = vec2(0.10 + seedA * 0.80, 0.10 + seedB * 0.80);
  float attraction = smoother(phase) * (0.04 + hash21(vec2(index, 4.1)) * 0.09);
  center = mix(center, uOrigin, attraction);
  float orbit = (1.0 - phase) * 0.016;
  center += vec2(cos(index * 2.4 + uTime * 0.23), sin(index * 1.7 - uTime * 0.19)) * orbit;
  return center;
}

float liquidPotential(vec2 uv, float progress) {
  float aspect = uResolution.x / max(uResolution.y, 1.0);
  vec2 metric = vec2(aspect, 1.0);
  float phase = clamp(progress * mix(0.94, 1.08, uMergeSpeed), 0.0, 1.0);
  float field = 0.0;
  for (int i = 0; i < 12; i++) {
    float fi = float(i);
    if (fi >= uDropCount) continue;
    float seed = hash21(vec2(fi * 4.7, fi * 9.2 + 3.1));
    float delay = seed * 0.105;
    float birth = smoother((phase - delay) / max(0.001, 0.64 - delay));
    vec2 center = dropCenter(fi, phase);
    vec2 delta = (uv - center) * metric;
    float radius = birth * (0.060 + seed * 0.060 + phase * (0.082 + uMergeSpeed * 0.052));
    field += radius * radius / (dot(delta, delta) + 0.00042);
  }

  float ocean = smoother((phase - 0.34) / 0.66);
  vec2 oceanCenter = mix(vec2(0.5), uOrigin, 0.18);
  vec2 oceanDelta = (uv - oceanCenter) * metric;
  float maxRadius = max(aspect, 1.0) * 0.84;
  float oceanRadius = mix(0.018, maxRadius, ocean);
  field += ocean * oceanRadius * oceanRadius / (dot(oceanDelta, oceanDelta) + 0.0022);
  return field;
}

void main() {
  vec2 uv = vUv;
  float p = clamp(uProgress, 0.0, 1.0);
  vec3 currentExact = sampleImage(uCurrent, uv, uCurrentSize);
  vec3 nextExact = sampleImage(uNext, uv, uNextSize);
  if (p <= 0.0001) {
    outColor = vec4(currentExact, 1.0);
    return;
  }
  if (p >= 0.9999) {
    outColor = vec4(nextExact, 1.0);
    return;
  }

  float envelope = sin(p * PI);
  float field = liquidPotential(uv, p);
  float radialWave = sin(length((uv - uOrigin) * vec2(uResolution.x / uResolution.y, 1.0)) * 48.0 - uTime * 2.8);
  field += radialWave * uRipple * envelope * 0.018;
  float epsilon = 0.0018;
  float fieldX = liquidPotential(uv + vec2(epsilon, 0.0), p);
  float fieldY = liquidPotential(uv + vec2(0.0, epsilon), p);
  vec2 normal = normalize(vec2(fieldX - field, fieldY - field) + vec2(0.00001));

  float softness = mix(0.19, 0.055, uSurfaceTension);
  float reveal = smoothstep(1.0 - softness, 1.0 + softness, field);
  float rim = 1.0 - smoothstep(0.04, 0.30, abs(field - 1.0));
  float core = 1.0 - smoothstep(0.0, 0.105, abs(field - 1.0));
  vec2 refractedUv = uv - normal * (0.004 + uRefraction * 0.024) * rim * envelope;
  vec2 split = normal * uDispersion * 0.009 * rim * envelope;
  vec3 liquidImage = sampleDispersed(uNext, refractedUv, uNextSize, split);
  vec3 currentImage = sampleImage(uCurrent, uv + normal * rim * 0.002, uCurrentSize);
  vec3 color = mix(currentImage, liquidImage, reveal);

  vec2 lightDirection = normalize(vec2(-0.56, 0.83));
  float facing = max(0.0, dot(normal, lightDirection));
  float highlight = pow(facing, 4.0) * rim + core * 0.28;
  vec3 spectrum = 0.60 + 0.40 * cos(6.28318 * (vec3(0.02, 0.34, 0.68) + field * 0.055));
  color += mix(vec3(0.72, 0.98, 1.0), spectrum, uDispersion * 0.58) * highlight * envelope * 0.42;
  float innerShadow = rim * (1.0 - facing) * reveal;
  color *= 1.0 - innerShadow * 0.12 * envelope;
  float caustic = pow(max(0.0, sin(field * 23.0 + radialWave * 1.4 - uTime * 0.8)), 13.0);
  color += vec3(0.52, 0.96, 1.0) * caustic * rim * uRipple * envelope * 0.12;
  outColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}
`;

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function resolveOrigin(
  origin: LiquidLensOrigin | undefined,
  pointer: TransitionPointer,
): [number, number] {
  if (typeof origin !== 'string' && origin) return [clamp01(origin[0]), clamp01(origin[1])];
  if (origin === 'center') return [0.5, 0.5];
  return [clamp01(pointer.x), clamp01(pointer.y)];
}

class LiquidLensEffect implements TransitionEffect {
  readonly canvas = document.createElement('canvas');
  private gl!: WebGL2RenderingContext;
  private program!: WebGLProgram;
  private vao: WebGLVertexArrayObject | null = null;
  private items: LoadedImage[] = [];
  private textures: WebGLTexture[] = [];
  private fromIndex = 0;
  private toIndex = 0;
  private width = 1;
  private height = 1;
  private locations!: Record<string, WebGLUniformLocation | null>;

  init(context: TransitionEffectContext): void {
    const gl = this.canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
      powerPreference: 'high-performance',
    });
    if (!gl) throw new Error('WebGL2 is required for the liquid-lens transition.');
    this.gl = gl;
    this.items = context.items;
    this.program = createWebGL2Program(gl, fragmentShader);
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    this.locations = {
      current: gl.getUniformLocation(this.program, 'uCurrent'),
      next: gl.getUniformLocation(this.program, 'uNext'),
      resolution: gl.getUniformLocation(this.program, 'uResolution'),
      currentSize: gl.getUniformLocation(this.program, 'uCurrentSize'),
      nextSize: gl.getUniformLocation(this.program, 'uNextSize'),
      origin: gl.getUniformLocation(this.program, 'uOrigin'),
      progress: gl.getUniformLocation(this.program, 'uProgress'),
      time: gl.getUniformLocation(this.program, 'uTime'),
      imageFit: gl.getUniformLocation(this.program, 'uImageFit'),
      dropCount: gl.getUniformLocation(this.program, 'uDropCount'),
      refraction: gl.getUniformLocation(this.program, 'uRefraction'),
      surfaceTension: gl.getUniformLocation(this.program, 'uSurfaceTension'),
      ripple: gl.getUniformLocation(this.program, 'uRipple'),
      dispersion: gl.getUniformLocation(this.program, 'uDispersion'),
      mergeSpeed: gl.getUniformLocation(this.program, 'uMergeSpeed'),
    };
    this.textures = this.items.map((item) => createWebGL2Texture(gl, item));
    context.host.appendChild(this.canvas);
    this.resize(context.width, context.height, context.dpr);
  }

  prepare(fromIndex: number, toIndex: number, _direction: Direction): void {
    this.fromIndex = fromIndex;
    this.toIndex = toIndex;
  }

  resize(width: number, height: number, dpr: number): void {
    this.width = Math.max(1, Math.round(width * dpr));
    this.height = Math.max(1, Math.round(height * dpr));
    if (this.canvas.width !== this.width || this.canvas.height !== this.height) {
      this.canvas.width = this.width;
      this.canvas.height = this.height;
    }
  }

  render(frame: TransitionFrame): void {
    const options = frame.options as LiquidLensOptions;
    const current = this.items[this.fromIndex];
    const next = this.items[this.toIndex];
    const origin = resolveOrigin(options.origin, frame.pointer);
    const gl = this.gl;
    gl.viewport(0, 0, this.width, this.height);
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    bindWebGL2Texture(gl, this.textures[this.fromIndex], 0, this.locations.current);
    bindWebGL2Texture(gl, this.textures[this.toIndex], 1, this.locations.next);
    gl.uniform2f(this.locations.resolution, this.width, this.height);
    gl.uniform2f(this.locations.currentSize, current.width, current.height);
    gl.uniform2f(this.locations.nextSize, next.width, next.height);
    gl.uniform2f(this.locations.origin, origin[0], origin[1]);
    gl.uniform1f(this.locations.progress, frame.progress);
    gl.uniform1f(this.locations.time, frame.time);
    gl.uniform1f(this.locations.imageFit, options.imageFit === 'contain' ? 1 : 0);
    gl.uniform1f(this.locations.dropCount, Math.min(12, Math.max(3, options.dropCount ?? 9)));
    gl.uniform1f(this.locations.refraction, Math.max(0, options.refraction ?? 0.58));
    gl.uniform1f(this.locations.surfaceTension, clamp01(options.surfaceTension ?? 0.62));
    gl.uniform1f(this.locations.ripple, Math.max(0, options.ripple ?? 0.36));
    gl.uniform1f(this.locations.dispersion, Math.max(0, options.dispersion ?? 0.28));
    gl.uniform1f(this.locations.mergeSpeed, clamp01(options.mergeSpeed ?? 0.54));
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  destroy(): void {
    this.textures.forEach((texture) => this.gl.deleteTexture(texture));
    if (this.vao) this.gl.deleteVertexArray(this.vao);
    if (this.program) this.gl.deleteProgram(this.program);
    this.canvas.remove();
  }
}

export const liquidLensTransition = defineTransition({
  name: 'liquid-lens',
  backend: 'webgl2',
  defaults: {
    dropCount: 9,
    refraction: 0.58,
    surfaceTension: 0.62,
    ripple: 0.36,
    dispersion: 0.28,
    mergeSpeed: 0.54,
    origin: 'pointer',
    imageFit: 'cover',
  },
  phaseEasing: 'none',
  supported: () => typeof WebGL2RenderingContext !== 'undefined',
  create: () => new LiquidLensEffect(),
});
