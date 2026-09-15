import { defineTransition } from '../registry';
import type {
  Direction,
  LoadedImage,
  PrismorphImageFit,
  TransitionEffect,
  TransitionEffectContext,
  TransitionFrame,
} from '../types';
import {
  bindWebGL2Texture,
  createWebGL2Program,
  createWebGL2Texture,
  resolveDirectionIndex,
  type AxisDirection,
} from './webgl2-utils';

export type SilkRibbonsDirection = AxisDirection;

export interface SilkRibbonsOptions {
  /** Direction in which the old image leaves. The new image enters from the opposite side. */
  direction?: SilkRibbonsDirection;
  /** Number of independently delayed ribbons. */
  ribbonCount?: number;
  /** Cross-axis bending and axial flutter strength. */
  curl?: number;
  /** Irregularity of the ribbon order, from directional to organic. */
  stagger?: number;
  /** Fold shading and warm specular highlight intensity. */
  sheen?: number;
  /** How each image is fitted inside the transition viewport. */
  imageFit?: PrismorphImageFit;
}

const fragmentShader = `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 outColor;

uniform sampler2D uFrom;
uniform sampler2D uTo;
uniform vec2 uResolution;
uniform vec2 uFromSize;
uniform vec2 uToSize;
uniform float uProgress;
uniform float uTime;
uniform float uRibbonCount;
uniform float uCurl;
uniform float uStagger;
uniform float uSheen;
uniform float uImageFit;
uniform int uDirection;

const vec3 BACKDROP = vec3(0.008, 0.010, 0.010);

float hash11(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}

float smoother(float x) {
  x = clamp(x, 0.0, 1.0);
  return x * x * x * (x * (x * 6.0 - 15.0) + 10.0);
}

vec2 fitUV(vec2 uv, vec2 imageSize) {
  float viewAspect = uResolution.x / max(uResolution.y, 1.0);
  float imageAspect = imageSize.x / max(imageSize.y, 1.0);
  vec2 scale = vec2(1.0);
  float ratio = viewAspect / max(imageAspect, 0.0001);
  if (uImageFit > 0.5) {
    if (ratio > 1.0) scale.x = ratio;
    else scale.y = 1.0 / ratio;
  } else {
    if (ratio > 1.0) scale.y = 1.0 / ratio;
    else scale.x = ratio;
  }
  return (uv - 0.5) * scale + 0.5;
}

float imageMask(vec2 uv) {
  if (uImageFit < 0.5) return 1.0;
  vec2 inside = step(vec2(0.0), uv) * step(uv, vec2(1.0));
  return inside.x * inside.y;
}

vec2 fromPQ(vec2 pq, vec2 axis, vec2 across) {
  return axis * pq.x + across * pq.y;
}

vec2 toPQ(vec2 uv, vec2 axis, vec2 across) {
  return vec2(dot(uv, axis), dot(uv, across));
}

vec4 sampleFitted(sampler2D tex, vec2 screenUv, vec2 texSize) {
  vec2 uv = fitUV(screenUv, texSize);
  vec4 sampled = texture(tex, clamp(uv, 0.0, 1.0));
  sampled.a *= imageMask(uv);
  return sampled;
}

vec4 ribbonLayer(
  sampler2D tex,
  vec2 texSize,
  vec2 uv,
  vec2 axis,
  vec2 across,
  float globalP,
  bool incoming
) {
  vec2 pq = toPQ(uv, axis, across);
  float qOffset = (across.x + across.y < 0.0) ? 1.0 : 0.0;
  float aOffset = (axis.x + axis.y < 0.0) ? 1.0 : 0.0;
  pq += vec2(aOffset, qOffset);

  float count = max(4.0, uRibbonCount);
  float band = floor(clamp(pq.y, 0.0, 0.99999) * count);
  // The two images intentionally share one schedule and one curve field. At exactly
  // one viewport of travel, the incoming head touches the outgoing tail per ribbon.
  float rnd = hash11(band + 13.2);
  float rnd2 = hash11(band * 2.17 + 7.4);
  float orderWave = 0.5 + 0.5 * sin(band * 0.73 + rnd * 5.4);
  float order = mix(band / max(1.0, count - 1.0), orderWave, uStagger);
  float start = -0.055 + order * 0.11;
  float span = 0.89;

  float longitudinal = sin(pq.x * 7.2 + band * 0.91 + rnd * 6.2831) * 0.035;
  longitudinal += sin(pq.x * 16.0 - band * 0.37) * 0.012 * uCurl;
  float localP = smoother((globalP - start - longitudinal * uStagger) / span);
  float motion = incoming ? (1.0 - localP) : localP;
  float envelope = sin(localP * 3.14159265);

  float signedTravel = incoming ? -motion : motion;
  float curve = sin(pq.x * (5.0 + rnd2 * 3.0) + band * 1.71 + uTime * 0.22);
  curve += 0.46 * sin(pq.x * 12.0 - band * 0.41 - uTime * 0.15);
  float crossShift = curve * envelope * uCurl * (0.032 + rnd2 * 0.038);
  float axialFlutter = sin(pq.x * 10.0 + band + uTime * 0.3) * envelope * uCurl * 0.026;

  vec2 samplePQ = pq;
  samplePQ.x -= signedTravel + axialFlutter;
  samplePQ.y -= crossShift;
  vec2 sampleUv = fromPQ(samplePQ - vec2(aOffset, qOffset), axis, across);

  float sampleBandPos = fract(samplePQ.y * count);
  float twistWave = sin(samplePQ.x * (8.0 + rnd * 5.0) + band * 1.37 + motion * 4.2);
  float widthScale = 1.0 - envelope * (0.24 + 0.34 * uCurl) * pow(abs(twistWave), 1.65);
  float bandDistance = abs(sampleBandPos - 0.5);
  float feather = 0.045 + 0.018 * uCurl;
  float edge = 1.0 - smoothstep(
    max(0.04, widthScale * 0.5 - feather),
    widthScale * 0.5,
    bandDistance
  );
  float silhouette = mix(1.0, edge, envelope * 0.92);

  vec4 color = sampleFitted(tex, sampleUv, texSize);
  float foldPhase = ((sampleBandPos - 0.5) / max(widthScale, 0.2)) * 6.2831 + curve * 0.72;
  float fold = cos(foldPhase);
  float broadLight = 0.84 + fold * 0.16 * uSheen * envelope;
  float glint = pow(max(0.0, cos(foldPhase - 0.72)), 18.0) * uSheen * envelope;
  float underside = (1.0 - smoothstep(-0.92, -0.1, fold)) * 0.28 * envelope;
  color.rgb = color.rgb * (broadLight - underside)
    + vec3(1.0, 0.84, 0.68) * glint * 0.42;
  color.a *= silhouette;
  return color;
}

void main() {
  vec2 uv = vUv;
  if (uProgress <= 0.0001) {
    vec4 stableFrom = sampleFitted(uFrom, uv, uFromSize);
    outColor = vec4(mix(BACKDROP, stableFrom.rgb, stableFrom.a), 1.0);
    return;
  }
  if (uProgress >= 0.9999) {
    vec4 stableTo = sampleFitted(uTo, uv, uToSize);
    outColor = vec4(mix(BACKDROP, stableTo.rgb, stableTo.a), 1.0);
    return;
  }

  vec2 axis;
  if (uDirection == 0) axis = vec2(1.0, 0.0);
  else if (uDirection == 1) axis = vec2(-1.0, 0.0);
  else if (uDirection == 2) axis = vec2(0.0, 1.0);
  else axis = vec2(0.0, -1.0);
  vec2 across = vec2(-axis.y, axis.x);

  vec4 fromColor = ribbonLayer(uFrom, uFromSize, uv, axis, across, uProgress, false);
  vec4 toColor = ribbonLayer(uTo, uToSize, uv, axis, across, uProgress, true);
  float toFront = step(0.5, hash11(floor((uv.x + uv.y * 1.31) * uRibbonCount) + 31.0));
  vec4 backLayer = mix(toColor, fromColor, toFront);
  vec4 frontLayer = mix(fromColor, toColor, toFront);
  vec3 color = mix(BACKDROP, backLayer.rgb, backLayer.a);
  color = mix(color, frontLayer.rgb, frontLayer.a);

  float vignette = smoothstep(1.1, 0.24, length(uv - 0.5));
  color *= mix(0.76, 1.0, vignette);
  outColor = vec4(color, 1.0);
}
`;

