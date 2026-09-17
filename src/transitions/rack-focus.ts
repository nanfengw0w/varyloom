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

export type RackFocusPoint = 'pointer' | 'center' | readonly [number, number];

export interface RackFocusOptions {
  /** Maximum defocus radius reached around the image handoff. */
  blur?: number;
  /** Amount of saturation removed at peak defocus. */
  desaturation?: number;
  /** Strength of the subtle exposure pulse around the handoff. */
  exposureBreath?: number;
  /** Temporary film grain applied while the images are defocused. */
  grain?: number;
  /** Focus recovery point, a preset or normalized `[x, y]` coordinates. */
  focusPoint?: RackFocusPoint;
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
uniform vec2 uFocusPoint;
uniform float uProgress;
uniform float uTime;
uniform float uImageFit;
uniform float uBlur;
uniform float uDesaturation;
uniform float uExposureBreath;
uniform float uGrain;

const float PI = 3.14159265359;
const vec3 BACKDROP = vec3(0.010, 0.012, 0.011);

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

vec3 sampleBlurred(sampler2D tex, vec2 screenUv, vec2 imageSize, float radius) {
  float aspect = uResolution.x / max(uResolution.y, 1.0);
  vec3 color = sampleImage(tex, screenUv, imageSize) * 0.16;
  float weight = 0.16;
  for (int i = 0; i < 12; i++) {
    float fi = float(i);
    float angle = fi * 2.39996323 + uTime * 0.025;
    float ring = sqrt((fi + 0.65) / 12.65);
    vec2 offset = vec2(cos(angle) / aspect, sin(angle)) * ring * radius;
    float tapWeight = 0.07;
    color += sampleImage(tex, screenUv + offset, imageSize) * tapWeight;
    weight += tapWeight;
  }
  return color / weight;
}

void main() {
  vec2 uv = vUv;
  float rawProgress = clamp(uProgress, 0.0, 1.0);
  vec3 currentExact = sampleImage(uCurrent, uv, uCurrentSize);
  vec3 nextExact = sampleImage(uNext, uv, uNextSize);
  if (rawProgress <= 0.0001) {
    outColor = vec4(currentExact, 1.0);
    return;
  }
  if (rawProgress >= 0.9999) {
    outColor = vec4(nextExact, 1.0);
    return;
  }

  float p = smoother(rawProgress);
  float envelope = sin(p * PI);
  float aspect = uResolution.x / max(uResolution.y, 1.0);
  float focusDistance = length((uv - uFocusPoint) * vec2(aspect, 1.0));
  float focusLead = (1.0 - smoothstep(0.04, 0.72, focusDistance)) * 0.17;
  float currentBlurPhase = smoother(p / 0.60 - focusLead * 0.18);
  float nextClearPhase = smoother((p - 0.34) / 0.66 + focusLead);
  float currentRadius = uBlur * 0.023 * currentBlurPhase;
  float nextRadius = uBlur * 0.023 * (1.0 - nextClearPhase);

  vec2 currentUv = (uv - 0.5) * (1.0 - currentBlurPhase * 0.032) + 0.5;
  vec2 nextUv = (uv - 0.5) * (1.0 - (1.0 - nextClearPhase) * 0.032) + 0.5;
  vec3 currentColor = sampleBlurred(uCurrent, currentUv, uCurrentSize, currentRadius);
  vec3 nextColor = sampleBlurred(uNext, nextUv, uNextSize, nextRadius);
  float handoff = smoother((p - 0.37) / 0.26);
  vec3 color = mix(currentColor, nextColor, handoff);

  float luminance = dot(color, vec3(0.2126, 0.7152, 0.0722));
  color = mix(color, vec3(luminance), uDesaturation * envelope);
  float exposure = 1.0 + envelope * uExposureBreath * 0.13 - pow(envelope, 3.0) * 0.035;
  color *= exposure;
  float grain = hash21(gl_FragCoord.xy + floor(uTime * 29.0) * vec2(17.0, 43.0)) - 0.5;
  color += grain * uGrain * envelope * 0.13;
  float focusHalo = exp(-focusDistance * 4.6) * nextClearPhase * handoff * (1.0 - p) * 0.025;
  color += vec3(0.91, 1.0, 0.90) * focusHalo;
  outColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}
`;

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function resolveFocusPoint(
  point: RackFocusPoint | undefined,
  pointer: TransitionPointer,
): [number, number] {
  if (typeof point !== 'string' && point) return [clamp01(point[0]), clamp01(point[1])];
  if (point === 'center') return [0.5, 0.5];
  return [clamp01(pointer.x), clamp01(pointer.y)];
}

class RackFocusEffect implements TransitionEffect {
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
    if (!gl) throw new Error('WebGL2 is required for the rack-focus transition.');
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
      focusPoint: gl.getUniformLocation(this.program, 'uFocusPoint'),
      progress: gl.getUniformLocation(this.program, 'uProgress'),
      time: gl.getUniformLocation(this.program, 'uTime'),
      imageFit: gl.getUniformLocation(this.program, 'uImageFit'),
      blur: gl.getUniformLocation(this.program, 'uBlur'),
      desaturation: gl.getUniformLocation(this.program, 'uDesaturation'),
      exposureBreath: gl.getUniformLocation(this.program, 'uExposureBreath'),
      grain: gl.getUniformLocation(this.program, 'uGrain'),
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
    const options = frame.options as RackFocusOptions;
    const current = this.items[this.fromIndex];
    const next = this.items[this.toIndex];
    const focusPoint = resolveFocusPoint(options.focusPoint, frame.pointer);
    const gl = this.gl;
    gl.viewport(0, 0, this.width, this.height);
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    bindWebGL2Texture(gl, this.textures[this.fromIndex], 0, this.locations.current);
    bindWebGL2Texture(gl, this.textures[this.toIndex], 1, this.locations.next);
    gl.uniform2f(this.locations.resolution, this.width, this.height);
    gl.uniform2f(this.locations.currentSize, current.width, current.height);
    gl.uniform2f(this.locations.nextSize, next.width, next.height);
    gl.uniform2f(this.locations.focusPoint, focusPoint[0], focusPoint[1]);
    gl.uniform1f(this.locations.progress, frame.progress);
    gl.uniform1f(this.locations.time, frame.time);
    gl.uniform1f(this.locations.imageFit, options.imageFit === 'contain' ? 1 : 0);
    gl.uniform1f(this.locations.blur, Math.max(0, options.blur ?? 0.68));
    gl.uniform1f(this.locations.desaturation, clamp01(options.desaturation ?? 0.42));
    gl.uniform1f(this.locations.exposureBreath, Math.max(0, options.exposureBreath ?? 0.34));
    gl.uniform1f(this.locations.grain, Math.max(0, options.grain ?? 0.18));
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  destroy(): void {
    this.textures.forEach((texture) => this.gl.deleteTexture(texture));
    if (this.vao) this.gl.deleteVertexArray(this.vao);
    if (this.program) this.gl.deleteProgram(this.program);
    this.canvas.remove();
  }
}

export const rackFocusTransition = defineTransition({
  name: 'rack-focus',
  backend: 'webgl2',
  defaults: {
    blur: 0.68,
    desaturation: 0.42,
    exposureBreath: 0.34,
    grain: 0.18,
    focusPoint: 'pointer',
    imageFit: 'cover',
  },
  phaseEasing: 'none',
  supported: () => typeof WebGL2RenderingContext !== 'undefined',
  create: () => new RackFocusEffect(),
});
