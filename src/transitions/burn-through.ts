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

export type BurnOrigin = 'center' | 'pointer' | readonly [number, number];

export interface BurnThroughOptions {
  /** Burn origin, either a preset or normalized `[x, y]` coordinates. */
  origin?: BurnOrigin;
  /** Width of the scorched transition edge. */
  burnWidth?: number;
  /** Strength and reach of the carbonized edge. */
  charDepth?: number;
  /** Irregularity of the advancing burn front. */
  roughness?: number;
  /** Amount of procedural smoke above the burn front. */
  smoke?: number;
  /** Main glow colour used by embers and sparks. */
  emberColor?: string;
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
uniform float uBurnWidth;
uniform float uCharDepth;
uniform float uRoughness;
uniform float uSmoke;
uniform vec3 uEmberColor;

const vec3 BACKDROP = vec3(0.009, 0.010, 0.011);

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x),
    mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0)), f.x), f.y);
}

float fbm(vec2 p) {
  float value = 0.0;
  float amplitude = 0.5;
  mat2 turn = mat2(1.61, 1.18, -1.18, 1.61);
  for (int i = 0; i < 5; i++) {
    value += noise(p) * amplitude;
    p = turn * p + vec2(4.7);
    amplitude *= 0.5;
  }
  return value;
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

void main() {
  vec2 uv = vUv;
  float p = clamp(uProgress, 0.0, 1.0);
  vec3 oldImage = sampleImage(uCurrent, uv, uCurrentSize);
  vec3 newImage = sampleImage(uNext, uv, uNextSize);
  if (p <= 0.0001) {
    outColor = vec4(oldImage, 1.0);
    return;
  }
  if (p >= 0.9999) {
    outColor = vec4(newImage, 1.0);
    return;
  }

  float aspect = uResolution.x / max(uResolution.y, 1.0);
  vec2 metric = vec2(aspect, 1.0);
  vec2 position = uv * metric;
  vec2 origin = uOrigin * metric;
  float distanceToOrigin = length(position - origin);
  vec2 cornerA = vec2(0.0, 0.0);
  vec2 cornerB = vec2(aspect, 0.0);
  vec2 cornerC = vec2(0.0, 1.0);
  vec2 cornerD = vec2(aspect, 1.0);
  float maxDistance = max(max(length(origin - cornerA), length(origin - cornerB)),
    max(length(origin - cornerC), length(origin - cornerD)));

  float broadNoise = fbm(uv * vec2(4.5, 5.8) + vec2(2.2, 7.4));
  float detailNoise = fbm(uv * vec2(15.0, 19.0) + vec2(9.1, 1.7));
  float fibers = noise(uv * vec2(68.0, 83.0));
  float rough = (broadNoise - 0.5) * 0.20 + (detailNoise - 0.5) * 0.065 + (fibers - 0.5) * 0.018;
  float radius = mix(-0.10, maxDistance + 0.16, smoother(p));
  float front = distanceToOrigin + rough * uRoughness - radius;
  float edge = 0.007 + uBurnWidth * 0.013;
  float reveal = 1.0 - smoothstep(-edge, edge, front);
  vec3 color = mix(oldImage, newImage, reveal);

  float charBand = 1.0 - smoothstep(edge * 1.2, edge * (4.8 + uCharDepth * 3.0), abs(front));
  float emberBand = 1.0 - smoothstep(edge * 0.25, edge * 1.5, abs(front));
  float hotCore = 1.0 - smoothstep(0.0, edge * 0.52, abs(front + edge * 0.12));
  float irregular = mix(0.62, 1.18, detailNoise);
  color *= 1.0 - charBand * uCharDepth * irregular * 0.78;
  color += uEmberColor * emberBand * irregular * (0.72 + uCharDepth * 0.46);
  color += vec3(1.0, 0.78, 0.38) * hotCore * 0.82;

  vec2 smokeUv = uv * vec2(3.1, 4.4) + vec2(uTime * 0.025, -uTime * 0.10);
  float smokeNoise = fbm(smokeUv + broadNoise * 1.6);
  float smokeZone = step(0.0, front) * (1.0 - smoothstep(edge * 2.0, edge * 12.0, front));
  float smokeAlpha = smoothstep(0.46, 0.82, smokeNoise) * smokeZone * uSmoke;
  color = mix(color, vec3(0.18, 0.16, 0.15), smokeAlpha * 0.42);

  vec2 sparkCell = floor((uv + vec2(0.0, uTime * 0.055)) * vec2(110.0, 82.0));
  float sparkSeed = hash21(sparkCell);
  float spark = step(0.987, sparkSeed) * emberBand * smoothstep(0.25, 0.9, fibers);
  color += mix(uEmberColor, vec3(1.0, 0.88, 0.55), 0.55) * spark * 1.35;

  outColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}
`;

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function resolveOrigin(
  origin: BurnOrigin | undefined,
  pointer: TransitionPointer,
): [number, number] {
  if (typeof origin !== 'string' && origin) {
    return [clamp01(origin[0]), clamp01(origin[1])];
  }
  if (origin === 'center') return [0.5, 0.5];
  return [clamp01(pointer.x), clamp01(pointer.y)];
}

function parseHexColor(value: string): [number, number, number] {
  let normalized = value.trim().replace('#', '');
  if (normalized.length === 3) {
    normalized = normalized.split('').map((character) => character + character).join('');
  }
  if (!/^[0-9a-f]{6}$/i.test(normalized)) return [219 / 255, 118 / 255, 78 / 255];
  const numeric = Number.parseInt(normalized, 16);
  return [
    ((numeric >> 16) & 255) / 255,
    ((numeric >> 8) & 255) / 255,
    (numeric & 255) / 255,
  ];
}

class BurnThroughEffect implements TransitionEffect {
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
    if (!gl) throw new Error('WebGL2 is required for the burn-through transition.');
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
      burnWidth: gl.getUniformLocation(this.program, 'uBurnWidth'),
      charDepth: gl.getUniformLocation(this.program, 'uCharDepth'),
      roughness: gl.getUniformLocation(this.program, 'uRoughness'),
      smoke: gl.getUniformLocation(this.program, 'uSmoke'),
      emberColor: gl.getUniformLocation(this.program, 'uEmberColor'),
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
    const options = frame.options as BurnThroughOptions;
    const current = this.items[this.fromIndex];
    const next = this.items[this.toIndex];
    const origin = resolveOrigin(options.origin, frame.pointer);
    const emberColor = parseHexColor(options.emberColor ?? '#db764e');
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
    gl.uniform1f(this.locations.burnWidth, Math.max(0, options.burnWidth ?? 0.42));
    gl.uniform1f(this.locations.charDepth, Math.max(0, options.charDepth ?? 0.68));
    gl.uniform1f(this.locations.roughness, Math.max(0, options.roughness ?? 0.58));
    gl.uniform1f(this.locations.smoke, Math.max(0, options.smoke ?? 0.35));
    gl.uniform3f(this.locations.emberColor, emberColor[0], emberColor[1], emberColor[2]);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  destroy(): void {
    this.textures.forEach((texture) => this.gl.deleteTexture(texture));
    if (this.vao) this.gl.deleteVertexArray(this.vao);
    if (this.program) this.gl.deleteProgram(this.program);
    this.canvas.remove();
  }
}

export const burnThroughTransition = defineTransition({
  name: 'burn-through',
  backend: 'webgl2',
  defaults: {
    origin: 'pointer',
    burnWidth: 0.42,
    charDepth: 0.68,
    roughness: 0.58,
    smoke: 0.35,
    emberColor: '#db764e',
    imageFit: 'cover',
  },
  phaseEasing: 'power1.inOut',
  supported: () => typeof WebGL2RenderingContext !== 'undefined',
  create: () => new BurnThroughEffect(),
});
