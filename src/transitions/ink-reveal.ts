import { defineTransition } from '../registry';
import type {
  Direction,
  LoadedImage,
  PrismorphImageFit,
  TransitionEffect,
  TransitionEffectContext,
  TransitionFrame,
} from '../types';

export interface InkRevealOptions {
  edgeStrength?: number;
  /** Delay, in seconds, before the revealed pixels reach their final colour. */
  colorLag?: number;
  /** How each image is fitted inside the transition viewport. */
  imageFit?: PrismorphImageFit;
  /** Shows the procedural reveal field for effect tuning. */
  debugField?: boolean;
}

const vertexShader = `#version 300 es
precision highp float;

const vec2 POSITIONS[3] = vec2[3](
  vec2(-1.0, -1.0),
  vec2(3.0, -1.0),
  vec2(-1.0, 3.0)
);

out vec2 vUv;

void main() {
  vec2 position = POSITIONS[gl_VertexID];
  vUv = position * 0.5 + 0.5;
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

const fragmentShader = `#version 300 es
precision highp float;

uniform sampler2D uCurrent;
uniform sampler2D uNext;
uniform float uProgress;
uniform float uEdgeStrength;
uniform float uColorLag;
uniform float uDebugField;
uniform float uImageFit;
uniform vec2 uResolution;
uniform vec2 uCurrentSize;
uniform vec2 uNextSize;

