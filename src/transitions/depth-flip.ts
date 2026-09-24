import { defineTransition } from '../registry';
import type {
  Direction,
  LoadedImage,
  VaryloomImageFit,
  TransitionEffect,
  TransitionEffectContext,
  TransitionFrame,
} from '../types';

export type DepthFlipDirection = 'auto' | 'right' | 'left' | 'bottom' | 'top';

export interface DepthFlipOptions {
  depth?: number;
  blur?: number;
  stagger?: number;
  perspective?: number;
  direction?: DepthFlipDirection;
  imageFit?: VaryloomImageFit;
}

const vertexShader = `#version 300 es
precision highp float;
precision highp int;

layout(location = 0) in vec2 aPosition;
layout(location = 1) in vec2 aUv;

uniform float uProgress;
uniform float uDepth;
uniform float uStagger;
uniform float uPerspective;
uniform int uDirection;

out vec2 vUv;
out float vPhase;
out float vTurn;
out float vLead;
out float vDepth;

const float PI = 3.141592653589793;

void main() {
  bool vertical = uDirection >= 2;
  float lead;
  if (uDirection == 0) lead = aUv.x;
  else if (uDirection == 1) lead = 1.0 - aUv.x;
  else if (uDirection == 2) lead = aUv.y;
  else lead = 1.0 - aUv.y;

  // A travelling two-sided fold. The front is untouched before the band, the
  // back is fully settled after it, and only the finite band turns through 180°.
  float foldCentre = 1.0 + uStagger - uProgress * (1.0 + 2.0 * uStagger);
  float phase = smoothstep(foldCentre - uStagger, foldCentre + uStagger, lead);
  float turn = sin(phase * PI);
  float theta = phase * PI;
  float face = cos(theta);
  vec2 p = aPosition;

  // Only the fold band recedes. Old and new regions stay in the same picture
  // plane, so they remain visibly connected instead of collapsing into a card.
  float z = -uDepth * turn * mix(0.88, 1.0, lead);

  // A restrained transverse bend prevents the turning boundary from looking
  // like a perfectly rigid ruler while keeping the image surface continuous.
  float bow = sin((lead - foldCentre) / max(uStagger, 0.001) * PI * 0.5) * turn * 0.032;
  if (!vertical) p.y += bow;
  else p.x -= bow;

  // True perspective: points with a larger negative z move toward the screen
  // centre and also lose vertical/horizontal scale, producing the depth cue.
  float projection = uPerspective / max(0.2, uPerspective - z);
  p *= projection;

  float depthNdc = clamp((-z) / max(0.01, uDepth + uPerspective) * 0.86, 0.0, 0.92);
  gl_Position = vec4(p, depthNdc, 1.0);
  vUv = aUv;
  vPhase = phase;
  vTurn = turn;
  vLead = lead;
  vDepth = -z;
}`;
const fragmentShader = `#version 300 es
precision highp float;
precision highp int;

uniform sampler2D uSource;
uniform sampler2D uTarget;
uniform vec2 uSourceSize;
uniform vec2 uTargetSize;
uniform vec2 uViewport;
uniform float uBlur;
uniform float uContain;
uniform int uDirection;

in vec2 vUv;
in float vPhase;
in float vTurn;
in float vLead;
in float vDepth;
out vec4 outColor;

vec3 fitInfo(vec2 uv, vec2 imageSize, float contain) {
  float viewAspect = uViewport.x / max(uViewport.y, 1.0);
  float imageAspect = imageSize.x / max(imageSize.y, 1.0);
  vec2 mapped = uv;
  if (contain > 0.5) {
    if (imageAspect > viewAspect) {
      float h = viewAspect / imageAspect;
      mapped.y = (uv.y - 0.5) / h + 0.5;
    } else {
      float w = imageAspect / viewAspect;
      mapped.x = (uv.x - 0.5) / w + 0.5;
    }
  } else {
    if (imageAspect > viewAspect) mapped.x = (uv.x - 0.5) * viewAspect / imageAspect + 0.5;
    else mapped.y = (uv.y - 0.5) * imageAspect / viewAspect + 0.5;
  }
  float inside = step(0.0, mapped.x) * step(mapped.x, 1.0) * step(0.0, mapped.y) * step(mapped.y, 1.0);
  return vec3(mapped, inside);
}

vec3 sampleFitted(sampler2D image, vec2 imageSize, vec2 uv) {
  vec3 fit = fitInfo(uv, imageSize, uContain);
  vec3 coverFit = fitInfo(uv, imageSize, 0.0);
  vec3 sharp = texture(image, clamp(fit.xy, 0.0, 1.0)).rgb;
  vec3 backdrop = texture(image, clamp(coverFit.xy, 0.0, 1.0)).rgb;
  float luma = dot(backdrop, vec3(0.2126, 0.7152, 0.0722));
  backdrop = mix(vec3(luma), backdrop, 0.22) * 0.075;
  return mix(backdrop, sharp, fit.z);
}

vec3 blurredSample(sampler2D image, vec2 imageSize, vec2 uv, float radiusPx) {
  vec2 axis = uDirection < 2 ? vec2(1.0, 0.34) : vec2(0.34, 1.0);
  axis /= max(uViewport, vec2(1.0));
  vec2 crossAxis = vec2(-axis.y, axis.x);
  vec2 r = axis * radiusPx;
  vec2 c = crossAxis * radiusPx * 0.58;
  vec3 sum = sampleFitted(image, imageSize, uv) * 0.154;
  sum += sampleFitted(image, imageSize, uv + r * 0.22 + c * 0.16) * 0.112;
  sum += sampleFitted(image, imageSize, uv - r * 0.22 - c * 0.16) * 0.112;
  sum += sampleFitted(image, imageSize, uv + r * 0.46 - c * 0.22) * 0.092;
  sum += sampleFitted(image, imageSize, uv - r * 0.46 + c * 0.22) * 0.092;
  sum += sampleFitted(image, imageSize, uv + r * 0.72 + c * 0.34) * 0.075;
  sum += sampleFitted(image, imageSize, uv - r * 0.72 - c * 0.34) * 0.075;
  sum += sampleFitted(image, imageSize, uv + r + c * 0.12) * 0.058;
  sum += sampleFitted(image, imageSize, uv - r - c * 0.12) * 0.058;
  sum += sampleFitted(image, imageSize, uv + c * 0.72) * 0.086;
  sum += sampleFitted(image, imageSize, uv - c * 0.72) * 0.086;
  return sum;
}

void main() {
  float face = cos(vPhase * 3.141592653589793);
  float optical = pow(max(vTurn, 0.0), 1.16);
  float radius = uBlur * optical * mix(7.0, 34.0, vLead);
  vec3 source = blurredSample(uSource, uSourceSize, vUv, radius);
  vec2 backUv = vUv;
  vec3 target = blurredSample(uTarget, uTargetSize, backUv, radius);

  // Front and back coexist during almost the whole transition. Only the narrow
  // edge-on strip blends, avoiding a hard aliasing seam on the rotating surface.
  float faceSwap = smoothstep(-0.065, 0.065, -face);
  vec3 color = mix(source, target, faceSwap);

  float dim = 1.0 - optical * mix(0.32, 0.69, vLead);
  float fog = optical * optical * mix(0.015, 0.085, vLead);
  color = color * dim + vec3(0.13, 0.15, 0.17) * fog;

  // A restrained white grazing highlight appears while the virtual surface is
  // nearly side-on, then disappears before the new image settles.
  float grazing = pow(max(0.0, 1.0 - abs(vPhase - 0.5) * 7.0), 3.0);
  float grain = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
  color += vec3(1.0, 1.02, 1.05) * grazing * (0.035 + grain * 0.012);

  // Very slight channel separation appears only at maximum depth.
  vec2 chromaOffset = vec2(1.5, 0.0) / max(uViewport, vec2(1.0)) * optical * uBlur;
  vec3 chroma = mix(
    sampleFitted(uSource, uSourceSize, vUv + chromaOffset),
    sampleFitted(uTarget, uTargetSize, backUv + chromaOffset),
    faceSwap
  );
  color.r = mix(color.r, chroma.r, optical * 0.055);

  outColor = vec4(max(color, vec3(0.0)), 1.0);
}`;

