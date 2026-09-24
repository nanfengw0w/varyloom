import type { VaryloomImageFit } from '../types';
import { createDemoShaderTransition } from './webgl2-demo-effect';
import { resolveAxis, type AxisDirection } from './webgl2-utils';

export interface ImpastoStrokeOptions {
  bristles?: number;
  wetness?: number;
  gloss?: number;
  bead?: number;
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
uniform float uBristles;
uniform float uWetness;
uniform float uGloss;
uniform float uBead;
uniform float uCover;
uniform vec2 uDir;
uniform float uDebug;
uniform float uTime;

out vec4 outColor;

const vec3 BACKDROP = vec3(0.026, 0.018, 0.012);
const vec3 LIGHT = normalize(vec3(-0.42, 0.65, 0.63));

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

vec3 sampleFitted(sampler2D tex, vec2 size, vec2 f) {
  if (f.x < 0.0 || f.x > 1.0 || f.y < 0.0 || f.y > 1.0) return BACKDROP;
  return texture(tex, f).rgb;
}

void main() {
  vec2 uv = gl_FragCoord.xy / uViewport;
  float p = clamp(uProgress, 0.0, 1.0);

  vec2 dir = uDir;
  vec2 cross = vec2(-dir.y, dir.x);
  float s = dot(uv - 0.5, dir) + 0.5;
  float along = dot(uv - 0.5, cross);

  float W = 0.24;
  float P = mix(-W, 1.0 + 2.0 * W, p);

  // 覆盖度：前沿两侧平滑过渡
  float passed = 1.0 - smoothstep(P - 0.85 * W, P + 0.15 * W, s);
  float paintAge = P - s;
  // 湿度：随笔龄干燥；转场收尾全局强制干透，保证端点纯净
  float wet = (1.0 - smoothstep(0.22, 0.85, paintAge)) * passed
    * (1.0 - smoothstep(0.9, 0.99, p));

  // 新图颜料顺笔向拖带（湿度越高拖得越长），干燥后收平
  float smear = uWetness * wet * 0.045;
  vec2 fNew = fitUV(uv, uNewSize);
  vec3 paint = vec3(0.0);
  float w0 = 0.44, w1 = 0.32, w2 = 0.24;
  paint += sampleFitted(uNew, uNewSize, clamp(fNew, 0.0, 1.0)) * w0;
  paint += sampleFitted(uNew, uNewSize, clamp(fNew - dir * smear, 0.0, 1.0)) * w1;
  paint += sampleFitted(uNew, uNewSize, clamp(fNew - dir * smear * 2.1, 0.0, 1.0)) * w2;
  float newIn = (fNew.x >= 0.0 && fNew.x <= 1.0 && fNew.y >= 0.0 && fNew.y <= 1.0) ? 1.0 : 0.0;
  paint = mix(BACKDROP, paint, newIn);

  // 锋尖把旧图颜色卷起带进湿层
  vec2 fOld = fitUV(uv, uOldSize);
  vec3 oldC = sampleFitted(uOld, uOldSize, clamp(fOld, 0.0, 1.0));
  float oldIn = (fOld.x >= 0.0 && fOld.x <= 1.0 && fOld.y >= 0.0 && fOld.y <= 1.0) ? 1.0 : 0.0;
  oldC = mix(BACKDROP, oldC, oldIn);
  float oldShare = 1.0 - smoothstep(0.18, 0.62, passed);
  vec3 lifted = oldC * 1.08 + vec3(0.05, 0.03, 0.01);
  vec3 paintCol = mix(paint, lifted, oldShare);

  // 鬃毛棱线：沿笔向的条纹 + 噪声扰动，法线打光，只在湿区可见
  float wob = valueNoise(uv * vec2(9.0, 9.0)) * 2.2;
  float ridgePhase = along * uBristles + wob;
  float ridge = sin(ridgePhase);
  float ridgeD = cos(ridgePhase) * uBristles;
  vec3 nrm = normalize(vec3(cross * ridgeD * 0.0035, 1.0));
  float spec = pow(clamp(dot(nrm, LIGHT), 0.0, 1.0), 22.0);
  float shade = mix(1.0, 0.9 + 0.14 * ridge, wet);

  vec3 col = BACKDROP;
  col = mix(col, oldC, oldIn);

  // 湿层：颜料 + 棱线明暗 + 湿光
  vec3 wetPaint = paintCol * shade;
  wetPaint += vec3(1.0, 0.92, 0.78) * spec * uGloss * 0.85 * wet;
  // 锋缘积料：前沿处一道稍亮的厚料
  float beadPos = P - 0.55 * W;
  float beadRim = exp(-pow((s - beadPos) / (0.16 * W), 2.0)) * uBead * wet;
  wetPaint += vec3(1.0, 0.88, 0.7) * beadRim * 0.30;

  col = mix(col, wetPaint, passed);

  if (uDebug > 0.5) {
    vec3 field = vec3(passed * 0.4);
    field = mix(field, vec3(0.25, 0.7, 1.0), wet * 0.8);
    field += spec * 0.4;
    field = mix(field, vec3(1.0, 0.6, 0.2), beadRim);
    outColor = vec4(field, 1.0);
    return;
  }

  outColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;

export const impastoStrokeTransition = createDemoShaderTransition({
  name: 'impasto-stroke',
  fragmentShader,
  defaults: { bristles: 70, wetness: 0.65, gloss: 0.7, bead: 0.5, direction: 'auto', imageFit: 'cover' },
  uniforms: ['uBristles', 'uWetness', 'uGloss', 'uBead', 'uDir'],
  renderUniforms: ({ gl, locations, frame }) => {
    const options = frame.options as ImpastoStrokeOptions;
    const axis = resolveAxis(options.direction, frame.direction);
    gl.uniform1f(locations.uBristles, options.bristles ?? 70);
    gl.uniform1f(locations.uWetness, options.wetness ?? 0.65);
    gl.uniform1f(locations.uGloss, options.gloss ?? 0.7);
    gl.uniform1f(locations.uBead, options.bead ?? 0.5);
    gl.uniform2f(locations.uDir, axis[0], axis[1]);
  },
});