in vec2 vUv;
out vec4 outColor;

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
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float fbm(vec2 p) {
  float value = 0.0;
  float amplitude = 0.5;
  mat2 rotateScale = mat2(1.62, 1.18, -1.18, 1.62);
  for (int i = 0; i < 5; i++) {
    value += amplitude * valueNoise(p);
    p = rotateScale * p + vec2(4.17, 7.31);
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

float revealTime(vec2 uv) {
  float broad = fbm(uv * vec2(2.15, 2.8) + vec2(2.6, 6.4));
  float medium = fbm(uv * vec2(5.6, 7.2) + vec2(8.1, 1.7));
  float fibers = valueNoise(uv * vec2(19.0, 27.0) + vec2(5.0, 9.0));
  float broadWarp = (broad - 0.5) * 0.24;
  float mediumWarp = (medium - 0.5) * 0.12;

  float diagonalFront = 0.14 + uv.y * 0.70 + uv.x * 0.11 + broadWarp + mediumWarp * 0.56;
  float lowerLeftBloom = 0.155
    + length((uv - vec2(0.08, 0.20)) * vec2(0.92, 0.64)) * 0.78
    + broadWarp * 0.68 + mediumWarp * 0.42;
  float centerBloom = 0.205
    + length((uv - vec2(0.50, 0.38)) * vec2(1.0, 0.82)) * 0.92
    + broadWarp * 0.34 + mediumWarp * 0.72;
  float rightIsland = 0.285
    + length((uv - vec2(0.80, 0.49)) * vec2(1.20, 0.88)) * 0.88
    + broadWarp * 0.30 + mediumWarp * 0.78;
  float upperIsland = 0.39
    + length((uv - vec2(0.34, 0.72)) * vec2(1.18, 0.92)) * 1.08
    + broadWarp * 0.22 + mediumWarp * 0.64;

  float field = min(min(diagonalFront, lowerLeftBloom), min(centerBloom, min(rightIsland, upperIsland)));
  field += (fibers - 0.5) * 0.026;
  float centerHole = exp(-17.0 * dot(uv - vec2(0.62, 0.55), uv - vec2(0.62, 0.55)));
  float lowerHole = exp(-25.0 * dot(uv - vec2(0.78, 0.25), uv - vec2(0.78, 0.25)));
  field += centerHole * 0.12 + lowerHole * 0.09;
  return clamp(field, 0.145, 0.955);
}

void main() {
  vec2 uv = vUv;
  float field = revealTime(uv);
  float fineNoise = fbm(uv * vec2(10.0, 13.0) + vec2(13.0, 3.0));
  float feather = mix(0.018, 0.045, fineNoise);
  float alpha = smoothstep(field - feather, field + feather, uProgress);
  float colorProgress = uProgress - uColorLag;
  float chroma = smoothstep(field - feather * 0.72, field + feather * 1.08, colorProgress);
  chroma = max(chroma, smoothstep(0.92, 1.0, uProgress));

  if (uDebugField > 0.5) {
    vec3 fieldColor = vec3(field);
    float front = 1.0 - smoothstep(0.0, 0.012, abs(field - uProgress));
    float colorFront = 1.0 - smoothstep(0.0, 0.012, abs(field - colorProgress));
    fieldColor = mix(fieldColor, vec3(0.96, 0.73, 0.30), front);
    fieldColor = mix(fieldColor, vec3(0.34, 0.66, 0.88), colorFront * 0.86);
    outColor = vec4(fieldColor, 1.0);
    return;
  }

  vec2 currentUV = fitUV(uv, uResolution, uCurrentSize);
  vec2 nextUV = fitUV(uv, uResolution, uNextSize);
  vec3 backdrop = vec3(0.012, 0.014, 0.016);
  vec3 currentColor = mix(backdrop, texture(uCurrent, clamp(currentUV, 0.0, 1.0)).rgb, imageMask(currentUV));
  vec3 nextColor = mix(backdrop, texture(uNext, clamp(nextUV, 0.0, 1.0)).rgb, imageMask(nextUV));
  float luminance = dot(nextColor, vec3(0.2126, 0.7152, 0.0722));
  vec3 paperGray = vec3(luminance) * vec3(0.96, 0.975, 0.97);
  vec3 grayTarget = mix(paperGray, nextColor, 0.10);
  grayTarget = mix(vec3(0.47), grayTarget, 0.90);
  vec3 revealedTarget = mix(grayTarget, nextColor, chroma);
  vec3 color = mix(currentColor, revealedTarget, alpha);

  float distanceToFront = abs(field - uProgress);
  float rim = 1.0 - smoothstep(0.008, 0.070, distanceToFront);
  float wisp = smoothstep(0.22, 0.82, fineNoise);
  rim *= mix(0.56, 1.0, wisp);
  rim *= smoothstep(0.08, 0.18, uProgress);
  rim *= 1.0 - smoothstep(0.90, 1.0, uProgress);
  float dryBrush = valueNoise(uv * vec2(36.0, 52.0));
  rim *= mix(0.52, 1.0, smoothstep(0.26, 0.76, dryBrush));
  vec3 paperWhite = mix(vec3(0.76, 0.72, 0.64), vec3(1.0, 0.96, 0.84), fineNoise);
  color = mix(color, paperWhite, rim * 0.58 * uEdgeStrength);
  float innerInk = (1.0 - smoothstep(0.0, 0.10, uProgress - field)) * alpha;
  color *= 1.0 - innerInk * 0.08 * uEdgeStrength;

  vec2 centered = uv - 0.5;
  float vignette = smoothstep(0.92, 0.30, dot(centered, centered));
  color *= mix(0.83, 1.0, vignette);
  outColor = vec4(color, 1.0);
}
`;

function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('Unable to create WebGL shader.');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) || 'Shader compilation failed.';
    gl.deleteShader(shader);
    throw new Error(message);
  }
  return shader;
}

function createProgram(gl: WebGL2RenderingContext): WebGLProgram {
  const program = gl.createProgram();
  if (!program) throw new Error('Unable to create WebGL program.');
  const vertex = compileShader(gl, gl.VERTEX_SHADER, vertexShader);
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, fragmentShader);
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(program) || 'Program linking failed.';
    gl.deleteProgram(program);
    throw new Error(message);
  }
  return program;
}

class InkRevealEffect implements TransitionEffect {
  readonly canvas = document.createElement('canvas');
  private gl!: WebGL2RenderingContext;
  private program!: WebGLProgram;
  private items: LoadedImage[] = [];
  private textures: WebGLTexture[] = [];
  private fromIndex = 0;
  private toIndex = 0;
  private width = 1;
  private height = 1;
  private locations!: Record<string, WebGLUniformLocation | null>;

  init(context: TransitionEffectContext): void {
    context.host.appendChild(this.canvas);
    const gl = this.canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
      powerPreference: 'high-performance',
    });
    if (!gl) throw new Error('WebGL2 is required for the ink-reveal transition.');
    this.gl = gl;
    this.items = context.items;
    this.program = createProgram(gl);
    this.locations = {
      current: gl.getUniformLocation(this.program, 'uCurrent'),
      next: gl.getUniformLocation(this.program, 'uNext'),
      progress: gl.getUniformLocation(this.program, 'uProgress'),
      edgeStrength: gl.getUniformLocation(this.program, 'uEdgeStrength'),
      colorLag: gl.getUniformLocation(this.program, 'uColorLag'),
      debugField: gl.getUniformLocation(this.program, 'uDebugField'),
      imageFit: gl.getUniformLocation(this.program, 'uImageFit'),
      resolution: gl.getUniformLocation(this.program, 'uResolution'),
      currentSize: gl.getUniformLocation(this.program, 'uCurrentSize'),
      nextSize: gl.getUniformLocation(this.program, 'uNextSize'),
    };
    this.textures = this.items.map((item) => this.createTexture(item));
    this.resize(context.width, context.height, context.dpr);
  }

  private createTexture(item: LoadedImage): WebGLTexture {
    const texture = this.gl.createTexture();
    if (!texture) throw new Error('Unable to create WebGL texture.');
    this.gl.bindTexture(this.gl.TEXTURE_2D, texture);
    this.gl.pixelStorei(this.gl.UNPACK_FLIP_Y_WEBGL, true);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.LINEAR);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.LINEAR);
    this.gl.texImage2D(this.gl.TEXTURE_2D, 0, this.gl.RGBA, this.gl.RGBA, this.gl.UNSIGNED_BYTE, item.source);
    return texture;
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
    const options = frame.options as {
      edgeStrength?: number;
      colorLag?: number;
      debugField?: boolean;
      imageFit?: PrismorphImageFit;
    };
    const current = this.items[this.fromIndex];
    const next = this.items[this.toIndex];
    this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    this.gl.useProgram(this.program);
    this.gl.activeTexture(this.gl.TEXTURE0);
    this.gl.bindTexture(this.gl.TEXTURE_2D, this.textures[this.fromIndex]);
    this.gl.uniform1i(this.locations.current, 0);
    this.gl.activeTexture(this.gl.TEXTURE1);
    this.gl.bindTexture(this.gl.TEXTURE_2D, this.textures[this.toIndex]);
    this.gl.uniform1i(this.locations.next, 1);
    this.gl.uniform1f(this.locations.progress, frame.progress);
    this.gl.uniform1f(this.locations.edgeStrength, options.edgeStrength ?? 0.72);
    this.gl.uniform1f(this.locations.colorLag, (options.colorLag ?? 0.07) / Math.max(frame.duration, 0.001));
    this.gl.uniform1f(this.locations.debugField, options.debugField ? 1 : 0);
    this.gl.uniform1f(this.locations.imageFit, options.imageFit === 'contain' ? 1 : 0);
    this.gl.uniform2f(this.locations.resolution, this.width, this.height);
    this.gl.uniform2f(this.locations.currentSize, current.width, current.height);
    this.gl.uniform2f(this.locations.nextSize, next.width, next.height);
    this.gl.drawArrays(this.gl.TRIANGLES, 0, 3);
  }

  destroy(): void {
    this.textures.forEach((texture) => this.gl.deleteTexture(texture));
    if (this.program) this.gl.deleteProgram(this.program);
    this.canvas.remove();
  }
}

export const inkRevealTransition = defineTransition({
  name: 'ink-reveal',
  backend: 'webgl2',
  defaults: {
    edgeStrength: 0.72,
    colorLag: 0.07,
    imageFit: 'cover',
    debugField: false,
  },
  supported: () => typeof WebGL2RenderingContext !== 'undefined',
  create: () => new InkRevealEffect(),
});
