import type { VaryloomImageFit } from '../types';
import { createDemoShaderTransition } from './webgl2-demo-effect';
import { resolveAxis, type AxisDirection } from './webgl2-utils';

export interface DarkroomDevelopOptions {
  softness?: number;
  safelight?: number;
  grain?: number;
  sheen?: number;
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
uniform float uSoftness;
uniform float uSafelight;
uniform float uGrain;
uniform float uSheen;
uniform float uCover;
uniform vec2 uSweep;
uniform float uDebug;
uniform float uTime;

out vec4 outColor;

const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
const vec3 BACKDROP = vec3(0.020, 0.010, 0.008);
const vec3 SAFE_TINT = vec3(1.0, 0.18, 0.15);

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

vec4 sampleFitted(sampler2D tex, vec2 size, vec2 uv) {
  vec2 f = fitUV(uv, size);
  if (f.x < 0.0 || f.x > 1.0 || f.y < 0.0 || f.y > 1.0) return vec4(BACKDROP, 0.0);
  return vec4(texture(tex, f).rgb, 1.0);
}

void main() {
  vec2 uv = gl_FragCoord.xy / uViewport;
  float p = clamp(uProgress, 0.0, 1.0);
  float sweep = clamp(dot(uv - 0.5, uSweep) + 0.5, 0.0, 1.0);

  vec4 newS = sampleFitted(uNew, uNewSize, uv);
  vec4 oldS = sampleFitted(uOld, uOldSize, uv);

  float lumaNew = dot(newS.rgb, LUMA);
  float wobble = (valueNoise(uv * vec2(5.0, 7.0) + vec2(2.0, 5.0)) - 0.5)
    + (valueNoise(uv * vec2(11.0, 14.0) + vec2(7.0, 1.0)) - 0.5) * 0.5;

  // 显影顺序：暗部先析出（相纸特性），叠加方向扫描与药液波动
  float soft = clamp(uSoftness, 0.05, 0.2);
  float ordered = clamp(mix(lumaNew, sweep, 0.55) + wobble * 0.16, 0.0, 1.0);
  float tDev = 0.08 + (0.78 - soft) * ordered;
  float dev = smoothstep(tDev, tDev + soft, p);

  // 弯月面前沿：恰在显影阈值处最亮
  float front = exp(-pow((p - tDev) / (soft * 0.55), 2.0));

  // 银盐影像 -> 定影后色彩归位
  float bw = dot(newS.rgb, LUMA);
  float silver = pow(clamp(bw, 0.0, 1.0), 0.85);
  float colorIn = smoothstep(0.84, 0.97, p);
  vec3 devCol = mix(vec3(silver), newS.rgb, colorIn);

  // 银盐颗粒：中间调最明显，定影后消失
  float grainAmp = uGrain * 0.10 * (1.0 - abs(silver * 2.0 - 1.0)) * (1.0 - colorIn);
  devCol += (hash21(gl_FragCoord.xy * 0.987 + fract(uTime * 0.31) * vec2(157.3, 113.9)) - 0.5) * grainAmp;

  // 水洗条纹只在定影中段轻扫，收尾前完全退去（保证端点纯净）
  float wash = smoothstep(0.62, 0.82, p) * (1.0 - smoothstep(0.88, 0.97, p));
  devCol *= 1.0 + 0.02 * sin(gl_FragCoord.y * 1.4 - uTime * 5.0) * wash;

  // 旧图：安全灯下的红调残影，随显影到达而退场
  float ghost = smoothstep(0.02, 0.14, p) * (1.0 - dev) * oldS.a;
  vec3 oldCol = mix(oldS.rgb, oldS.rgb * SAFE_TINT + vec3(0.06, 0.0, 0.0), uSafelight * ghost);

  vec3 col = BACKDROP;
  col = mix(col, oldCol, oldS.a);
  col = mix(col, devCol, dev * newS.a);

  // 前沿光泽与湿边压暗
  float wet = max(newS.a, oldS.a);
  col += vec3(1.0, 0.86, 0.72) * front * uSheen * 0.28 * wet;
  col *= 1.0 - front * uSheen * 0.10 * wet;

  if (uDebug > 0.5) {
    vec3 field = vec3(ordered);
    field = mix(field, vec3(1.0, 0.55, 0.25), front * 0.85);
    field = mix(field, vec3(0.3, 0.75, 1.0), dev * 0.35);
    outColor = vec4(field, 1.0);
    return;
  }

  outColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;

export const darkroomDevelopTransition = createDemoShaderTransition({
  name: 'darkroom-develop',
  fragmentShader,
  defaults: { softness: 0.11, safelight: 0.65, grain: 0.5, sheen: 0.6, direction: 'auto', imageFit: 'cover' },
  uniforms: ['uSoftness', 'uSafelight', 'uGrain', 'uSheen', 'uSweep'],
  renderUniforms: ({ gl, locations, frame }) => {
    const options = frame.options as DarkroomDevelopOptions;
    const axis = resolveAxis(options.direction, frame.direction);
    gl.uniform1f(locations.uSoftness, options.softness ?? 0.11);
    gl.uniform1f(locations.uSafelight, options.safelight ?? 0.65);
    gl.uniform1f(locations.uGrain, options.grain ?? 0.5);
    gl.uniform1f(locations.uSheen, options.sheen ?? 0.6);
    gl.uniform2f(locations.uSweep, axis[0], axis[1]);
  },
});
