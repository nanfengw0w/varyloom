import type { VaryloomImageFit } from '../types';
import { createDemoShaderTransition } from './webgl2-demo-effect';
import { resolveAxis, type AxisDirection } from './webgl2-utils';

export interface LenticularShiftOptions {
  lensCount?: number;
  refraction?: number;
  glint?: number;
  sheetSoftness?: number;
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
uniform float uLensCount;
uniform float uRefraction;
uniform float uGlint;
uniform float uSheetSoft;
uniform float uCover;
uniform vec2 uSweep;
uniform float uFlipSign;
uniform float uDebug;
uniform float uTime;

out vec4 outColor;

const vec3 BACKDROP = vec3(0.014, 0.018, 0.030);

float hash11(float p) {
  return fract(sin(p * 127.113) * 43758.5453123);
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
  float sweep = dot(uv - 0.5, uSweep) + 0.5;

  // 柱镜脊线（屏幕固定，带轻微倾角）
  float tilt = 0.10;
  float lensCoord = (uv.x + uv.y * tilt) * uLensCount;
  float ridgeIndex = floor(lensCoord);
  float uL = fract(lensCoord);
  float r = uL * 2.0 - 1.0;

  float soft = uSheetSoft;
  // 光栅片中心自一侧推向另一侧（方向归一后总是 1 -> -soft）；片外一侧纯旧图、另一侧纯新图
  float centered = (sweep - 0.5) * uFlipSign + 0.5; // 方向归一：片总是沿 centered 从 1 -> 0
  float front = mix(1.0 + soft + 0.15, -soft - 0.15, p);
  float flipBase = smoothstep(front - soft, front + soft, centered);

  float distToSheet = abs(centered - front);
  float inSheet = 1.0 - smoothstep(soft * 0.85, soft * 1.3, distToSheet);

  // 片内：每条柱镜带随机相位先后翻面
  float jitter = (hash11(ridgeIndex + 7.7) - 0.5) * soft * 0.9;
  float flipRidge = smoothstep(front - soft + jitter, front + soft + jitter, centered);
  float flip = mix(flipBase, flipRidge, inSheet);

  // 折射：柱镜剖面的平方偏移，新旧图朝相反方向折
  float bend = r * r * uRefraction * 0.014 * inSheet;
  vec2 offScreen = normalize(vec2(uSweep.x + uSweep.y * tilt, uSweep.y - uSweep.x * tilt) + vec2(1e-5));
  vec2 off = offScreen * bend;

  vec3 oldC = sampleFitted(uOld, uOldSize, fitUV(uv + off * (1.0 - flip), uOldSize));
  vec3 newC = sampleFitted(uNew, uNewSize, fitUV(uv - off * flip, uNewSize));
  vec3 col = mix(oldC, newC, flip);

  // 翻面瞬间脊线中心的闪光
  float g = exp(-pow((flipRidge - 0.5) / 0.22, 2.0)) * exp(-r * r * 2.6) * inSheet;
  col += vec3(1.0, 0.98, 0.92) * g * uGlint * 0.5;

  // 柱镜表面明暗（sqrt 剖面），只在片覆盖且转场中段可见
  float bell = p * (1.0 - p) * 4.0;
  float cyl = sqrt(max(0.0, 1.0 - r * r * 0.88));
  col *= mix(1.0, 0.55 + 0.6 * cyl, inSheet * 0.4 * (0.35 + 0.65 * bell));

  if (uDebug > 0.5) {
    vec3 field = vec3(fract(lensCoord) * 0.22 + 0.08);
    field = mix(field, vec3(0.2, 0.9, 0.5), flip * 0.7);
    field = mix(field, vec3(1.0, 0.85, 0.3), g);
    field = mix(field, vec3(0.4, 0.6, 1.0), inSheet * 0.25);
    outColor = vec4(field, 1.0);
    return;
  }

  outColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;

export const lenticularShiftTransition = createDemoShaderTransition({
  name: 'lenticular-shift',
  fragmentShader,
  defaults: { lensCount: 42, refraction: 0.55, glint: 0.7, sheetSoftness: 0.22, direction: 'auto', imageFit: 'cover' },
  uniforms: ['uLensCount', 'uRefraction', 'uGlint', 'uSheetSoft', 'uSweep', 'uFlipSign'],
  renderUniforms: ({ gl, locations, frame }) => {
    const options = frame.options as LenticularShiftOptions;
    const axis = resolveAxis(options.direction, frame.direction);
    gl.uniform1f(locations.uLensCount, options.lensCount ?? 42);
    gl.uniform1f(locations.uRefraction, options.refraction ?? 0.55);
    gl.uniform1f(locations.uGlint, options.glint ?? 0.7);
    gl.uniform1f(locations.uSheetSoft, options.sheetSoftness ?? 0.22);
    gl.uniform2f(locations.uSweep, axis[0], axis[1]);
    gl.uniform1f(locations.uFlipSign, axis[0] < 0 ? -1 : 1);
  },
});