function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('Unable to create a depth-flip shader.');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) || 'Depth-flip shader compilation failed.';
    gl.deleteShader(shader);
    throw new Error(message);
  }
  return shader;
}

function createProgram(gl: WebGL2RenderingContext): WebGLProgram {
  const program = gl.createProgram();
  if (!program) throw new Error('Unable to create the depth-flip program.');
  const vertex = compileShader(gl, gl.VERTEX_SHADER, vertexShader);
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, fragmentShader);
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(program) || 'Unable to link the depth-flip program.');
  }
  return program;
}

function makeGrid(columns = 96, rows = 42): {
  vertices: Float32Array;
  indices: Uint32Array[];
} {
  const vertices: number[] = [];
  for (let y = 0; y <= rows; y += 1) {
    const v = y / rows;
    for (let x = 0; x <= columns; x += 1) {
      const u = x / columns;
      vertices.push(u * 2 - 1, 1 - v * 2, u, v);
    }
  }
  const stride = columns + 1;
  const createIndices = (axis: 'x' | 'y', reverse: boolean): Uint32Array => {
    const indices: number[] = [];
    const outerCount = axis === 'x' ? rows : columns;
    const innerCount = axis === 'x' ? columns : rows;
    for (let outerStep = 0; outerStep < outerCount; outerStep += 1) {
      const outer = reverse ? outerCount - 1 - outerStep : outerStep;
      for (let innerStep = 0; innerStep < innerCount; innerStep += 1) {
        const inner = reverse ? innerCount - 1 - innerStep : innerStep;
        const x = axis === 'x' ? inner : outer;
        const y = axis === 'x' ? outer : inner;
        const a = y * stride + x;
        const b = a + 1;
        const c = a + stride;
        const d = c + 1;
        indices.push(a, c, b, b, c, d);
      }
    }
    return new Uint32Array(indices);
  };
  return {
    vertices: new Float32Array(vertices),
    indices: [
      createIndices('x', false),
      createIndices('x', true),
      createIndices('y', false),
      createIndices('y', true),
    ],
  };
}

