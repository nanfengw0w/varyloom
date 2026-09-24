import { defineTransition } from '../registry';
import type {
  Direction,
  LoadedImage,
  VaryloomImageFit,
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

export type PrismaticGlassDirection = AxisDirection;

export interface PrismaticGlassOptions {
  /** Direction in which the refractive front travels. `auto` follows slider navigation. */
  direction?: PrismaticGlassDirection;
  /** Strength of optical displacement inside the glass band. */
  refraction?: number;
  /** RGB spectral separation around the refractive edge. */
  dispersion?: number;
  /** Amount of procedural curvature applied to the moving front. */
  curvature?: number;
  /** Intensity of rim light and caustic highlights. */
  edgeGlow?: number;
  /** How each image is fitted inside the transition viewport. */
  imageFit?: VaryloomImageFit;
}

const fragmentShader = `#version 300 es
precision highp float;

uniform sampler2D uCurrent;
uniform sampler2D uNext;
uniform vec2 uResolution;
uniform vec2 uCurrentSize;
uniform vec2 uNextSize;
uniform vec2 uAxis;
uniform vec2 uPointer;
uniform float uProgress;
uniform float uTime;
uniform float uRefraction;
uniform float uDispersion;
uniform float uCurvature;
uniform float uEdgeGlow;
uniform float uImageFit;

in vec2 vUv;
out vec4 outColor;

const float PI = 3.14159265359;
const vec3 BACKDROP = vec3(0.008, 0.013, 0.015);

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float valueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float fbm(vec2 p) {
  float value = 0.0;
  float amplitude = 0.5;
  mat2 turn = mat2(1.62, 1.18, -1.18, 1.62);
  for (int i = 0; i < 4; i++) {
    value += valueNoise(p) * amplitude;
    p = turn * p + vec2(3.7, 8.2);
    amplitude *= 0.5;
  }
  return value;
}

vec2 fitUV(vec2 uv, vec2 imageSize) {
  float viewAspect = uResolution.x / max(uResolution.y, 1.0);
  float imageAspect = imageSize.x / max(imageSize.y, 1.0);
  vec2 scale = vec2(1.0);
  float ratio = viewAspect / max(imageAspect, 0.0001);
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

vec3 sampleImage(sampler2D image, vec2 uv, vec2 imageSize) {
  vec2 imageUv = fitUV(uv, imageSize);
  vec3 sampled = texture(image, clamp(imageUv, 0.0, 1.0)).rgb;
  return mix(BACKDROP, sampled, imageMask(imageUv));
}

vec3 sampleDispersed(sampler2D image, vec2 uv, vec2 imageSize, vec2 split) {
  vec2 imageUv = fitUV(uv, imageSize);
  float coverage = imageMask(imageUv);
  vec3 sampled = vec3(
    texture(image, clamp(imageUv + split, 0.0, 1.0)).r,
    texture(image, clamp(imageUv, 0.0, 1.0)).g,
    texture(image, clamp(imageUv - split, 0.0, 1.0)).b
  );
  return mix(BACKDROP, sampled, coverage);
}

void main() {
  vec2 uv = vUv;
  vec2 axis = normalize(uAxis + vec2(0.00001));
  vec2 tangent = vec2(-axis.y, axis.x);
  vec2 centered = uv - 0.5;
  float along = dot(centered, axis) + 0.5;
  float across = dot(centered, tangent) + 0.5;
  float progress = clamp(uProgress, 0.0, 1.0);
  float envelope = sin(progress * PI);

  float broadNoise = fbm(vec2(across * 2.45, uTime * 0.07 + 4.3));
  float fineNoise = fbm(vec2(across * 7.8 - uTime * 0.035, uTime * 0.11 + 11.7));
  float wave = sin(across * 7.6 + uTime * 0.52) * 0.072
    + sin(across * 18.5 - uTime * 0.31) * 0.029
    + (broadNoise - 0.5) * 0.12
    + (fineNoise - 0.5) * 0.035;
  wave *= uCurvature;

  float front = mix(-0.29, 1.29, progress);
  float field = along - front - wave;
  float reveal = 1.0 - smoothstep(-0.035, 0.035, field);
  float glassBand = 1.0 - smoothstep(0.018, 0.17, abs(field));
  float glassCore = 1.0 - smoothstep(0.0, 0.062, abs(field));

  float slope = cos(across * 7.6 + uTime * 0.52) * 0.55
    + cos(across * 18.5 - uTime * 0.31) * 0.24
    + (fineNoise - broadNoise) * 0.85;
  vec2 opticalNormal = normalize(axis - tangent * slope * uCurvature);
  vec2 pointerBias = (uPointer - 0.5) * 0.012;
  vec2 refraction = (opticalNormal * (0.012 + uRefraction * 0.045) + pointerBias)
    * glassBand * envelope;

  vec3 currentBase = sampleImage(uCurrent, uv, uCurrentSize);
  vec3 nextBase = sampleImage(uNext, uv, uNextSize);
  vec3 color = mix(currentBase, nextBase, reveal);

  vec2 spectralAxis = normalize(opticalNormal + tangent * 0.22);
  vec2 split = spectralAxis * (0.001 + uDispersion * 0.013) * glassBand * envelope;
  vec2 glassUv = uv + refraction;
  vec3 currentGlass = sampleDispersed(uCurrent, glassUv, uCurrentSize, split);
  vec3 nextGlass = sampleDispersed(uNext, glassUv, uNextSize, split);
  float glassReveal = 1.0 - smoothstep(-0.12, 0.10, field);
  vec3 glassColor = mix(currentGlass, nextGlass, glassReveal);

  vec2 currentUv = fitUV(uv, uCurrentSize);
  vec2 nextUv = fitUV(uv, uNextSize);
  float contentCoverage = max(imageMask(currentUv), imageMask(nextUv));
  float lensAmount = glassBand * envelope * contentCoverage;
  color = mix(color, glassColor, lensAmount * (0.62 + glassCore * 0.25));

  float causticLines = pow(max(0.0, sin(across * 49.0 + broadNoise * 9.0 - uTime * 1.35)), 15.0);
  float innerHighlight = 1.0 - smoothstep(0.008, 0.036, abs(field + 0.025));
  float outerHighlight = 1.0 - smoothstep(0.012, 0.075, abs(field - 0.085));
  vec3 spectrum = 0.56 + 0.44 * cos(6.28318 * (vec3(0.02, 0.35, 0.69) + across * 0.34 + uTime * 0.025));
  vec3 edgeLight = mix(vec3(0.72, 1.0, 0.96), spectrum, uDispersion * 0.58);
  color += edgeLight * innerHighlight * envelope * contentCoverage * uEdgeGlow * 0.52;
  color += spectrum * outerHighlight * envelope * contentCoverage * uEdgeGlow * 0.18;
  color += vec3(0.54, 0.92, 1.0) * causticLines * glassBand * envelope * contentCoverage * uEdgeGlow * 0.13;

  float lensShadow = smoothstep(0.055, 0.15, abs(field)) * glassBand;
  color *= 1.0 - lensShadow * envelope * 0.08;
  float vignette = smoothstep(0.92, 0.28, dot(centered, centered));
  color *= mix(0.88, 1.0, vignette);
  outColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}
`;

class PrismaticGlassEffect implements TransitionEffect {
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
    if (!gl) throw new Error('WebGL2 is required for the prismatic-glass transition.');
    this.gl = gl;
    this.items = context.items;
    this.program = createWebGL2Program(gl, fragmentShader);
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    this.locations = Object.fromEntries([
      'current', 'next', 'resolution', 'currentSize', 'nextSize', 'axis', 'pointer',
      'progress', 'time', 'refraction', 'dispersion', 'curvature', 'edgeGlow', 'imageFit',
    ].map((name) => [name, gl.getUniformLocation(this.program, `u${name[0].toUpperCase()}${name.slice(1)}`)]));
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
    const options = frame.options as PrismaticGlassOptions;
    const current = this.items[this.fromIndex];
    const next = this.items[this.toIndex];
    const axis = resolveAxis(options.direction, frame.direction);
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
    gl.uniform2f(this.locations.pointer, frame.pointer.x, frame.pointer.y);
    gl.uniform1f(this.locations.progress, frame.progress);
    gl.uniform1f(this.locations.time, frame.time);
    gl.uniform1f(this.locations.refraction, options.refraction ?? 0.48);
    gl.uniform1f(this.locations.dispersion, options.dispersion ?? 0.32);
    gl.uniform1f(this.locations.curvature, options.curvature ?? 0.58);
    gl.uniform1f(this.locations.edgeGlow, options.edgeGlow ?? 0.46);
    gl.uniform1f(this.locations.imageFit, options.imageFit === 'contain' ? 1 : 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  destroy(): void {
    this.textures.forEach((texture) => this.gl.deleteTexture(texture));
    if (this.vao) this.gl.deleteVertexArray(this.vao);
    if (this.program) this.gl.deleteProgram(this.program);
    this.canvas.remove();
  }
}

export const prismaticGlassTransition = defineTransition({
  name: 'prismatic-glass',
  backend: 'webgl2',
  defaults: {
    direction: 'auto',
    refraction: 0.48,
    dispersion: 0.32,
    curvature: 0.58,
    edgeGlow: 0.46,
    imageFit: 'cover',
  },
  phaseEasing: 'power3.inOut',
  supported: () => typeof WebGL2RenderingContext !== 'undefined',
  create: () => new PrismaticGlassEffect(),
});
