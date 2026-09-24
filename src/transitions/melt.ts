import { Mesh, Program, Renderer, Texture, Triangle } from 'ogl';

import { defineTransition } from '../registry';
import type {
  Direction,
  LoadedImage,
  VaryloomImageFit,
  TransitionEffect,
  TransitionEffectContext,
  TransitionFrame,
} from '../types';

export interface MeltOptions {
  intensity?: number;
  scale?: number;
  aberration?: number;
  drift?: number;
  overlayColor?: string;
  imageFit?: VaryloomImageFit;
}

const vertexShader = `
attribute vec2 position;
attribute vec2 uv;
varying vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

const fragmentShader = `
precision highp float;

uniform sampler2D tCurrent;
uniform sampler2D tNext;
uniform vec2 uResolution;
uniform vec2 uCurrentSize;
uniform vec2 uNextSize;
uniform float uProgress;
uniform float uDir;
uniform float uIntensity;
uniform float uScale;
uniform float uAberration;
uniform float uDrift;
uniform float uTime;
uniform float uImageFit;
uniform vec3 uOverlay;
varying vec2 vUv;

const float PI = 3.14159265359;

float hash21(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm(vec2 p) {
  float value = 0.0;
  float amplitude = 0.5;
  for (int i = 0; i < 5; i++) {
    value += amplitude * noise(p);
    p *= 2.0;
    amplitude *= 0.5;
  }
  return value;
}

vec2 fitUV(vec2 uv, vec2 resolution, vec2 imageSize) {
  float viewAspect = resolution.x / max(resolution.y, 1.0);
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

void main() {
  float progress = clamp(uProgress, 0.0, 1.0);
  float envelope = sin(progress * PI);
  vec2 uv = vUv;

  uv += vec2(
    sin(uTime * 0.25 + uv.y * 4.0),
    cos(uTime * 0.22 + uv.x * 4.0)
  ) * uDrift * 0.008;
  uv = (uv - 0.5) * (1.0 - uDrift * 0.02 * sin(uTime * 0.4)) + 0.5;

  float primaryNoise = fbm(uv * uScale + uTime * 0.03);
  float secondaryNoise = fbm(uv * uScale * 1.7 - uTime * 0.02);
  vec2 field = vec2(primaryNoise, secondaryNoise) - 0.5;
  vec2 currentUV = uv + field * uIntensity * 0.5 * progress;
  vec2 nextUV = uv - field * uIntensity * 0.5 * (1.0 - progress);
  float blendMask = smoothstep(primaryNoise - 0.15, primaryNoise + 0.15, progress);

  vec2 currentSample = fitUV(currentUV, uResolution, uCurrentSize);
  vec2 nextSample = fitUV(nextUV, uResolution, uNextSize);
  float chroma = uAberration * envelope * 0.03;

  vec3 currentColor = vec3(
    texture2D(tCurrent, clamp(currentSample + vec2(chroma, 0.0), 0.0, 1.0)).r,
    texture2D(tCurrent, clamp(currentSample, 0.0, 1.0)).g,
    texture2D(tCurrent, clamp(currentSample - vec2(chroma, 0.0), 0.0, 1.0)).b
  );
  vec3 nextColor = vec3(
    texture2D(tNext, clamp(nextSample + vec2(chroma, 0.0), 0.0, 1.0)).r,
    texture2D(tNext, clamp(nextSample, 0.0, 1.0)).g,
    texture2D(tNext, clamp(nextSample - vec2(chroma, 0.0), 0.0, 1.0)).b
  );

  vec3 backdrop = vec3(0.012, 0.014, 0.016);
  currentColor = mix(backdrop, currentColor, imageMask(currentSample));
  nextColor = mix(backdrop, nextColor, imageMask(nextSample));

  vec3 color = mix(currentColor, nextColor, blendMask);
  float vignette = smoothstep(1.25, 0.25, length(uv - 0.5));
  color = mix(color, uOverlay, (1.0 - vignette) * 0.28);
  gl_FragColor = vec4(color, 1.0);
}
`;

function hexToRgb(hex: string): [number, number, number] {
  let value = hex.replace('#', '');
  if (value.length === 3) value = value.split('').map((character) => character + character).join('');
  const number = Number.parseInt(value, 16);
  return [((number >> 16) & 255) / 255, ((number >> 8) & 255) / 255, (number & 255) / 255];
}

class MeltEffect implements TransitionEffect {
  readonly continuous = true;
  readonly canvas: HTMLCanvasElement;
  private renderer!: Renderer;
  private program!: Program;
  private mesh!: Mesh;
  private items: LoadedImage[] = [];
  private textures: Texture[] = [];
  private sizes: Array<[number, number]> = [];
  private fromIndex = 0;
  private toIndex = 0;

  constructor() {
    this.canvas = document.createElement('canvas');
  }

  init(context: TransitionEffectContext): void {
    this.renderer = new Renderer({
      canvas: this.canvas,
      alpha: false,
      antialias: true,
      dpr: context.dpr,
    });
    const gl = this.renderer.gl;
    gl.clearColor(0.035, 0.035, 0.04, 1);
    context.host.appendChild(this.canvas);
    this.items = context.items;
    this.sizes = this.items.map((item) => [item.width, item.height]);
    this.textures = this.items.map((item) => {
      const texture = new Texture(gl, { generateMipmaps: false });
      texture.image = item.source as HTMLImageElement;
      return texture;
    });
    this.program = new Program(gl, {
      vertex: vertexShader,
      fragment: fragmentShader,
      uniforms: {
        tCurrent: { value: this.textures[0] },
        tNext: { value: this.textures[0] },
        uResolution: { value: [1, 1] },
        uCurrentSize: { value: this.sizes[0] },
        uNextSize: { value: this.sizes[0] },
        uProgress: { value: 1 },
        uDir: { value: 1 },
        uIntensity: { value: 0.55 },
        uScale: { value: 2.4 },
        uAberration: { value: 0.35 },
        uDrift: { value: 0.4 },
        uTime: { value: 0 },
        uImageFit: { value: 0 },
        uOverlay: { value: [0, 0, 0] },
      },
    });
    this.mesh = new Mesh(gl, { geometry: new Triangle(gl), program: this.program });
    this.resize(context.width, context.height, context.dpr);
  }

  prepare(fromIndex: number, toIndex: number, direction: Direction): void {
    this.fromIndex = fromIndex;
    this.toIndex = toIndex;
    this.program.uniforms.tCurrent.value = this.textures[fromIndex];
    this.program.uniforms.tNext.value = this.textures[toIndex];
    this.program.uniforms.uCurrentSize.value = this.sizes[fromIndex];
    this.program.uniforms.uNextSize.value = this.sizes[toIndex];
    this.program.uniforms.uDir.value = direction;
  }

  resize(width: number, height: number, dpr: number): void {
    this.renderer.dpr = dpr;
    this.renderer.setSize(Math.max(1, width), Math.max(1, height));
    this.program.uniforms.uResolution.value = [this.canvas.width, this.canvas.height];
  }

  render(frame: TransitionFrame): void {
    const options = frame.options as {
      intensity?: number;
      scale?: number;
      aberration?: number;
      drift?: number;
      overlayColor?: string;
      imageFit?: VaryloomImageFit;
    };
    this.program.uniforms.uProgress.value = frame.progress;
    this.program.uniforms.uTime.value = frame.time;
    this.program.uniforms.uIntensity.value = options.intensity ?? 0.55;
    this.program.uniforms.uScale.value = options.scale ?? 2.4;
    this.program.uniforms.uAberration.value = options.aberration ?? 0.35;
    this.program.uniforms.uDrift.value = options.drift ?? 0.4;
    this.program.uniforms.uImageFit.value = options.imageFit === 'contain' ? 1 : 0;
    this.program.uniforms.uOverlay.value = hexToRgb(options.overlayColor ?? '#000000');
    this.renderer.render({ scene: this.mesh });
  }

  destroy(): void {
    const gl = this.renderer?.gl;
    if (gl) {
      this.textures.forEach((texture) => texture.texture && gl.deleteTexture(texture.texture));
      if (this.program?.program) gl.deleteProgram(this.program.program);
    }
    this.canvas.remove();
  }
}

export const meltTransition = defineTransition({
  name: 'melt',
  backend: 'ogl',
  defaults: {
    intensity: 0.55,
    scale: 2.4,
    aberration: 0.35,
    drift: 0.4,
    overlayColor: '#000000',
    imageFit: 'cover',
  },
  supported: () => typeof WebGLRenderingContext !== 'undefined',
  create: () => new MeltEffect(),
});