function createTexture(gl: WebGL2RenderingContext, item: LoadedImage): WebGLTexture {
  const texture = gl.createTexture();
  if (!texture) throw new Error('Unable to create a depth-flip texture.');
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, item.source);
  return texture;
}

class DepthFlipEffect implements TransitionEffect {
  readonly canvas = document.createElement('canvas');
  private gl!: WebGL2RenderingContext;
  private program!: WebGLProgram;
  private vao: WebGLVertexArrayObject | null = null;
  private vertexBuffer: WebGLBuffer | null = null;
  private indexBuffers: WebGLBuffer[] = [];
  private indexCount = 0;
  private textures: WebGLTexture[] = [];
  private items: LoadedImage[] = [];
  private uniforms: Record<string, WebGLUniformLocation | null> = {};
  private fromIndex = 0;
  private toIndex = 0;
  private navigationDirection: Direction = 1;
  private width = 1;
  private height = 1;

  init(context: TransitionEffectContext): void {
    const gl = this.canvas.getContext('webgl2', {
      alpha: false,
      antialias: true,
      depth: true,
      stencil: false,
      premultipliedAlpha: false,
      powerPreference: 'high-performance',
    });
    if (!gl) throw new Error('WebGL2 is required for the depth-flip transition.');
    this.gl = gl;
    this.items = context.items;
    this.program = createProgram(gl);
    this.uniforms = Object.fromEntries([
      'uProgress', 'uDepth', 'uStagger', 'uPerspective', 'uDirection',
      'uSource', 'uTarget', 'uSourceSize', 'uTargetSize', 'uViewport',
      'uBlur', 'uContain',
    ].map((name) => [name, gl.getUniformLocation(this.program, name)]));

    const grid = makeGrid();
    this.indexCount = grid.indices[0].length;
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    this.vertexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, grid.vertices, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 16, 8);
    this.indexBuffers = grid.indices.map((indices) => {
      const buffer = gl.createBuffer();
      if (!buffer) throw new Error('Unable to create a depth-flip index buffer.');
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
      return buffer;
    });
    gl.bindVertexArray(null);
    gl.useProgram(this.program);
    gl.uniform1i(this.uniforms.uSource, 0);
    gl.uniform1i(this.uniforms.uTarget, 1);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    this.textures = this.items.map((item) => createTexture(gl, item));
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

  private directionIndex(direction: DepthFlipDirection | undefined): number {
    const resolved = !direction || direction === 'auto'
      ? (this.navigationDirection > 0 ? 'right' : 'left')
      : direction;
    return ({ right: 0, left: 1, bottom: 2, top: 3 } as const)[resolved];
  }

  render(frame: TransitionFrame): void {
    const options = frame.options as DepthFlipOptions;
    const gl = this.gl;
    const source = this.items[this.fromIndex];
    const target = this.items[this.toIndex];
    const direction = this.directionIndex(options.direction);
    gl.viewport(0, 0, this.width, this.height);
    gl.clearColor(0.003, 0.006, 0.008, 1);
    gl.clearDepth(1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffers[direction]);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.textures[this.fromIndex]);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.textures[this.toIndex]);
    gl.uniform1f(this.uniforms.uProgress, frame.progress);
    gl.uniform1f(this.uniforms.uDepth, options.depth ?? 0.72);
    gl.uniform1f(this.uniforms.uStagger, options.stagger ?? 0.18);
    gl.uniform1f(this.uniforms.uPerspective, options.perspective ?? 2.15);
    gl.uniform1i(this.uniforms.uDirection, direction);
    gl.uniform2f(this.uniforms.uSourceSize, source.width, source.height);
    gl.uniform2f(this.uniforms.uTargetSize, target.width, target.height);
    gl.uniform2f(this.uniforms.uViewport, this.width, this.height);
    gl.uniform1f(this.uniforms.uBlur, options.blur ?? 0.72);
    gl.uniform1f(this.uniforms.uContain, options.imageFit === 'contain' ? 1 : 0);
    gl.drawElements(gl.TRIANGLES, this.indexCount, gl.UNSIGNED_INT, 0);
    gl.bindVertexArray(null);
  }

  destroy(): void {
    this.textures.forEach((texture) => this.gl.deleteTexture(texture));
    this.indexBuffers.forEach((buffer) => this.gl.deleteBuffer(buffer));
    if (this.vertexBuffer) this.gl.deleteBuffer(this.vertexBuffer);
    if (this.vao) this.gl.deleteVertexArray(this.vao);
    if (this.program) this.gl.deleteProgram(this.program);
    this.canvas.remove();
  }
}

export const depthFlipTransition = defineTransition({
  name: 'depth-flip',
  backend: 'webgl2',
  defaults: {
    depth: 0.72,
    blur: 0.72,
    stagger: 0.18,
    perspective: 2.15,
    direction: 'auto',
    imageFit: 'cover',
  },
  phaseEasing: 'none',
  supported: () => typeof WebGL2RenderingContext !== 'undefined',
  create: () => new DepthFlipEffect(),
});
