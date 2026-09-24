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
} from './webgl2-utils';

export interface MisregistrationOptions {
  /** Distance travelled by the independent RGB plates. */
  plateSpread?: number;
  /** Procedural halftone grid density. */
  halftoneScale?: number;
  /** Paper colour shown through the temporary halftone pattern. */
  paperTint?: string;
  /** Strength of the final print-registration scale punch. */
  punch?: number;
  /** How each image is fitted inside the transition viewport. */
  imageFit?: VaryloomImageFit;
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
uniform float uProgress;
uniform float uTime;
uniform float uImageFit;
uniform float uPlateSpread;
uniform float uHalftoneScale;
uniform float uPunch;
uniform vec3 uPaperTint;

const vec3 BACKDROP = vec3(0.012, 0.014, 0.015);

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

float rectMask(vec2 uv) {
  vec2 inside = step(vec2(0.0), uv) * step(uv, vec2(1.0));
  return inside.x * inside.y;
}

float imageMask(vec2 uv) {
  return uImageFit > 0.5 ? rectMask(uv) : 1.0;
}

vec4 sampleImage(sampler2D tex, vec2 screenUv, vec2 imageSize) {
  vec2 uv = fitUV(screenUv, imageSize);
  vec3 sampled = texture(tex, clamp(uv, 0.0, 1.0)).rgb;
  float mask = imageMask(uv) * rectMask(screenUv);
  return vec4(mix(BACKDROP, sampled, imageMask(uv)), mask);
}

float halftone(vec2 uv, float angle) {
  mat2 rotation = mat2(cos(angle), -sin(angle), sin(angle), cos(angle));
  vec2 cell = fract(rotation * (uv - 0.5) * uHalftoneScale) - 0.5;
  return 1.0 - smoothstep(0.20, 0.42, length(cell));
}

void main() {
  vec2 uv = vUv;
  float p = clamp(uProgress, 0.0, 1.0);
  vec4 current = sampleImage(uCurrent, uv, uCurrentSize);
  vec4 target = sampleImage(uNext, uv, uNextSize);
  if (p <= 0.0001) {
    outColor = vec4(current.rgb, 1.0);
    return;
  }
  if (p >= 0.9999) {
    outColor = vec4(target.rgb, 1.0);
    return;
  }

  float punchPhase = sin(smoothstep(0.76, 1.0, p) * 3.14159265);
  vec2 punchedUv = (uv - 0.5) * (1.0 - punchPhase * uPunch * 0.025) + 0.5;
  float cyanP = smoother(p / 0.86);
  float magentaP = smoother(max(0.0, p - 0.055) / 0.86);
  float yellowP = smoother(max(0.0, p - 0.105) / 0.84);
  float travel = 1.04 * uPlateSpread;
  vec2 redUv = punchedUv - vec2(-travel, 0.075 * uPlateSpread) * (1.0 - cyanP);
  vec2 greenUv = punchedUv - vec2(travel, -0.055 * uPlateSpread) * (1.0 - magentaP);
  vec2 blueUv = punchedUv - vec2(0.035 * uPlateSpread, travel) * (1.0 - yellowP);
  vec4 redPlate = sampleImage(uNext, redUv, uNextSize);
  vec4 greenPlate = sampleImage(uNext, greenUv, uNextSize);
  vec4 bluePlate = sampleImage(uNext, blueUv, uNextSize);

  float texturePhase = sin(p * 3.14159265);
  vec2 nextUv = fitUV(punchedUv, uNextSize);
  float redDot = halftone(nextUv, 0.18);
  float greenDot = halftone(nextUv, 1.23);
  float blueDot = halftone(nextUv, 2.31);
  float dotAmount = texturePhase * 0.28;
  float redInk = mix(redPlate.r, mix(uPaperTint.r, redPlate.r, redDot), dotAmount);
  float greenInk = mix(greenPlate.g, mix(uPaperTint.g, greenPlate.g, greenDot), dotAmount);
  float blueInk = mix(bluePlate.b, mix(uPaperTint.b, bluePlate.b, blueDot), dotAmount);

  vec3 color = current.rgb;
  color.r = mix(color.r, redInk, redPlate.a * cyanP);
  color.g = mix(color.g, greenInk, greenPlate.a * magentaP);
  color.b = mix(color.b, blueInk, bluePlate.a * yellowP);
  float paperNoise = hash21(gl_FragCoord.xy + floor(uTime * 3.0));
  color = mix(color, color * (0.965 + paperNoise * 0.07), texturePhase * 0.28);
  float registerFlash = smoothstep(0.86, 0.93, p) * (1.0 - smoothstep(0.96, 1.0, p));
  color += uPaperTint * registerFlash * uPunch * 0.12;
  outColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}
`;

function parseHexColor(value: string): [number, number, number] {
  let normalized = value.trim().replace('#', '');
  if (normalized.length === 3) {
    normalized = normalized.split('').map((character) => character + character).join('');
  }
  if (!/^[0-9a-f]{6}$/i.test(normalized)) return [0.933, 0.906, 0.847];
  const numeric = Number.parseInt(normalized, 16);
  return [
    ((numeric >> 16) & 255) / 255,
    ((numeric >> 8) & 255) / 255,
    (numeric & 255) / 255,
  ];
}

class MisregistrationEffect implements TransitionEffect {
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
    if (!gl) throw new Error('WebGL2 is required for the misregistration transition.');
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
      progress: gl.getUniformLocation(this.program, 'uProgress'),
      time: gl.getUniformLocation(this.program, 'uTime'),
      imageFit: gl.getUniformLocation(this.program, 'uImageFit'),
      plateSpread: gl.getUniformLocation(this.program, 'uPlateSpread'),
      halftoneScale: gl.getUniformLocation(this.program, 'uHalftoneScale'),
      punch: gl.getUniformLocation(this.program, 'uPunch'),
      paperTint: gl.getUniformLocation(this.program, 'uPaperTint'),
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
    const options = frame.options as MisregistrationOptions;
    const current = this.items[this.fromIndex];
    const next = this.items[this.toIndex];
    const paperTint = parseHexColor(options.paperTint ?? '#eee7d8');
    const gl = this.gl;
    gl.viewport(0, 0, this.width, this.height);
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    bindWebGL2Texture(gl, this.textures[this.fromIndex], 0, this.locations.current);
    bindWebGL2Texture(gl, this.textures[this.toIndex], 1, this.locations.next);
    gl.uniform2f(this.locations.resolution, this.width, this.height);
    gl.uniform2f(this.locations.currentSize, current.width, current.height);
    gl.uniform2f(this.locations.nextSize, next.width, next.height);
    gl.uniform1f(this.locations.progress, frame.progress);
    gl.uniform1f(this.locations.time, frame.time);
    gl.uniform1f(this.locations.imageFit, options.imageFit === 'contain' ? 1 : 0);
    gl.uniform1f(this.locations.plateSpread, Math.max(0, options.plateSpread ?? 0.72));
    gl.uniform1f(this.locations.halftoneScale, Math.max(1, options.halftoneScale ?? 155));
    gl.uniform1f(this.locations.punch, Math.max(0, options.punch ?? 0.46));
    gl.uniform3f(this.locations.paperTint, paperTint[0], paperTint[1], paperTint[2]);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  destroy(): void {
    this.textures.forEach((texture) => this.gl.deleteTexture(texture));
    if (this.vao) this.gl.deleteVertexArray(this.vao);
    if (this.program) this.gl.deleteProgram(this.program);
    this.canvas.remove();
  }
}

export const misregistrationTransition = defineTransition({
  name: 'misregistration',
  backend: 'webgl2',
  defaults: {
    plateSpread: 0.72,
    halftoneScale: 155,
    paperTint: '#eee7d8',
    punch: 0.46,
    imageFit: 'cover',
  },
  phaseEasing: 'power3.inOut',
  supported: () => typeof WebGL2RenderingContext !== 'undefined',
  create: () => new MisregistrationEffect(),
});
