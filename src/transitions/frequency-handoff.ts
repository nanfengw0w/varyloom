import type { VaryloomImageFit } from '../types';
import { createDemoShaderTransition } from './webgl2-demo-effect';

export interface FrequencyHandoffOptions {
  stagger?: number;
  order?: 'coarse-first' | 'fine-first';
  bloom?: number;
  grain?: number;
  dispersion?: number;
  imageFit?: VaryloomImageFit;
}

const fragmentShader = `#version 300 es
precision highp float;

uniform sampler2D uOld;
uniform sampler2D uNew;
uniform vec2 uViewport;
uniform vec2 uOldSize;
uniform vec2 uNewSize;
uniform float uProgress;
uniform float uCover;
uniform float uStagger;
uniform float uOrder;
uniform float uBloom;
uniform float uGrain;
uniform float uDispersion;
uniform float uDebug;
uniform float uTime;

out vec4 outColor;

const vec3 BACKDROP = vec3(0.018, 0.026, 0.030);

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

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

vec3 sampleFitted(sampler2D tex, vec2 size, vec2 f) {
  if (f.x < 0.0 || f.x > 1.0 || f.y < 0.0 || f.y > 1.0) return BACKDROP;
  return texture(tex, f).rgb;
}

// 屏幕像素密度缩放，让模糊半径在不同分辨率下观感一致
float pxScale() {
  return clamp(uViewport.y / 760.0, 0.55, 2.4);
}

// 黄金角螺旋多 tap 近似高斯：中心 1.4 权重 + 8 个螺旋 tap
vec3 blurFitted(sampler2D tex, vec2 size, vec2 uv, float radiusPx) {
  vec2 base = fitUV(uv, size);
  vec3 sum = BACKDROP * 0.9;
  for (int i = 1; i <= 8; i++) {
    float ang = float(i) * 2.39996323;
    float rr = sqrt(float(i) / 8.0) * radiusPx;
    vec2 off = vec2(cos(ang), sin(ang)) * rr / size;
    sum += sampleFitted(tex, size, base + off);
  }
  sum += sampleFitted(tex, size, base) * 1.4;
  return sum / 10.3;
}

// 输出未差分的金字塔：sharp 与三级模糊
void pyramid(sampler2D tex, vec2 size, vec2 uv, out vec3 sharp, out vec3 c1, out vec3 c2, out vec3 c3) {
  float s = pxScale();
  sharp = sampleFitted(tex, size, fitUV(uv, size));
  c1 = blurFitted(tex, size, uv, 2.5 * s);
  c2 = blurFitted(tex, size, uv, 8.0 * s);
  c3 = blurFitted(tex, size, uv, 21.0 * s);
}

void main() {
  vec2 uv = gl_FragCoord.xy / uViewport;
  float p = clamp(uProgress, 0.0, 1.0);

  vec3 oSharp, oC1, oC2, oC3;
  pyramid(uOld, uOldSize, uv, oSharp, oC1, oC2, oC3);
  vec3 nSharp, nC1, nC2, nC3;
  pyramid(uNew, uNewSize, uv, nSharp, nC1, nC2, nC3);

  // 细节频段到达时的径向色散（只作用于新图 sharp 分量）
  vec4 coarseMid = vec4(0.30, 0.44, 0.58, 0.72); // 交接中点：b3, b2, b1, b0
  vec4 fineMid = vec4(0.72, 0.58, 0.44, 0.30);
  vec4 mid = mix(coarseMid, fineMid, uOrder);
  float w = mix(0.20, 0.085, uStagger);
  vec4 win = vec4(
    smoothstep(mid.x - w, mid.x + w, p),
    smoothstep(mid.y - w, mid.y + w, p),
    smoothstep(mid.z - w, mid.z + w, p),
    smoothstep(mid.w - w, mid.w + w, p));

  if (uDispersion > 0.001) {
    float edge0 = win.w * (1.0 - win.w) * 4.0;
    if (edge0 > 0.001) {
      vec2 f = fitUV(uv, uNewSize);
      vec2 dirv = normalize(uv - 0.5 + vec2(1e-5));
      float amt = uDispersion * edge0 * 2.0 * pxScale();
      vec3 dispersed;
      dispersed.r = sampleFitted(uNew, uNewSize, f + dirv * amt / uNewSize).r;
      dispersed.g = nSharp.g;
      dispersed.b = sampleFitted(uNew, uNewSize, f - dirv * amt / uNewSize).b;
      nSharp = dispersed;
    }
  }

  vec3 n3 = nC3;
  vec3 n2 = nC2 - nC3;
  vec3 n1 = nC1 - nC2;
  vec3 n0 = nSharp - nC1;
  vec3 o3 = oC3;
  vec3 o2 = oC2 - oC3;
  vec3 o1 = oC1 - oC2;
  vec3 o0 = oSharp - oC1;

  vec3 col = mix(o3, n3, win.x)
    + mix(o2, n2, win.y)
    + mix(o1, n1, win.z)
    + mix(o0, n0, win.w);

  // 正在交接的频段给一点泛光，模拟"对焦中"的辉光
  vec4 edge = win * (1.0 - win) * 4.0;
  col += (n3 * edge.x + n2 * edge.y + n1 * edge.z + n0 * edge.w) * (uBloom * 0.5);

  // 曝光呼吸与软焦颗粒都只在转场中段出现
  col *= 1.0 + 0.045 * sin(3.14159 * p);
  float bell = p * (1.0 - p) * 4.0;
  col += (hash21(gl_FragCoord.xy * 0.987 + fract(uTime * 0.41) * vec2(157.3, 113.9)) - 0.5)
    * uGrain * 0.07 * bell;

  if (uDebug > 0.5) {
    // 四象限查看新图的四个频带：左下 b3 低频、右下 b1、左上 b2、右上 b0 细节
    vec2 q = step(vec2(0.5), uv);
    float qi = q.x + 2.0 * q.y;
    vec3 band;
    if (qi < 0.5) band = n3;
    else if (qi < 1.5) band = abs(n2);
    else if (qi < 2.5) band = abs(n1);
    else band = abs(n0);
    outColor = vec4(clamp(band * 1.7, 0.0, 1.0), 1.0);
    return;
  }

  outColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;

export const frequencyHandoffTransition = createDemoShaderTransition({
  name: 'frequency-handoff',
  fragmentShader,
  defaults: { stagger: 0.65, order: 'coarse-first', bloom: 0.45, grain: 0.4, dispersion: 0.5, imageFit: 'cover' },
  uniforms: ['uStagger', 'uOrder', 'uBloom', 'uGrain', 'uDispersion'],
  renderUniforms: ({ gl, locations, frame }) => {
    const options = frame.options as FrequencyHandoffOptions;
    gl.uniform1f(locations.uStagger, options.stagger ?? 0.65);
    gl.uniform1f(locations.uOrder, options.order === 'fine-first' ? 1 : 0);
    gl.uniform1f(locations.uBloom, options.bloom ?? 0.45);
    gl.uniform1f(locations.uGrain, options.grain ?? 0.4);
    gl.uniform1f(locations.uDispersion, options.dispersion ?? 0.5);
  },
});
