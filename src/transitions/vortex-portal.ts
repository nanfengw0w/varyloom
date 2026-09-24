import type { VaryloomImageFit } from '../types';
import { createDemoShaderTransition } from './webgl2-demo-effect';

export interface VortexPortalOptions {
  twist?: number;
  originX?: number;
  originY?: number;
  spinDirection?: -1 | 1;
  imageFit?: VaryloomImageFit;
}

const fragmentShader = `#version 300 es
precision highp float;
uniform sampler2D uOld;
uniform sampler2D uNew;
uniform vec2 uOldSize;
uniform vec2 uNewSize;
uniform vec2 uViewport;
uniform vec2 uOrigin;
uniform float uProgress;
uniform float uTwist;
uniform float uSpin;
uniform float uCover;
in vec2 vUv;
out vec4 outColor;
const float PI = 3.141592653589793;

vec2 turn(vec2 p, float angle) {
  float s = sin(angle), c = cos(angle);
  return vec2(c * p.x - s * p.y, s * p.x + c * p.y);
}

vec3 imageColor(sampler2D picture, vec2 imageSize, vec2 uv) {
  float viewAspect = uViewport.x / max(uViewport.y, 1.0);
  float imageAspect = imageSize.x / max(imageSize.y, 1.0);
  vec2 containUv = uv;
  vec2 coverUv = uv;
  if (imageAspect > viewAspect) {
    float displayHeight = viewAspect / imageAspect;
    containUv.y = (uv.y - 0.5) / displayHeight + 0.5;
    coverUv.x = (uv.x - 0.5) * viewAspect / imageAspect + 0.5;
  } else {
    float displayWidth = imageAspect / viewAspect;
    containUv.x = (uv.x - 0.5) / displayWidth + 0.5;
    coverUv.y = (uv.y - 0.5) * imageAspect / viewAspect + 0.5;
  }
  if (uCover > 0.5) return texture(picture, clamp(coverUv, 0.0, 1.0)).rgb;
  float inside = step(0.0, containUv.x) * step(containUv.x, 1.0)
               * step(0.0, containUv.y) * step(containUv.y, 1.0);
  vec3 image = texture(picture, clamp(containUv, 0.0, 1.0)).rgb;
  vec3 atmosphere = texture(picture, clamp(coverUv, 0.0, 1.0)).rgb;
  float luminance = dot(atmosphere, vec3(0.2126, 0.7152, 0.0722));
  atmosphere = mix(vec3(luminance), atmosphere, 0.32) * 0.12;
  return mix(atmosphere, image, inside);
}

void main() {
  if (uProgress <= 0.00001) { outColor = vec4(imageColor(uOld, uOldSize, vUv), 1.0); return; }
  if (uProgress >= 0.99999) { outColor = vec4(imageColor(uNew, uNewSize, vUv), 1.0); return; }
  float aspect = uViewport.x / max(uViewport.y, 1.0);
  vec2 metric = vec2(aspect, 1.0);
  vec2 p = (vUv - uOrigin) * metric;
  float maximumRadius = length(vec2(max(uOrigin.x, 1.0 - uOrigin.x) * aspect,
                                     max(uOrigin.y, 1.0 - uOrigin.y))) + 0.002;
  float radius = length(p);
  float r = radius / maximumRadius;
  float angle = atan(p.y, p.x);
  float front = 1.13 * pow(uProgress, 0.84);
  float motion = pow(sin(PI * uProgress), 0.67);
  float boundaryWave = (sin(angle * 3.0 - uProgress * 6.4) * 0.018
                      + sin(angle * 7.0 + uProgress * 9.1) * 0.009) * motion;
  float edgeDistance = r + boundaryWave - front;
  float envelope = exp(-pow(edgeDistance / 0.24, 2.0));
  float nearEdge = exp(-pow(edgeDistance / 0.065, 2.0));
  float turnAmount = uSpin * uTwist * motion *
                     (0.17 * exp(-r * 2.5) + 0.68 * envelope);
  vec2 oldPoint = turn(p, -turnAmount) * (1.0 + 0.075 * envelope * motion);
  vec2 newPoint = turn(p, turnAmount * 0.82) * (1.0 - 0.056 * envelope * motion);
  vec2 oldUv = uOrigin + oldPoint / metric;
  vec2 newUv = uOrigin + newPoint / metric;
  vec3 oldColor = imageColor(uOld, uOldSize, oldUv);
  vec3 newColor = imageColor(uNew, uNewSize, newUv);
  float feather = max(0.005, 2.0 / min(uViewport.x, uViewport.y));
  float newWeight = 1.0 - smoothstep(-feather, feather, edgeDistance);
  vec3 color = mix(oldColor, newColor, newWeight);
  vec2 tangent = vec2(-p.y, p.x) / max(radius, 0.001);
  vec2 streakOffset = tangent / metric * 0.022 * nearEdge * motion;
  vec3 sourceStreak = imageColor(uOld, uOldSize, oldUv + streakOffset);
  vec3 targetStreak = imageColor(uNew, uNewSize, newUv - streakOffset);
  color = mix(color, mix(sourceStreak, targetStreak, newWeight), nearEdge * 0.19);
  float lip = exp(-pow(edgeDistance / 0.012, 2.0)) * motion;
  color *= 1.0 - nearEdge * 0.10;
  color += vec3(0.27, 0.31, 0.23) * lip * 0.095;
  outColor = vec4(max(color, vec3(0.0)), 1.0);
}`;

export const vortexPortalTransition = createDemoShaderTransition({
  name: 'vortex-portal',
  fragmentShader,
  defaults: { twist: 0.78, originX: 0.54, originY: 0.49, spinDirection: 1, imageFit: 'contain' },
  uniforms: ['uOrigin', 'uTwist', 'uSpin'],
  renderUniforms: ({ gl, locations, frame, direction }) => {
    const options = frame.options as VortexPortalOptions;
    gl.uniform2f(locations.uOrigin,
      Math.max(0.05, Math.min(0.95, Number(options.originX ?? 0.54))),
      Math.max(0.05, Math.min(0.95, Number(options.originY ?? 0.49))));
    gl.uniform1f(locations.uTwist, Math.max(0, Number(options.twist ?? 0.78)));
    gl.uniform1f(locations.uSpin, (options.spinDirection ?? direction) < 0 ? -1 : 1);
  },
});
