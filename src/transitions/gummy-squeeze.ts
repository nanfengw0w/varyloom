import type { VaryloomImageFit } from '../types';
import { createDemoShaderTransition } from './webgl2-demo-effect';

export interface GummySqueezeOptions { imageFit?: VaryloomImageFit; }

const fragmentShader = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uOld;
uniform sampler2D uNew;
uniform vec2 uOldSize;
uniform vec2 uNewSize;
uniform vec2 uViewport;
uniform float uProgress;
uniform float uCover;

vec3 photo(sampler2D picture, vec2 imageSize, vec2 uv) {
  float viewAspect = uViewport.x / max(uViewport.y, 1.0);
  float imageAspect = imageSize.x / max(imageSize.y, 1.0);
  vec2 q = uv;
  if (uCover > 0.5) {
    if (imageAspect > viewAspect) q.x = (uv.x - 0.5) * viewAspect / imageAspect + 0.5;
    else q.y = (uv.y - 0.5) * imageAspect / viewAspect + 0.5;
  } else {
    if (imageAspect > viewAspect) q.y = (uv.y - 0.5) * imageAspect / viewAspect + 0.5;
    else q.x = (uv.x - 0.5) * viewAspect / imageAspect + 0.5;
    if (q.x < 0.0 || q.x > 1.0 || q.y < 0.0 || q.y > 1.0) return vec3(0.933, 0.914, 0.878);
  }
  return texture(picture, clamp(q, 0.0, 1.0)).rgb;
}

void main() {
  vec2 uv = vUv;
  float p = clamp(uProgress, 0.0, 1.0);
  if (p <= 0.00001) { outColor = vec4(photo(uOld, uOldSize, uv), 1.0); return; }
  if (p >= 0.99999) { outColor = vec4(photo(uNew, uNewSize, uv), 1.0); return; }
  vec2 c = uv - 0.5;
  float breath = sin(p * 3.14159265);
  float radius = 1.58 * pow(1.0 - p, 1.22);
  radius *= 1.0 + 0.025 * sin(p * 16.0) * breath;
  float n = mix(8.0, 2.55, smoothstep(0.05, 0.78, p));
  float angle = atan(c.y, c.x);
  float waviness = (0.035 * sin(angle * 5.0 + p * 9.0) + 0.012 * sin(angle * 9.0 - p * 6.0)) * breath;
  vec2 q = abs(c * 2.0) / max(radius + waviness, 0.003);
  float signedEdge = pow(q.x, n) + pow(q.y, n) - 1.0;
  float oldMask = 1.0 - smoothstep(-0.045, 0.045, signedEdge);
  vec2 fold = c * (1.0 + 0.055 * breath * sin(angle * 4.0));
  vec2 oldUv = mix(uv, 0.5 + fold / max(radius, 0.07), smoothstep(0.03, 0.5, p));
  oldUv = clamp(oldUv, 0.0, 1.0);
  float rimInfluence = exp(-abs(signedEdge) * 6.5) * breath;
  vec2 newUv = clamp(0.5 + c * (1.0 + 0.15 * rimInfluence), 0.0, 1.0);
  vec3 under = photo(uNew, uNewSize, newUv);
  float shadow = exp(-max(signedEdge, 0.0) * 11.0) * (1.0 - oldMask) * breath;
  under *= 1.0 - shadow * 0.21;
  vec3 oldColor = photo(uOld, uOldSize, oldUv);
  oldColor += vec3(0.056, 0.032, 0.017) * rimInfluence * oldMask;
  outColor = vec4(mix(under, oldColor, oldMask), 1.0);
}`;

export const gummySqueezeTransition = createDemoShaderTransition({
  name: 'gummy-squeeze', fragmentShader, defaults: { imageFit: 'contain' },
  uniforms: [], renderUniforms: () => undefined,
});
