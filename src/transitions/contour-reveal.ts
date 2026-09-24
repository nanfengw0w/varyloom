import type { VaryloomImageFit } from '../types';
import { createDemoShaderTransition } from './webgl2-demo-effect';
import { resolveAxis, type AxisDirection } from './webgl2-utils';

export interface ContourRevealOptions {
  levels?: number;
  lineInk?: number;
  relief?: number;
  fillLag?: number;
  directionBias?: number;
  direction?: AxisDirection;
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
uniform float uLevels;
uniform float uLineInk;
uniform float uRelief;
uniform float uFillLag;
uniform float uCover;
uniform vec2 uSweep;
uniform float uDirBias;
uniform float uDebug;
uniform float uTime;

out vec4 outColor;

const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
const vec3 BACKDROP = vec3(0.024, 0.040, 0.056);
const vec3 LINE_BASE = vec3(0.78, 0.66, 0.42);
const vec3 LINE_FRONT = vec3(1.0, 0.88, 0.58);
const vec3 LINE_GHOST = vec3(0.48, 0.56, 0.64);
const vec3 LIGHT_DIR = vec3(-0.48, 0.60, 0.64);

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

bool inside(vec2 f) {
  return f.x >= 0.0 && f.x <= 1.0 && f.y >= 0.0 && f.y <= 1.0;
}

vec4 sampleFitted(sampler2D tex, vec2 size, vec2 uv) {
  vec2 f = fitUV(uv, size);
  if (!inside(f)) return vec4(BACKDROP, 0.0);
  return vec4(texture(tex, f).rgb, 1.0);
}

// 平滑亮度 + 视口空间的梯度：vec4(luma, dLuma/dViewU.x, dLuma/dViewU.y)
// 梯度由近/远两组差分混合，抑制高频图上的逐像素噪点
vec4 lumaField(sampler2D tex, vec2 size, vec2 uv) {
  vec2 f = fitUV(uv, size);
  if (!inside(f)) return vec4(0.5, 0.0, 0.0, 0.0);
  vec2 px = 1.8 / size;
  vec2 px2 = 3.0 / size;
  float c = dot(texture(tex, f).rgb, LUMA);
  float l = dot(texture(tex, f - vec2(px.x, 0.0)).rgb, LUMA);
  float r = dot(texture(tex, f + vec2(px.x, 0.0)).rgb, LUMA);
  float b = dot(texture(tex, f - vec2(0.0, px.y)).rgb, LUMA);
  float t = dot(texture(tex, f + vec2(0.0, px.y)).rgb, LUMA);
  float s = (2.0 * c + l + r + b + t) * (1.0 / 6.0);
  float l2 = dot(texture(tex, f - vec2(px2.x, 0.0)).rgb, LUMA);
  float r2 = dot(texture(tex, f + vec2(px2.x, 0.0)).rgb, LUMA);
  float b2 = dot(texture(tex, f - vec2(0.0, px2.y)).rgb, LUMA);
  float t2 = dot(texture(tex, f + vec2(0.0, px2.y)).rgb, LUMA);
  vec2 gradImage = mix(
    vec2(r - l, t - b) / (2.0 * px),
    vec2(r2 - l2, t2 - b2) / (2.0 * px2),
    0.5);
  float kScale = dot(abs(fitScale(size)), vec2(0.5));
  return vec4(s, gradImage * kScale, 0.0);
}

// 某条等高线（亮度层级索引 k）的出现时刻与绘制前沿
float appearTime(float k, float sweep, float bias) {
  float order = clamp(k, 0.0, uLevels) / uLevels;
  return 0.06 + 0.66 * clamp(mix(order, sweep, bias), 0.0, 1.0);
}

void main() {
  vec2 uv = gl_FragCoord.xy / uViewport;
  float p = clamp(uProgress, 0.0, 1.0);
  float sweep = clamp(dot(uv - 0.5, uSweep) + 0.5, 0.0, 1.0);

  vec4 newF = lumaField(uNew, uNewSize, uv);
  vec4 oldF = lumaField(uOld, uOldSize, uv);
  vec4 newS = sampleFitted(uNew, uNewSize, uv);
  vec4 oldS = sampleFitted(uOld, uOldSize, uv);

  float newLuma = newF.x;
  vec2 newGrad = newF.yz;
  float gradMag = length(newGrad);

  // ---- 新图等高线：以亮度层级索引追踪上下两条边界线
  float v = newLuma * uLevels;
  float below = floor(v - 1e-4);
  float dA = v - below;
  float dB = (below + 1.0) - v;

  float ta = appearTime(below, sweep, uDirBias)
    + (hash21(vec2(below, 17.17)) - 0.5) * 0.05;
  float tb = appearTime(below + 1.0, sweep, uDirBias)
    + (hash21(vec2(below + 1.0, 17.17)) - 0.5) * 0.05;

  float aA = smoothstep(ta, ta + 0.07, p);
  float aB = smoothstep(tb, tb + 0.07, p);
  float headA = aA * (1.0 - smoothstep(ta + 0.07, ta + 0.16, p));
  float headB = aB * (1.0 - smoothstep(tb + 0.07, tb + 0.16, p));

  // 线宽换算：世界等宽 -> 层级单位；平缓区域自动无线，避免摩尔纹
  float wl = 0.0042 * gradMag * uLevels;
  float fw = fwidth(v) * 1.25 + 1e-4;
  float lA = (1.0 - smoothstep(wl - fw, wl + fw, dA)) * aA;
  float lB = (1.0 - smoothstep(wl - fw, wl + fw, dB)) * aB;
  float line = max(lA, lB);
  float head = max(headA * lA, headB * lB);

  // ---- 新图浮雕光照（由亮度梯度构造法线）
  vec3 nrm = normalize(vec3(-newGrad * uRelief * 5.0, 1.0));
  float shade = clamp(dot(nrm, LIGHT_DIR), 0.0, 1.0);

  // ---- 时间轴：测绘面到达 -> 等高线 -> 填色 -> 收平
  float ordPix = clamp((below + 1.0) / uLevels, 0.0, 1.0);
  float ordered = mix(ordPix, sweep, uDirBias);
  float tMap = 0.05 + 0.60 * ordered;
  float mapIn = smoothstep(tMap - 0.04, tMap + 0.07, p);

  float lag = clamp(uFillLag, 0.0, 0.18);
  float tFill = 0.06 + lag + (0.74 - lag) * ordered;
  float fill = smoothstep(tFill - 0.05, tFill + 0.10, p);

  float reliefFade = 1.0 - smoothstep(0.84, 0.97, p);
  float lineFade = 1.0 - smoothstep(0.86, 0.97, p);

  // ---- 旧图沉入墨蓝夜色，短暂保留自己的淡等高线
  vec3 nrmO = normalize(vec3(-oldF.yz * uRelief * 5.0, 1.0));
  float shadeO = clamp(dot(nrmO, LIGHT_DIR), 0.0, 1.0);
  float sink = smoothstep(0.02, 0.22, p) * oldS.a;
  float vO = oldF.x * uLevels;
  float belowO = floor(vO - 1e-4);
  float dOA = vO - belowO;
  float wlO = 0.0042 * length(oldF.yz) * uLevels;
  float fwO = fwidth(vO) * 1.25 + 1e-4;
  float lineO = (1.0 - smoothstep(wlO - fwO, wlO + fwO, dOA)) * sink;

  float oldLuma = dot(oldS.rgb, LUMA);
  vec3 oldInk = mix(vec3(oldLuma), oldS.rgb, 0.30) * vec3(0.50, 0.58, 0.70);
  oldInk *= 0.78 + 0.38 * shadeO;
  vec3 oldCol = mix(oldS.rgb, oldInk, sink);
  oldCol = mix(oldCol, LINE_GHOST, clamp(lineO * uLineInk * 0.55, 0.0, 1.0));

  // ---- 新图图层：墨面地形 -> 填色漫过 -> 收平为纯图，金线随行
  vec3 terrain = vec3(0.045, 0.068, 0.090) * (0.75 + 0.55 * shade);
  vec3 filled = newS.rgb * (0.78 + 0.34 * shade);
  vec3 newLayer = mix(terrain, filled, fill);
  newLayer = mix(newLayer, newS.rgb, 1.0 - reliefFade);
  vec3 inkCol = mix(LINE_BASE, LINE_FRONT, head);
  float inkOnFilled = mix(1.0, 0.55, fill);
  newLayer = mix(newLayer, inkCol, clamp(line * uLineInk * lineFade * inkOnFilled, 0.0, 1.0));
  // 填色前沿的暖光
  float bell = p * (1.0 - p) * 4.0;
  float fillEdge = exp(-pow((p - tFill) / 0.06, 2.0)) * bell;
  newLayer += vec3(1.0, 0.86, 0.62) * fillEdge * 0.10 * newS.a;

  vec3 col = BACKDROP;
  col = mix(col, oldCol, oldS.a);
  col = mix(col, newLayer, mapIn * newS.a);

  // 颗粒只在转场中段出现（钟形收窄，端点更干净）
  col += (hash21(gl_FragCoord.xy * 0.987 + fract(uTime * 0.37) * vec2(157.3, 113.9)) - 0.5)
    * 0.022 * bell * bell;

  if (uDebug > 0.5) {
    vec3 field = vec3(ordered);
    field = mix(field, vec3(1.0, 0.72, 0.22), clamp(line * 0.9 + head, 0.0, 1.0));
    field = mix(field, vec3(0.22, 0.62, 1.0), fill * 0.4);
    field = mix(field, vec3(0.9), mapIn * 0.12);
    outColor = vec4(field, 1.0);
    return;
  }

  outColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;

export const contourRevealTransition = createDemoShaderTransition({
  name: 'contour-reveal',
  fragmentShader,
  defaults: { levels: 9, lineInk: 0.85, relief: 0.55, fillLag: 0.12, directionBias: 0.35, direction: 'auto', imageFit: 'cover' },
  uniforms: ['uLevels', 'uLineInk', 'uRelief', 'uFillLag', 'uSweep', 'uDirBias'],
  renderUniforms: ({ gl, locations, frame }) => {
    const options = frame.options as ContourRevealOptions;
    const axis = resolveAxis(options.direction, frame.direction);
    gl.uniform1f(locations.uLevels, options.levels ?? 9);
    gl.uniform1f(locations.uLineInk, options.lineInk ?? 0.85);
    gl.uniform1f(locations.uRelief, options.relief ?? 0.55);
    gl.uniform1f(locations.uFillLag, options.fillLag ?? 0.12);
    gl.uniform2f(locations.uSweep, axis[0], axis[1]);
    gl.uniform1f(locations.uDirBias, options.directionBias ?? 0.35);
  },
});
