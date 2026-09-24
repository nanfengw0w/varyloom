import type { VaryloomImageFit } from '../types';
import { createDemoShaderTransition } from './webgl2-demo-effect';
import { resolveAxis, type AxisDirection } from './webgl2-utils';

export interface HoloFoilOptions {
  foilWidth?: number;
  filmDensity?: number;
  glitter?: number;
  refraction?: number;
  edgeLight?: number;
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
uniform float uFoilWidth;
uniform float uFilmDensity;
uniform float uGlitter;
uniform float uRefraction;
uniform float uEdgeLight;
uniform float uCover;
uniform vec2 uSweep;
uniform float uFlipSign;
uniform float uDebug;
uniform float uTime;

out vec4 outColor;

const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
const vec3 BACKDROP = vec3(0.020, 0.014, 0.028);

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
  float sweep = dot(uv - 0.5, uSweep) + 0.5;
  float centered = (sweep - 0.5) * uFlipSign + 0.5;

  float W = uFoilWidth;
  // 箔带中心自一侧推向另一侧；带前是旧图，压过之后是新图
  float front = mix(1.0 + W + 0.12, -W - 0.12, p);
  float d = centered - front;
  float a = 1.0 - smoothstep(W * 0.8, W, abs(d));
  float mf = 1.0 - smoothstep(-W * 0.65, W * 0.65, d); // 带内交接：拖尾侧出新图
  float globalMix = smoothstep(front - W * 0.2, front + W * 0.2, centered);
  float mixK = mix(globalMix, mf, a);

  // 箔面微法线（两层正弦涟漪），带来折射与光谱游动
  float n1 = sin(uv.x * 90.0 + uTime * 0.9) * sin(uv.y * 76.0 - uTime * 0.7);
  float n2 = valueNoise(uv * 14.0 + uTime * 0.06) - 0.5;
  vec2 microN = vec2(n1 + n2 * 2.0, n1 * 0.8 - n2 * 1.6);
  vec2 refr = microN * uRefraction * 0.005 * a;

  vec3 oldC = sampleFitted(uOld, uOldSize, fitUV(uv + refr * (1.0 - mixK), uOldSize));
  vec3 newC = sampleFitted(uNew, uNewSize, fitUV(uv - refr * mixK, uNewSize));
  vec3 base = mix(oldC, newC, mixK);

  // 薄膜干涉：解析余弦光谱，相位由箔内位置 + 涟漪 + 新图亮度共同驱动
  float lumaNew = dot(newC, LUMA);
  float phase = (d / W) * uFilmDensity + n2 * 4.0 + lumaNew * uGlitter * 5.0 + uTime * 0.2;
  vec3 film = 0.5 + 0.5 * cos(6.28318 * (phase * vec3(1.0, 0.81, 0.64) + vec3(0.0, 0.33, 0.67)));

  // 光谱强度：交接处最盛，带缘仍保留一层淡虹；整体只在箔带存在时可见
  float bell = p * (1.0 - p) * 4.0;
  float irid = a * (mf * (1.0 - mf) * 2.6 + 0.22) * (0.35 + 0.65 * bell);
  vec3 foil = base * (0.66 + 0.5 * lumaNew) + film * irid * 0.5;

  vec3 col = mix(base, foil, a);

  // 箔缘亮线
  float edge = exp(-pow((abs(d) - W * 0.88) / (W * 0.10), 2.0)) * a;
  col += vec3(1.0, 0.97, 0.9) * edge * uEdgeLight * 0.35;

  if (uDebug > 0.5) {
    vec3 field = film * a;
    field = mix(field, vec3(0.2, 0.2, 0.25), 1.0 - a);
    field = mix(field, vec3(1.0, 0.4, 0.2), abs(mf - 0.5) * 0.0);
    field += vec3(1.0) * edge * 0.5;
    outColor = vec4(field, 1.0);
    return;
  }

  outColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;

export const holoFoilTransition = createDemoShaderTransition({
  name: 'holo-foil',
  fragmentShader,
  defaults: { foilWidth: 0.16, filmDensity: 7, glitter: 0.55, refraction: 0.4, edgeLight: 0.6, direction: 'auto', imageFit: 'cover' },
  uniforms: ['uFoilWidth', 'uFilmDensity', 'uGlitter', 'uRefraction', 'uEdgeLight', 'uSweep', 'uFlipSign'],
  renderUniforms: ({ gl, locations, frame }) => {
    const options = frame.options as HoloFoilOptions;
    const axis = resolveAxis(options.direction, frame.direction);
    gl.uniform1f(locations.uFoilWidth, options.foilWidth ?? 0.16);
    gl.uniform1f(locations.uFilmDensity, options.filmDensity ?? 7);
    gl.uniform1f(locations.uGlitter, options.glitter ?? 0.55);
    gl.uniform1f(locations.uRefraction, options.refraction ?? 0.4);
    gl.uniform1f(locations.uEdgeLight, options.edgeLight ?? 0.6);
    gl.uniform2f(locations.uSweep, axis[0], axis[1]);
    gl.uniform1f(locations.uFlipSign, axis[0] < 0 ? -1 : 1);
  },
});
