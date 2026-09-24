import type { VaryloomImageFit } from '../types';
import { createDemoShaderTransition } from './webgl2-demo-effect';

export interface ZipperClothOptions { imageFit?: VaryloomImageFit; }

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
const float PI = 3.14159265359;
const vec3 MATTE = vec3(0.925, 0.884, 0.850);
float ease(float t) { return t * t * (3.0 - 2.0 * t); }

float seamAt(float y, float p) {
  float oldAspect = uOldSize.x / max(uOldSize.y, 1.0);
  float newAspect = uNewSize.x / max(uNewSize.y, 1.0);
  float stageAspect = uViewport.x / max(uViewport.y, 1.0);
  float visibleWidth = uCover > 0.5 ? 1.0 :
    max(min(1.0, oldAspect / stageAspect), min(1.0, newAspect / stageAspect));
  float startX = 0.5 - visibleWidth * 0.5 - 0.035;
  float endX = 0.5 + visibleWidth * 0.5 + 0.035;
  float path = mix(startX, endX, ease(p));
  float amplitude = sin(PI * p);
  float softS = 0.047 * sin((y - 0.5) * 4.5 + p * 1.55);
  float secondary = 0.007 * sin(y * 14.0 - p * 3.3);
  return path + amplitude * (softS + secondary);
}

vec3 photo(sampler2D picture, vec2 size, vec2 uv) {
  float stageAspect = uViewport.x / max(uViewport.y, 1.0);
  float pictureAspect = size.x / max(size.y, 1.0);
  vec2 q = uv;
  if (uCover > 0.5) {
    if (pictureAspect > stageAspect) q.x = (q.x - 0.5) * stageAspect / pictureAspect + 0.5;
    else q.y = (q.y - 0.5) * pictureAspect / stageAspect + 0.5;
  } else {
    if (stageAspect > pictureAspect) q.x = (q.x - 0.5) * stageAspect / pictureAspect + 0.5;
    else q.y = (q.y - 0.5) * pictureAspect / stageAspect + 0.5;
    if (q.x < 0.0 || q.x > 1.0 || q.y < 0.0 || q.y > 1.0) return MATTE;
  }
  return texture(picture, clamp(q, 0.0, 1.0)).rgb;
}

void main() {
  float progress = clamp(uProgress, 0.0, 1.0);
  if (progress <= 0.00001) { outColor = vec4(photo(uOld, uOldSize, vUv), 1.0); return; }
  if (progress >= 0.99999) { outColor = vec4(photo(uNew, uNewSize, vUv), 1.0); return; }
  float activity = sin(PI * progress);
  float seam = seamAt(vUv.y, progress);
  float row = vUv.y * uViewport.y / 15.0;
  float tooth = 0.0023 * sin(row * 2.0 * PI) * activity;
  float d = vUv.x - (seam + tooth);
  float distanceToSeam = abs(d);
  float falloff = exp(-distanceToSeam * 11.5) * activity;
  float foldPhase = distanceToSeam * 51.0 + vUv.y * 4.5 - progress * 2.8;
  float fineFold = sin(foldPhase) + 0.32 * sin(foldPhase * 1.93 + 1.0);
  vec2 oldUv = vUv;
  oldUv.x += falloff * (0.039 + 0.008 * fineFold);
  oldUv.y += falloff * 0.0055 * sin(distanceToSeam * 33.0 + vUv.y * 11.0);
  vec2 newUv = vUv;
  newUv.x -= falloff * (0.033 + 0.006 * fineFold);
  newUv.y -= falloff * 0.004 * sin(distanceToSeam * 31.0 + vUv.y * 9.0);
  float isOld = step(0.0, d);
  vec3 color = mix(photo(uNew, uNewSize, newUv), photo(uOld, uOldSize, oldUv), isOld);
  float wrinkle = sin(foldPhase + 0.7) * 0.10 + sin(foldPhase * 0.54 - 0.3) * 0.055;
  float gatheredShadow = exp(-max(d, 0.0) * 25.0) * isOld * 0.18;
  float openingLight = exp(-max(-d, 0.0) * 23.0) * (1.0 - isOld) * 0.09;
  color *= 1.0 + falloff * wrinkle - gatheredShadow * activity + openingLight * activity;
  float pixelDistance = distanceToSeam * uViewport.x;
  float innerSeam = 1.0 - smoothstep(0.7, 2.1, pixelDistance);
  float seamHighlight = exp(-abs(pixelDistance - 4.2) * 0.65) * activity;
  color = mix(color, vec3(0.98, 0.89, 0.84), innerSeam * activity * 0.62);
  color += vec3(0.066, 0.040, 0.031) * seamHighlight * 0.23;
  float stitchRow = abs(fract(row) - 0.5);
  float stitchLength = 1.0 - smoothstep(0.13, 0.24, stitchRow);
  float stitchSide = exp(-abs(pixelDistance - 6.5) * 0.55);
  float stitch = stitchLength * stitchSide * activity * 0.40;
  color = mix(color, vec3(0.63, 0.38, 0.33), stitch);
  outColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}`;

export const zipperClothTransition = createDemoShaderTransition({
  name: 'zipper-cloth', fragmentShader, defaults: { imageFit: 'contain' },
  uniforms: [], renderUniforms: () => undefined,
});