class SilkRibbonsEffect implements TransitionEffect {
  readonly canvas = document.createElement('canvas');
  private gl!: WebGL2RenderingContext;
  private program!: WebGLProgram;
  private vao: WebGLVertexArrayObject | null = null;
  private items: LoadedImage[] = [];
  private textures: WebGLTexture[] = [];
  private fromIndex = 0;
  private toIndex = 0;
  private width = 1;
  private height = 1;
  private locations!: Record<string, WebGLUniformLocation | null>;

  init(context: TransitionEffectContext): void {
    const gl = this.canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
      powerPreference: 'high-performance',
    });
    if (!gl) throw new Error('WebGL2 is required for the silk-ribbons transition.');
    this.gl = gl;
    this.items = context.items;
    this.program = createWebGL2Program(gl, fragmentShader);
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    this.locations = {
      from: gl.getUniformLocation(this.program, 'uFrom'),
      to: gl.getUniformLocation(this.program, 'uTo'),
      resolution: gl.getUniformLocation(this.program, 'uResolution'),
      fromSize: gl.getUniformLocation(this.program, 'uFromSize'),
      toSize: gl.getUniformLocation(this.program, 'uToSize'),
      progress: gl.getUniformLocation(this.program, 'uProgress'),
      time: gl.getUniformLocation(this.program, 'uTime'),
      ribbonCount: gl.getUniformLocation(this.program, 'uRibbonCount'),
      curl: gl.getUniformLocation(this.program, 'uCurl'),
      stagger: gl.getUniformLocation(this.program, 'uStagger'),
      sheen: gl.getUniformLocation(this.program, 'uSheen'),
      imageFit: gl.getUniformLocation(this.program, 'uImageFit'),
      direction: gl.getUniformLocation(this.program, 'uDirection'),
    };
    this.textures = this.items.map((item) => createWebGL2Texture(gl, item));
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

  render(frame: TransitionFrame): void {
    const options = frame.options as SilkRibbonsOptions;
    const from = this.items[this.fromIndex];
    const to = this.items[this.toIndex];
    const gl = this.gl;
    gl.viewport(0, 0, this.width, this.height);
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    bindWebGL2Texture(gl, this.textures[this.fromIndex], 0, this.locations.from);
    bindWebGL2Texture(gl, this.textures[this.toIndex], 1, this.locations.to);
    gl.uniform2f(this.locations.resolution, this.width, this.height);
    gl.uniform2f(this.locations.fromSize, from.width, from.height);
    gl.uniform2f(this.locations.toSize, to.width, to.height);
    gl.uniform1f(this.locations.progress, frame.progress);
    gl.uniform1f(this.locations.time, frame.time);
    gl.uniform1f(this.locations.ribbonCount, Math.max(4, options.ribbonCount ?? 44));
    gl.uniform1f(this.locations.curl, Math.max(0, options.curl ?? 0.72));
    gl.uniform1f(this.locations.stagger, Math.min(1, Math.max(0, options.stagger ?? 0.68)));
    gl.uniform1f(this.locations.sheen, Math.max(0, options.sheen ?? 0.62));
    gl.uniform1f(this.locations.imageFit, options.imageFit === 'contain' ? 1 : 0);
    gl.uniform1i(this.locations.direction, resolveDirectionIndex(options.direction, frame.direction));
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  destroy(): void {
    this.textures.forEach((texture) => this.gl.deleteTexture(texture));
    if (this.vao) this.gl.deleteVertexArray(this.vao);
    if (this.program) this.gl.deleteProgram(this.program);
    this.canvas.remove();
  }
}

export const silkRibbonsTransition = defineTransition({
  name: 'silk-ribbons',
  backend: 'webgl2',
  defaults: {
    direction: 'auto',
    ribbonCount: 44,
    curl: 0.72,
    stagger: 0.68,
    sheen: 0.62,
    imageFit: 'cover',
  },
  phaseEasing: 'power1.inOut',
  supported: () => typeof WebGL2RenderingContext !== 'undefined',
  create: () => new SilkRibbonsEffect(),
});
