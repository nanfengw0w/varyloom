import { defineTransition } from '../registry';
import type {
  Direction,
  LoadedImage,
  PrismorphImageFit,
  TransitionEffect,
  TransitionEffectContext,
  TransitionFrame,
} from '../types';
import {
  bindWebGL2Texture,
  createWebGL2Program,
  createWebGL2Texture,
  resolveAxis,
  type AxisDirection,
} from './webgl2-utils';

export type TornPaperDirection = AxisDirection;

export interface TornPaperOptions {
  /** Stable seed controlling the main tear and its smaller fibers. */
  tearSeed?: number;
  /** Direction in which the tear front travels. `auto` follows slider navigation. */
  direction?: TornPaperDirection;
  /** Number of visible paper-core layers around the tear. */
  layers?: number;
  /** Width and maximum reach of the procedural paper fibers. */
  fiberWidth?: number;
  /** Strength of the shadow cast onto the image below. */
  shadowStrength?: number;
  /** Amount of UV displacement and shading on the lifted paper lips. */
  curl?: number;
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
uniform vec2 uAxis;
uniform float uProgress;
uniform float uImageFit;
uniform float uLayers;
uniform float uFiberWidth;
uniform float uShadowStrength;
uniform float uCurl;
uniform float uSeed;

const vec3 BACKDROP = vec3(0.012, 0.011, 0.009);

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
  mat2 turn = mat2(1.67, 1.21, -1.21, 1.67);
  for (int i = 0; i < 5; i++) {
    value += noise(p) * amplitude;
    p = turn * p + vec2(7.4, 2.8);
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
  vec2 axis = normalize(uAxis + vec2(0.00001));
  vec2 tangent = vec2(-axis.y, axis.x);
  vec2 centered = uv - 0.5;
  float along = dot(centered, axis) + 0.5;
  float across = dot(centered, tangent);

  float pathLow = fbm(vec2(along * 2.9 + uSeed, uSeed * 0.31));
  float pathMid = fbm(vec2(along * 9.4 - uSeed * 0.4, 7.3 + uSeed));
  float pathFine = noise(vec2(along * 54.0 + uSeed * 2.1, 18.7));
  float seam = (pathLow - 0.5) * 0.19 + (pathMid - 0.5) * 0.075;
  float front = mix(-0.13, 1.16, p);
  float passed = 1.0 - smoothstep(front - 0.055, front + 0.045, along);
  float age = smoother(clamp((front - along) / 0.68, 0.0, 1.0));
  float finish = smoother((p - 0.68) / 0.32);
  float opening = passed * (0.010 + age * (0.16 + p * 0.31)) + finish * 0.73;
  float edgeRoughness = (pathFine - 0.5) * (0.011 + uFiberWidth * 0.014)
    + (pathMid - 0.5) * 0.022;
  float edgePosition = max(0.002, opening + edgeRoughness * passed);
  float signedDistance = abs(across - seam) - edgePosition;
  float reveal = passed * (1.0 - smoothstep(-0.005, 0.005, signedDistance));

  float edgeProximity = (1.0 - smoothstep(0.0, 0.18, max(signedDistance, 0.0))) * passed;
  float side = sign(across - seam + 0.00001);
  vec2 curledUv = uv + tangent * side * edgeProximity * uCurl * 0.032;
  vec3 currentPaper = sampleImage(uCurrent, curledUv, uCurrentSize);
  vec3 color = mix(currentPaper, nextExact, reveal);

  float fiberBase = 0.0028 + uFiberWidth * 0.0105;
  float edgeLife = 1.0 - smoother((p - 0.84) / 0.16);
  float innerShadow = step(signedDistance, 0.0)
    * (1.0 - smoothstep(0.0, 0.085, -signedDistance)) * passed * edgeLife;
  color *= 1.0 - innerShadow * uShadowStrength * 0.48;
  float curlShade = step(0.0, signedDistance) * edgeProximity * edgeLife;
  color *= 1.0 - curlShade * uShadowStrength * 0.19;
  color += vec3(0.93, 0.88, 0.77) * curlShade * uCurl * 0.10;

  float coreFiber = (1.0 - smoothstep(0.0, fiberBase, abs(signedDistance))) * passed;
  float fiberCell = floor(along * (330.0 + uFiberWidth * 430.0));
  float fiberSeed = hash21(vec2(fiberCell + uSeed * 13.0, side * 7.0 + 4.0));
  float fiberReach = fiberBase * (1.4 + fiberSeed * 6.8);
  float strayFiber = step(0.48, fiberSeed)
    * (1.0 - smoothstep(fiberBase * 0.65, fiberReach, abs(signedDistance))) * passed;
  float threadBreak = 0.58 + 0.42 * noise(vec2(along * 870.0, uSeed + side));
  float fibers = max(coreFiber, strayFiber * threadBreak) * edgeLife;

  float secondLayer = step(1.5, uLayers)
    * (1.0 - smoothstep(fiberBase * 1.2, fiberBase * 4.8, abs(signedDistance)))
    * (1.0 - coreFiber) * passed * edgeLife;
  float thirdLayer = step(2.5, uLayers)
    * (1.0 - smoothstep(fiberBase * 3.6, fiberBase * 8.2, abs(signedDistance)))
    * (1.0 - secondLayer) * passed * edgeLife;
  color = mix(color, vec3(0.48, 0.34, 0.22), thirdLayer * 0.66);
  color = mix(color, vec3(0.78, 0.67, 0.49), secondLayer * 0.74);
  vec3 paperCore = vec3(0.97, 0.94, 0.84) * (0.86 + pathFine * 0.14);
  color = mix(color, paperCore, clamp(fibers, 0.0, 1.0));
  float hotFiber = coreFiber * pow(max(0.0, dot(normalize(vec2(side, 0.55)), vec2(0.35, 0.94))), 2.0);
  color += vec3(1.0, 0.96, 0.86) * hotFiber * edgeLife * 0.12;
  outColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}
`;

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

class TornPaperEffect implements TransitionEffect {
  readonly canvas = document.createElement('canvas');
  private gl!: WebGL2RenderingContext;
  private program!: WebGLProgram;
  private vao: WebGLVertexArrayObject | null = null;
  private items: LoadedImage[] = [];
  private textures: WebGLTexture[] = [];
  private fromIndex = 0;
  private toIndex = 0;
  private navigationDirection: Direction = 1;
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
    if (!gl) throw new Error('WebGL2 is required for the torn-paper transition.');
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
      axis: gl.getUniformLocation(this.program, 'uAxis'),
      progress: gl.getUniformLocation(this.program, 'uProgress'),
      imageFit: gl.getUniformLocation(this.program, 'uImageFit'),
      layers: gl.getUniformLocation(this.program, 'uLayers'),
      fiberWidth: gl.getUniformLocation(this.program, 'uFiberWidth'),
      shadowStrength: gl.getUniformLocation(this.program, 'uShadowStrength'),
      curl: gl.getUniformLocation(this.program, 'uCurl'),
      seed: gl.getUniformLocation(this.program, 'uSeed'),
    };
    this.textures = this.items.map((item) => createWebGL2Texture(gl, item));
    context.host.appendChild(this.canvas);
    this.resize(context.width, context.height, context.dpr);
  }

  prepare(fromIndex: number, toIndex: number, direction: Direction): void {
    this.fromIndex = fromIndex;
    this.toIndex = toIndex;
    this.navigationDirection = direction;
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
    const options = frame.options as TornPaperOptions;
    const current = this.items[this.fromIndex];
    const next = this.items[this.toIndex];
    const axis = resolveAxis(options.direction, this.navigationDirection);
    const seed = (options.tearSeed ?? 1.4) + this.fromIndex * 3.73 + this.toIndex * 7.91;
    const gl = this.gl;
    gl.viewport(0, 0, this.width, this.height);
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    bindWebGL2Texture(gl, this.textures[this.fromIndex], 0, this.locations.current);
    bindWebGL2Texture(gl, this.textures[this.toIndex], 1, this.locations.next);
    gl.uniform2f(this.locations.resolution, this.width, this.height);
    gl.uniform2f(this.locations.currentSize, current.width, current.height);
    gl.uniform2f(this.locations.nextSize, next.width, next.height);
    gl.uniform2f(this.locations.axis, axis[0], axis[1]);
    gl.uniform1f(this.locations.progress, frame.progress);
    gl.uniform1f(this.locations.imageFit, options.imageFit === 'contain' ? 1 : 0);
    gl.uniform1f(this.locations.layers, Math.min(3, Math.max(1, options.layers ?? 2)));
    gl.uniform1f(this.locations.fiberWidth, clamp01(options.fiberWidth ?? 0.52));
    gl.uniform1f(this.locations.shadowStrength, Math.max(0, options.shadowStrength ?? 0.64));
    gl.uniform1f(this.locations.curl, Math.max(0, options.curl ?? 0.46));
    gl.uniform1f(this.locations.seed, seed);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  destroy(): void {
    this.textures.forEach((texture) => this.gl.deleteTexture(texture));
    if (this.vao) this.gl.deleteVertexArray(this.vao);
    if (this.program) this.gl.deleteProgram(this.program);
    this.canvas.remove();
  }
}

export const tornPaperTransition = defineTransition({
  name: 'torn-paper',
  backend: 'webgl2',
  defaults: {
    tearSeed: 1.4,
    direction: 'auto',
    layers: 2,
    fiberWidth: 0.52,
    shadowStrength: 0.64,
    curl: 0.46,
    imageFit: 'cover',
  },
  phaseEasing: 'none',
  supported: () => typeof WebGL2RenderingContext !== 'undefined',
  create: () => new TornPaperEffect(),
});
