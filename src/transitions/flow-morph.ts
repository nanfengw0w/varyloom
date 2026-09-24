import { defineTransition } from '../registry';
import type {
  Direction,
  LoadedImage,
  VaryloomImageFit,
  TransitionEffect,
  TransitionEffectContext,
  TransitionFrame,
} from '../types';
import { createWebGL2Program, createWebGL2Texture } from './webgl2-utils';

export interface FlowMorphOptions {
  strength?: number;
  alpha?: number;
  flowBias?: number;
  aberration?: number;
  imageFit?: VaryloomImageFit;
}

const LEVEL_HEIGHTS = [16, 32, 64, 128] as const;
const LEVEL_ITERATIONS = [60, 36, 24, 20] as const;
const FLOW_RANGE = 0.16;

const hsShader = `#version 300 es
precision highp float;

uniform sampler2D uImg1;
uniform sampler2D uImg2;
uniform sampler2D uFlow;
uniform vec2 uTexel;
uniform float uAlpha2;
uniform float uMaxFlow;

out vec4 outColor;

const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);

vec2 decodeFlow(vec2 e) { return (e - 0.5) * ${FLOW_RANGE}; }
vec2 encodeFlow(vec2 f) { return clamp(f / ${FLOW_RANGE} + 0.5, 0.0, 1.0); }

float lum(sampler2D t, vec2 uv) {
  return dot(texture(t, clamp(uv, vec2(0.001), vec2(0.999))).rgb, LUMA);
}

void main() {
  vec2 uv = gl_FragCoord.xy * uTexel;
  vec2 f = decodeFlow(texture(uFlow, uv).rg);
  vec2 fn = decodeFlow(texture(uFlow, uv + vec2(0.0, uTexel.y)).rg);
  vec2 fs = decodeFlow(texture(uFlow, uv - vec2(0.0, uTexel.y)).rg);
  vec2 fe = decodeFlow(texture(uFlow, uv + vec2(uTexel.x, 0.0)).rg);
  vec2 fw = decodeFlow(texture(uFlow, uv - vec2(uTexel.x, 0.0)).rg);
  vec2 avg = (f * 4.0 + fn + fs + fe + fw) / 8.0;

  float gradStep = 1.5;
  float Ix = (lum(uImg1, uv + vec2(uTexel.x * gradStep, 0.0)) - lum(uImg1, uv - vec2(uTexel.x * gradStep, 0.0))) * 0.5;
  float Iy = (lum(uImg1, uv + vec2(0.0, uTexel.y * gradStep)) - lum(uImg1, uv - vec2(0.0, uTexel.y * gradStep))) * 0.5;
  float I1 = lum(uImg1, uv);
  float I2w = lum(uImg2, uv + f);
  float It = I2w - I1;

  float denom = uAlpha2 + Ix * Ix + Iy * Iy;
  float num = Ix * avg.x + Iy * avg.y + It;
  vec2 updated = vec2(avg.x - Ix * num / denom, avg.y - Iy * num / denom);
  updated = clamp(updated, vec2(-uMaxFlow), vec2(uMaxFlow));
  outColor = vec4(encodeFlow(updated), 0.0, 1.0);
}
`;
const copyShader = `#version 300 es
precision highp float;
uniform sampler2D uSrc;
uniform vec2 uDstTexel;
out vec4 outColor;
void main() {
  outColor = texture(uSrc, gl_FragCoord.xy * uDstTexel);
}
`;
const renderShader = `#version 300 es
precision highp float;

uniform sampler2D uOld;
uniform sampler2D uNew;
uniform sampler2D uFlow;
uniform vec2 uViewport;
uniform vec2 uOldSize;
uniform vec2 uNewSize;
uniform float uProgress;
uniform float uCover;
uniform float uStrength;
uniform float uFlowBias;
uniform float uAberration;
uniform float uDebug;

out vec4 outColor;

const vec3 BACKDROP = vec3(0.014, 0.024, 0.028);

vec2 fitScale(vec2 imgSize) {
  float va = uViewport.x / max(uViewport.y, 1.0);
  float ia = imgSize.x / max(imgSize.y, 1.0);
  return uCover > 0.5
    ? (va > ia ? vec2(1.0, ia / va) : vec2(va / ia, 1.0))
    : (va > ia ? vec2(va / ia, 1.0) : vec2(1.0, ia / va));
}

vec2 fitUV(vec2 uv, vec2 imgSize) {
  return (uv - 0.5) * fitScale(imgSize) + 0.5;
}

vec3 sampleWarped(sampler2D tex, vec2 size, vec2 uv, vec2 warp) {
  vec2 f = fitUV(uv, size);
  if (f.x < 0.0 || f.x > 1.0 || f.y < 0.0 || f.y > 1.0) return BACKDROP;
  vec2 fw = clamp(fitUV(warp, size), vec2(0.0), vec2(1.0));
  return texture(tex, fw).rgb;
}

// 沿运动路径的 3-tap 拖影：抹平前向采样撕裂，读作"液体拉伸"
vec3 smear(sampler2D tex, vec2 size, vec2 uv, vec2 base, vec2 dirF, float blurLen) {
  return sampleWarped(tex, size, uv, base) * 0.5
    + sampleWarped(tex, size, uv, base - dirF * blurLen) * 0.3
    + sampleWarped(tex, size, uv, base - dirF * blurLen * 2.0) * 0.2;
}

vec2 decodeFlow(vec2 e) { return (e - 0.5) * ${FLOW_RANGE}; }

void main() {
  vec2 uv = gl_FragCoord.xy / uViewport;
  float p = clamp(uProgress, 0.0, 1.0);

  // 流场 5-tap 平滑：抑制细层迭代残留下的小尺度噪声
  vec2 flowTexel = vec2(1.0 / 128.0, 1.0 / 128.0);
  vec2 fe = decodeFlow(texture(uFlow, uv).rg);
  vec2 fn = decodeFlow(texture(uFlow, uv + vec2(0.0, flowTexel.y * 3.0)).rg);
  vec2 fsw = decodeFlow(texture(uFlow, uv - vec2(0.0, flowTexel.y * 3.0)).rg);
  vec2 fE = decodeFlow(texture(uFlow, uv + vec2(flowTexel.x * 3.0, 0.0)).rg);
  vec2 fW = decodeFlow(texture(uFlow, uv - vec2(flowTexel.x * 3.0, 0.0)).rg);
  vec2 fRaw = (fe * 2.0 + fn + fsw + fE + fW) / 6.0;
  vec2 f = fRaw * uStrength;
  float mag = length(f);
  vec2 dirF = mag > 0.0005 ? f / mag : vec2(0.0);

  // 沿运动路径的拖影；色散偏移并入采样坐标，保证三个通道模糊一致
  // 拖影与色散都乘钟形因子，端点处归零，保证首尾帧无损
  float bellPre = p * (1.0 - p) * 4.0;
  float blurLen = clamp(mag * uFlowBias * 6.0, 0.0, 0.02) * bellPre;
  float aberr = uAberration * bellPre * 0.0035 * clamp(mag * 10.0, 0.0, 1.0);
  vec2 perp = mag > 0.0005 ? vec2(-f.y, f.x) / mag : vec2(0.0);
  vec2 baseOld = uv + f * p;
  vec2 baseNew = uv + f * (p - 1.0);
  vec3 oldC = smear(uOld, uOldSize, uv, baseOld, dirF, blurLen);
  vec3 newC = vec3(
    smear(uNew, uNewSize, uv, baseNew + perp * aberr, dirF, blurLen).r,
    smear(uNew, uNewSize, uv, baseNew, dirF, blurLen).g,
    smear(uNew, uNewSize, uv, baseNew - perp * aberr, dirF, blurLen).b);

  // 全局平滑交接窗口：交互感由形变本身承担
  float reveal = smoothstep(0.5 - 0.24, 0.5 + 0.24, p);

  vec3 col = mix(oldC, newC, reveal);

  if (uDebug > 0.5) {
    col = vec3(0.03) + vec3(f.x, f.y, 0.0) * 5.0 + mag * 1.5;
    col = mix(col, vec3(1.0, 0.8, 0.2), reveal * 0.12);
  }

  outColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;

interface TextureEntry {
  texture: WebGLTexture;
  width: number;
  height: number;
}

interface RenderTarget {
  texture: WebGLTexture;
  framebuffer: WebGLFramebuffer;
  width: number;
  height: number;
}

interface FlowLevel {
  width: number;
  height: number;
  texel: [number, number];
  a: RenderTarget;
  b: RenderTarget;
}

function locations(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
  names: readonly string[],
): Record<string, WebGLUniformLocation | null> {
  return Object.fromEntries(names.map((name) => [name, gl.getUniformLocation(program, name)]));
}

class FlowMorphEffect implements TransitionEffect {
  readonly canvas = document.createElement('canvas');
  private gl!: WebGL2RenderingContext;
  private items: LoadedImage[] = [];
  private textures: TextureEntry[] = [];
  private hsProgram!: WebGLProgram;
  private copyProgram!: WebGLProgram;
  private renderProgram!: WebGLProgram;
  private hsUniforms: Record<string, WebGLUniformLocation | null> = {};
  private copyUniforms: Record<string, WebGLUniformLocation | null> = {};
  private drawUniforms: Record<string, WebGLUniformLocation | null> = {};
  private vao: WebGLVertexArrayObject | null = null;
  private neutralFlow!: WebGLTexture;
  private fromIndex = 0;
  private toIndex = 0;
  private width = 1;
  private height = 1;
  private levels: FlowLevel[] = [];
  private levelAspect = 0;
  private levelCache = new Map<string, TextureEntry>();
  private flowCache = new Map<string, WebGLTexture>();
  private downscaleCanvas = document.createElement('canvas');

  init(context: TransitionEffectContext): void {
    const gl = this.canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
      powerPreference: 'high-performance',
    });
    if (!gl) throw new Error('WebGL2 is required for the flow-morph transition.');
    this.gl = gl;
    this.items = context.items;
    this.hsProgram = createWebGL2Program(gl, hsShader);
    this.copyProgram = createWebGL2Program(gl, copyShader);
    this.renderProgram = createWebGL2Program(gl, renderShader);
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    this.hsUniforms = locations(gl, this.hsProgram, ['uImg1', 'uImg2', 'uFlow', 'uTexel', 'uAlpha2', 'uMaxFlow']);
    this.copyUniforms = locations(gl, this.copyProgram, ['uSrc', 'uDstTexel']);
    this.drawUniforms = locations(gl, this.renderProgram, [
      'uOld', 'uNew', 'uFlow', 'uViewport', 'uOldSize', 'uNewSize',
      'uProgress', 'uCover', 'uStrength', 'uFlowBias', 'uAberration', 'uDebug',
    ]);
    gl.useProgram(this.hsProgram);
    gl.uniform1i(this.hsUniforms.uImg1, 0);
    gl.uniform1i(this.hsUniforms.uImg2, 1);
    gl.uniform1i(this.hsUniforms.uFlow, 2);
    gl.useProgram(this.copyProgram);
    gl.uniform1i(this.copyUniforms.uSrc, 0);
    gl.useProgram(this.renderProgram);
    gl.uniform1i(this.drawUniforms.uOld, 0);
    gl.uniform1i(this.drawUniforms.uNew, 1);
    gl.uniform1i(this.drawUniforms.uFlow, 2);

    const neutral = gl.createTexture();
    if (!neutral) throw new Error('Unable to create a neutral optical-flow texture.');
    this.neutralFlow = neutral;
    gl.bindTexture(gl.TEXTURE_2D, neutral);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([128, 128, 0, 255]));

    this.textures = this.items.map((item) => ({
      texture: createWebGL2Texture(gl, item),
      width: item.width,
      height: item.height,
    }));
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

  private dimensions(): Array<{ width: number; height: number }> {
    const aspect = Math.min(Math.max(this.width / Math.max(this.height, 1), 0.3), 3.5);
    return LEVEL_HEIGHTS.map((height) => ({
      height,
      width: Math.max(8, Math.round(height * aspect)),
    }));
  }

  private createTarget(width: number, height: number): RenderTarget {
    const gl = this.gl;
    const texture = gl.createTexture();
    const framebuffer = gl.createFramebuffer();
    if (!texture || !framebuffer) throw new Error('Unable to create optical-flow render target.');
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { texture, framebuffer, width, height };
  }

  private imageLevel(imageIndex: number, width: number, height: number): TextureEntry {
    const key = `${imageIndex}:${width}x${height}`;
    const cached = this.levelCache.get(key);
    if (cached) return cached;
    const ctx = this.downscaleCanvas.getContext('2d');
    if (!ctx) throw new Error('Unable to create the optical-flow downscale canvas.');
    this.downscaleCanvas.width = width;
    this.downscaleCanvas.height = height;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(this.items[imageIndex].source, 0, 0, width, height);
    const texture = this.gl.createTexture();
    if (!texture) throw new Error('Unable to create an optical-flow image level.');
    this.gl.bindTexture(this.gl.TEXTURE_2D, texture);
    this.gl.pixelStorei(this.gl.UNPACK_FLIP_Y_WEBGL, true);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.LINEAR);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.LINEAR);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE);
    this.gl.texImage2D(this.gl.TEXTURE_2D, 0, this.gl.RGBA, this.gl.RGBA, this.gl.UNSIGNED_BYTE, this.downscaleCanvas);
    const entry = { texture, width, height };
    this.levelCache.set(key, entry);
    return entry;
  }

  private clearLevels(): void {
    for (const level of this.levels) {
      for (const target of [level.a, level.b]) {
        this.gl.deleteTexture(target.texture);
        this.gl.deleteFramebuffer(target.framebuffer);
      }
    }
    this.levels = [];
    this.flowCache.clear();
  }

  private computeFlow(alpha: number): WebGLTexture {
    const dimensions = this.dimensions();
    const top = dimensions[dimensions.length - 1];
    const key = `${this.fromIndex}-${this.toIndex}-a${Math.round(alpha * 400)}-${top.width}x${top.height}`;
    const cached = this.flowCache.get(key);
    if (cached) return cached;
    const gl = this.gl;
    const aspect = top.width / top.height;
    if (!this.levels.length || this.levelAspect !== aspect) {
      this.clearLevels();
      this.levels = dimensions.map(({ width, height }) => ({
        width,
        height,
        texel: [1 / width, 1 / height],
        a: this.createTarget(width, height),
        b: this.createTarget(width, height),
      }));
      this.levelAspect = aspect;
    }

    gl.bindVertexArray(this.vao);
    gl.useProgram(this.hsProgram);
    gl.uniform1f(this.hsUniforms.uAlpha2, alpha * alpha);
    gl.uniform1f(this.hsUniforms.uMaxFlow, 0.075);

    this.levels.forEach((level, index) => {
      const first = this.imageLevel(this.fromIndex, level.width, level.height);
      const second = this.imageLevel(this.toIndex, level.width, level.height);
      gl.viewport(0, 0, level.width, level.height);
      if (index === 0) {
        for (const target of [level.a, level.b]) {
          gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
          gl.clearColor(0.5, 0.5, 0, 1);
          gl.clear(gl.COLOR_BUFFER_BIT);
        }
      } else {
        gl.useProgram(this.copyProgram);
        gl.uniform2f(this.copyUniforms.uDstTexel, level.texel[0], level.texel[1]);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.levels[index - 1].a.texture);
        gl.bindFramebuffer(gl.FRAMEBUFFER, level.a.framebuffer);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.bindFramebuffer(gl.FRAMEBUFFER, level.b.framebuffer);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.useProgram(this.hsProgram);
      }
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, first.texture);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, second.texture);
      gl.uniform2f(this.hsUniforms.uTexel, level.texel[0], level.texel[1]);
      for (let iteration = 0; iteration < LEVEL_ITERATIONS[index]; iteration += 1) {
        const source = iteration % 2 === 0 ? level.a : level.b;
        const target = iteration % 2 === 0 ? level.b : level.a;
        gl.activeTexture(gl.TEXTURE2);
        gl.bindTexture(gl.TEXTURE_2D, source.texture);
        gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
    });
    const last = this.levels[this.levels.length - 1];
    const finalTarget = LEVEL_ITERATIONS[LEVEL_ITERATIONS.length - 1] % 2 === 0 ? last.a : last.b;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.flowCache.set(key, finalTarget.texture);
    return finalTarget.texture;
  }

  render(frame: TransitionFrame): void {
    const options = frame.options as FlowMorphOptions;
    const gl = this.gl;
    const oldTexture = this.textures[this.fromIndex];
    const newTexture = this.textures[this.toIndex];
    const flow = this.computeFlow(options.alpha ?? 0.3);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.width, this.height);
    gl.bindVertexArray(this.vao);
    gl.useProgram(this.renderProgram);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, oldTexture.texture);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, newTexture.texture);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, flow || this.neutralFlow);
    gl.uniform2f(this.drawUniforms.uViewport, this.width, this.height);
    gl.uniform2f(this.drawUniforms.uOldSize, oldTexture.width, oldTexture.height);
    gl.uniform2f(this.drawUniforms.uNewSize, newTexture.width, newTexture.height);
    gl.uniform1f(this.drawUniforms.uProgress, frame.progress);
    gl.uniform1f(this.drawUniforms.uCover, options.imageFit === 'cover' ? 1 : 0);
    gl.uniform1f(this.drawUniforms.uStrength, options.strength ?? 1);
    gl.uniform1f(this.drawUniforms.uFlowBias, options.flowBias ?? 0.8);
    gl.uniform1f(this.drawUniforms.uAberration, options.aberration ?? 0.25);
    gl.uniform1f(this.drawUniforms.uDebug, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  destroy(): void {
    this.textures.forEach(({ texture }) => this.gl.deleteTexture(texture));
    this.levelCache.forEach(({ texture }) => this.gl.deleteTexture(texture));
    this.clearLevels();
    this.gl.deleteTexture(this.neutralFlow);
    if (this.vao) this.gl.deleteVertexArray(this.vao);
    this.gl.deleteProgram(this.hsProgram);
    this.gl.deleteProgram(this.copyProgram);
    this.gl.deleteProgram(this.renderProgram);
    this.canvas.remove();
  }
}

export const flowMorphTransition = defineTransition({
  name: 'flow-morph',
  backend: 'webgl2',
  defaults: {
    strength: 1,
    alpha: 0.3,
    flowBias: 0.8,
    aberration: 0.25,
    imageFit: 'cover',
  },
  phaseEasing: 'none',
  supported: () => typeof WebGL2RenderingContext !== 'undefined',
  create: () => new FlowMorphEffect(),
});
