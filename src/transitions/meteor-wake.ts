import { Buffer, elementKernel, GpuContext } from 'wgpu-kit';

import { defineTransition } from '../registry';
import type {
  Direction,
  LoadedImage,
  VaryloomImageFit,
  TransitionEffect,
  TransitionEffectContext,
  TransitionFrame,
} from '../types';

export interface MeteorWakeOptions {
  spread?: number;
  turbulence?: number;
  glow?: number;
  afterglow?: number;
  particleCount?: number;
  imageFit?: VaryloomImageFit;
}

const nav = (typeof navigator === 'undefined' ? {} : navigator) as Navigator & { deviceMemory?: number };
const coarseDevice = (typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches)
  || (nav.deviceMemory !== undefined && nav.deviceMemory <= 4);
const DEFAULT_PARTICLE_COUNT = coarseDevice ? 32768 : 65536;
const WAKE_SEGMENTS = 30;
const MOTION_REFERENCE_DURATION = 3.2;

const updateKernel = elementKernel({
  name: "meteor-stardust-simulation",
  state: { pos: "vec2f", vel: "vec2f", lifeState: "vec4f" },
  inputs: { seeds: "f32" },
  uniforms: {
    dt: "f32",
    progress: "f32",
    time: "f32",
    aspect: "f32",
    spread: "f32",
    turbulence: "f32",
  },
  workgroupSize: 256,
  code: /* wgsl */ `
    fn hash11(p: f32) -> f32 {
      return fract(sin(p * 127.113) * 43758.5453123);
    }

    fn bezierPoint(a: vec2f, b: vec2f, c: vec2f, d: vec2f, t: f32) -> vec2f {
      let q = 1.0 - t;
      return q * q * q * a + 3.0 * q * q * t * b + 3.0 * q * t * t * c + t * t * t * d;
    }

    fn meteorDelay(id: f32) -> f32 {
      if (id < 0.5) { return 0.025; }
      if (id < 1.5) { return 0.105; }
      return 0.175;
    }

    fn meteorPath(id: f32, t: f32, aspect: f32) -> vec2f {
      if (id < 0.5) {
        return bezierPoint(
          vec2f(-aspect * 1.12, 1.24), vec2f(-aspect * 0.88, 0.73),
          vec2f(-aspect * 0.54, -0.26), vec2f(-aspect * 0.25, -1.22), t
        );
      }
      if (id < 1.5) {
        return bezierPoint(
          vec2f(-aspect * 1.02, 1.27), vec2f(-aspect * 0.62, 0.86),
          vec2f(aspect * 0.10, -0.08), vec2f(aspect * 0.90, -1.20), t
        );
      }
      return bezierPoint(
        vec2f(-aspect * 0.88, 1.25), vec2f(-aspect * 0.42, 0.88),
        vec2f(aspect * 0.58, 0.46), vec2f(aspect * 1.20, 0.02), t
      );
    }

    fn wakeRadius(progress: f32, spread: f32) -> f32 {
      // The meteor head stays compact.  The mask shader expands older trail
      // segments independently, so particles emitted here never form a fixed,
      // screen-sized rim around the current head.
      return 0.075 + spread * 0.065 + progress * 0.008;
    }

    fn userFn(
      idx: u32,
      dt: f32,
      progress: f32,
      time: f32,
      aspect: f32,
      spread: f32,
      turbulence: f32
    ) {
      var particle = lifeState[idx];
      let seed = seeds[idx];
      let emitter = particle.w;

      if (particle.x < -0.5) {
        if (progress + 0.0002 < particle.z || progress > 0.985) {
          pos[idx] = pos[idx];
          vel[idx] = vel[idx];
          lifeState[idx] = particle;
          return;
        }

        let delay = meteorDelay(emitter);
        let pathTime = clamp((progress - delay) / max(0.001, 0.80 - delay), 0.0, 1.0);
        let head = meteorPath(emitter, pathTime, aspect);
        let previous = meteorPath(emitter, max(pathTime - 0.006, 0.0), aspect);
        let direction = normalize(head - previous + vec2f(0.0001, -0.0001));
        let normal = vec2f(-direction.y, direction.x);
        let edge = wakeRadius(progress, spread);
        // Sample the exact perimeter of the reveal brush.  Leave a narrow cone
        // in front of the meteor empty so the particles read as a trailing rim,
        // not a glowing disc painted over the picture.
        let arc = 3.14159265 + (hash11(seed * 71.3 + 4.0) - 0.5) * 5.20;
        let radialJitter = mix(0.94, 1.025, hash11(seed * 53.9 + 6.0));
        let ellipse = direction * cos(arc) * edge * 1.16
          + normal * sin(arc) * edge;
        let edgeNormal = normalize(
          direction * cos(arc) / 1.16 + normal * sin(arc) + vec2f(0.0001)
        );
        let tangent = vec2f(-edgeNormal.y, edgeNormal.x);
        pos[idx] = head + ellipse * radialJitter;

        let outwardSpeed = 0.010 + hash11(seed * 47.1 + 1.7) * (0.026 + spread * 0.032);
        let tangentSpeed = (hash11(seed * 22.9 + 7.5) - 0.5) * 0.055;
        let downward = vec2f(0.0, -0.008 - hash11(seed * 83.0) * 0.022);
        vel[idx] = edgeNormal * outwardSpeed + tangent * tangentSpeed + downward;
        particle.x = 0.0;
      }

      if (particle.x < 0.0 || particle.x >= particle.y) {
        if (particle.x >= particle.y) {
          pos[idx] = vec2f(-aspect * 3.0, -3.0);
          vel[idx] = vec2f(0.0);
          particle.x = particle.y + 2.0;
          lifeState[idx] = particle;
        } else {
          pos[idx] = pos[idx];
          vel[idx] = vel[idx];
          lifeState[idx] = particle;
        }
        return;
      }

      var position = pos[idx];
      var velocity = vel[idx];
      let phaseA = time * (0.72 + hash11(seed * 31.0) * 0.8) + seed * 17.0;
      let phaseB = time * 0.51 - seed * 12.0;
      let curl = vec2f(
        sin(position.y * 5.7 + phaseA) + cos(position.x * 4.3 - phaseB) * 0.62,
        -cos(position.x * 5.1 - phaseA) + sin(position.y * 3.9 + phaseB) * 0.62
      );
      let microDrift = vec2f(
        sin(seed * 91.0 + time * 1.7),
        cos(seed * 73.0 - time * 1.3)
      );
      let ageRatio = clamp(particle.x / max(particle.y, 0.001), 0.0, 1.0);
      velocity += (curl * (0.045 + turbulence * 0.15) + microDrift * 0.018)
        * (0.55 + ageRatio * 0.8) * dt;
      velocity += vec2f(0.012, -0.018) * dt;
      velocity *= exp(-(0.42 + ageRatio * 0.72) * dt);
      position += velocity * dt;
      particle.x += dt;

      pos[idx] = position;
      vel[idx] = velocity;
      lifeState[idx] = particle;
    }
  `,
});;

const particleShader = /* wgsl */ `
  struct SceneUniforms {
    frame: vec4f,
    viewport: vec4f,
    style: vec4f,
    imageA: vec4f,
    imageB: vec4f,
    state: vec4f,
  };

  @group(0) @binding(0) var<storage, read> positions: array<vec2f>;
  @group(0) @binding(1) var<storage, read> velocities: array<vec2f>;
  @group(0) @binding(2) var<storage, read> metadata: array<vec4f>;
  @group(0) @binding(3) var<storage, read> randomSeeds: array<f32>;
  @group(0) @binding(4) var<uniform> uniforms: SceneUniforms;

  fn hash11(p: f32) -> f32 {
    return fract(sin(p * 127.113) * 43758.5453123);
  }

  fn bezierPoint(a: vec2f, b: vec2f, c: vec2f, d: vec2f, t: f32) -> vec2f {
    let q = 1.0 - t;
    return q * q * q * a + 3.0 * q * q * t * b + 3.0 * q * t * t * c + t * t * t * d;
  }

  fn meteorDelay(id: f32) -> f32 {
    if (id < 0.5) { return 0.025; }
    if (id < 1.5) { return 0.105; }
    return 0.175;
  }

  fn meteorPath(id: f32, t: f32, aspect: f32) -> vec2f {
    if (id < 0.5) {
      return bezierPoint(
        vec2f(-aspect * 1.12, 1.24), vec2f(-aspect * 0.88, 0.73),
        vec2f(-aspect * 0.54, -0.26), vec2f(-aspect * 0.25, -1.22), t
      );
    }
    if (id < 1.5) {
      return bezierPoint(
        vec2f(-aspect * 1.02, 1.27), vec2f(-aspect * 0.62, 0.86),
        vec2f(aspect * 0.10, -0.08), vec2f(aspect * 0.90, -1.20), t
      );
    }
    return bezierPoint(
      vec2f(-aspect * 0.88, 1.25), vec2f(-aspect * 0.42, 0.88),
      vec2f(aspect * 0.58, 0.46), vec2f(aspect * 1.20, 0.02), t
    );
  }

  struct ParticleOutput {
    @builtin(position) position: vec4f,
    @location(0) local: vec2f,
    @location(1) seed: f32,
    @location(2) fade: f32,
    @location(3) style: f32,
    @location(4) emitter: f32,
  };

  @vertex
  fn particleVertex(@builtin(vertex_index) vertexIndex: u32, @builtin(instance_index) instanceIndex: u32) -> ParticleOutput {
    let corners = array<vec2f, 6>(
      vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
      vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0)
    );
    let local = corners[vertexIndex];
    let particle = metadata[instanceIndex];
    let seed = randomSeeds[instanceIndex];
    let alive = step(0.0, particle.x) * (1.0 - step(particle.y, particle.x)) * uniforms.state.x;
    let ageRatio = clamp(particle.x / max(particle.y, 0.001), 0.0, 1.0);
    let fadeIn = smoothstep(0.0, 0.055, particle.x);
    let fadeOut = 1.0 - smoothstep(0.54, 1.0, ageRatio);
    let afterglow = 1.0 - smoothstep(0.05, 1.0, uniforms.state.y);
    let style = hash11(seed * 43.7 + 2.0);
    let depth = hash11(seed * 17.9 + 8.0);
    let px = mix(0.34, 0.82, depth) * uniforms.viewport.z;
    let starScale = select(1.0, mix(2.2, 3.25, hash11(seed * 9.1)), style >= 0.985);
    let halfSize = px * starScale * 2.0 / max(uniforms.viewport.y, 1.0);
    let angle = seed * 6.2831853 + sin(uniforms.frame.z * 0.21 + seed * 17.0) * 0.08;
    let axisX = vec2f(cos(angle), sin(angle));
    let axisY = vec2f(-axisX.y, axisX.x);
    let offset = axisX * local.x * halfSize + axisY * local.y * halfSize;
    let world = positions[instanceIndex] + offset;

    var output: ParticleOutput;
    output.position = vec4f(world.x / uniforms.frame.x, world.y, 0.0, 1.0);
    output.local = local;
    output.seed = seed;
    output.fade = alive * fadeIn * fadeOut * afterglow;
    output.style = style;
    output.emitter = particle.w;
    if (alive < 0.5) {
      output.position = vec4f(3.0, 3.0, 0.0, 1.0);
    }
    return output;
  }

  @fragment
  fn particleFragment(input: ParticleOutput) -> @location(0) vec4f {
    let radius2 = dot(input.local, input.local);
    let core = exp(-radius2 * 15.5);
    let halo = exp(-radius2 * 3.1) * 0.075;
    let rayX = exp(-abs(input.local.y) * 58.0) * exp(-abs(input.local.x) * 3.4);
    let rayY = exp(-abs(input.local.x) * 58.0) * exp(-abs(input.local.y) * 3.4);
    let sharpTwinkle = pow(max(0.0, sin(uniforms.frame.z * (2.0 + input.seed * 3.8) + input.seed * 41.0)), 10.0);
    let quietPulse = 0.74 + 0.26 * sin(uniforms.frame.z * (1.2 + input.seed * 2.2) + input.seed * 23.0);
    var shape = core + halo;
    var pulse = quietPulse;
    if (input.style >= 0.985) {
      let diffraction = (rayX + rayY) * (0.09 + sharpTwinkle * 0.34);
      shape = max(core + halo * 0.62, diffraction);
      pulse = 0.50 + sharpTwinkle * 0.82;
    }
    if (shape < 0.006) { discard; }
    let white = vec3f(0.93, 0.975, 1.0);
    let cyan = vec3f(0.47, 0.82, 1.0);
    let gold = vec3f(1.0, 0.78, 0.43);
    let violet = vec3f(0.73, 0.58, 1.0);
    var tint = mix(white, cyan, 0.18 + input.seed * 0.18);
    if (input.emitter < 0.5) { tint = mix(white, gold, 0.22); }
    if (input.emitter > 1.5) { tint = mix(white, violet, 0.24); }
    let alpha = shape * input.fade * pulse * (0.42 + uniforms.style.z * 0.44);
    return vec4f(tint * alpha, alpha);
  }

  struct HeadOutput {
    @builtin(position) position: vec4f,
    @location(0) local: vec2f,
    @location(1) emitter: f32,
    @location(2) visibility: f32,
  };

  @vertex
  fn headVertex(@builtin(vertex_index) vertexIndex: u32, @builtin(instance_index) instanceIndex: u32) -> HeadOutput {
    let corners = array<vec2f, 6>(
      vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
      vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0)
    );
    let local = corners[vertexIndex];
    let emitter = f32(instanceIndex);
    let delay = meteorDelay(emitter);
    let pathTime = clamp((uniforms.frame.y - delay) / max(0.001, 0.80 - delay), 0.0, 1.0);
    let head = meteorPath(emitter, pathTime, uniforms.frame.x);
    let previous = meteorPath(emitter, max(pathTime - 0.008, 0.0), uniforms.frame.x);
    let direction = normalize(head - previous + vec2f(0.0001, -0.0001));
    let normal = vec2f(-direction.y, direction.x);
    let px = (7.0 + uniforms.style.z * 6.0) * uniforms.viewport.z;
    let size = px * 2.0 / max(uniforms.viewport.y, 1.0);
    let offset = direction * local.x * size * 1.65 + normal * local.y * size;
    let started = step(delay, uniforms.frame.y);
    let ended = 1.0 - smoothstep(0.81, 0.91, uniforms.frame.y);
    let visibility = started * ended * uniforms.state.x * (1.0 - uniforms.state.y);

    var output: HeadOutput;
    output.position = vec4f((head.x + offset.x) / uniforms.frame.x, head.y + offset.y, 0.0, 1.0);
    output.local = local;
    output.emitter = emitter;
    output.visibility = visibility;
    if (visibility < 0.001) { output.position = vec4f(3.0, 3.0, 0.0, 1.0); }
    return output;
  }

  @fragment
  fn headFragment(input: HeadOutput) -> @location(0) vec4f {
    let p = input.local;
    let body = exp(-(p.x * p.x * 4.2 + p.y * p.y * 16.0) * 2.3);
    let forward = exp(-((p.x - 0.24) * (p.x - 0.24) * 10.0 + p.y * p.y * 30.0) * 2.2);
    let shardA = exp(-length((p - vec2f(-0.24, 0.25)) * vec2f(6.0, 8.0)) * 2.5);
    let shardB = exp(-length((p - vec2f(-0.40, -0.17)) * vec2f(7.0, 9.0)) * 2.3);
    let ray = exp(-abs(p.y) * 16.0) * (1.0 - smoothstep(0.1, 1.0, abs(p.x)));
    let halo = exp(-dot(p, p) * 2.4) * 0.34;
    let shape = body + forward * 0.72 + shardA * 0.36 + shardB * 0.30 + ray * 0.14 + halo * 0.74;
    if (shape < 0.012) { discard; }
    var tint = vec3f(0.70, 0.90, 1.0);
    if (input.emitter < 0.5) { tint = vec3f(1.0, 0.82, 0.52); }
    if (input.emitter > 1.5) { tint = vec3f(0.77, 0.66, 1.0); }
    let alpha = clamp(shape, 0.0, 1.35) * input.visibility * (0.42 + uniforms.style.z * 0.62);
    return vec4f(tint * alpha, alpha);
  }
`;
const maskShader = /* wgsl */ `
  struct SceneUniforms {
    frame: vec4f,
    viewport: vec4f,
    style: vec4f,
    imageA: vec4f,
    imageB: vec4f,
    state: vec4f,
  };

  @group(0) @binding(0) var<storage, read> positions: array<vec2f>;
  @group(0) @binding(1) var<storage, read> velocities: array<vec2f>;
  @group(0) @binding(2) var<storage, read> metadata: array<vec4f>;
  @group(0) @binding(3) var<storage, read> randomSeeds: array<f32>;
  @group(0) @binding(4) var<uniform> uniforms: SceneUniforms;

  fn bezierPoint(a: vec2f, b: vec2f, c: vec2f, d: vec2f, t: f32) -> vec2f {
    let q = 1.0 - t;
    return q * q * q * a + 3.0 * q * q * t * b + 3.0 * q * t * t * c + t * t * t * d;
  }

  fn meteorDelay(id: f32) -> f32 {
    if (id < 0.5) { return 0.025; }
    if (id < 1.5) { return 0.105; }
    return 0.175;
  }

  fn meteorPath(id: f32, t: f32, aspect: f32) -> vec2f {
    if (id < 0.5) {
      return bezierPoint(
        vec2f(-aspect * 1.12, 1.24), vec2f(-aspect * 0.88, 0.73),
        vec2f(-aspect * 0.54, -0.26), vec2f(-aspect * 0.25, -1.22), t
      );
    }
    if (id < 1.5) {
      return bezierPoint(
        vec2f(-aspect * 1.02, 1.27), vec2f(-aspect * 0.62, 0.86),
        vec2f(aspect * 0.10, -0.08), vec2f(aspect * 0.90, -1.20), t
      );
    }
    return bezierPoint(
      vec2f(-aspect * 0.88, 1.25), vec2f(-aspect * 0.42, 0.88),
      vec2f(aspect * 0.58, 0.46), vec2f(aspect * 1.20, 0.02), t
    );
  }

  fn trailRadius(age: f32, progress: f32, spread: f32) -> f32 {
    let compactHead = 0.075 + spread * 0.065;
    let expandingWake = pow(max(age, 0.0), 0.72) * (0.72 + spread * 0.42);
    let lateBreath = smoothstep(0.70, 0.96, progress)
      * pow(max(age, 0.0), 0.46) * (0.13 + spread * 0.12);
    return compactHead + expandingWake + lateBreath;
  }

  struct MaskOutput {
    @builtin(position) position: vec4f,
    @location(0) local: vec2f,
    @location(1) strength: f32,
  };

  @vertex
  fn maskVertex(@builtin(vertex_index) vertexIndex: u32, @builtin(instance_index) instanceIndex: u32) -> MaskOutput {
    let corners = array<vec2f, 6>(
      vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
      vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0)
    );
    let local = corners[vertexIndex];
    let emitterIndex = instanceIndex % 3u;
    let historyIndex = instanceIndex / 3u;
    let emitter = f32(emitterIndex);
    let delay = meteorDelay(emitter);
    let rawHeadTime = max((uniforms.frame.y - delay) / max(0.001, 0.80 - delay), 0.0);
    let headTime = clamp(rawHeadTime, 0.0, 1.0);
    let historyStep = f32(historyIndex) / 29.0 * 0.88;
    let pathTime = headTime - historyStep;
    let sampleTime = max(pathTime, 0.0);
    // rawHeadTime is intentionally not clamped: after the meteor exits, its
    // final wake keeps ageing and expanding instead of freezing at the edge.
    let age = max(rawHeadTime - sampleTime, 0.0);
    let head = meteorPath(emitter, sampleTime, uniforms.frame.x);
    let previous = meteorPath(emitter, max(sampleTime - 0.008, 0.0), uniforms.frame.x);
    let direction = normalize(head - previous + vec2f(0.0001, -0.0001));
    let normal = vec2f(-direction.y, direction.x);
    let radius = trailRadius(age, uniforms.frame.y, uniforms.style.x);
    let world = head + direction * local.x * radius * 1.10 + normal * local.y * radius;
    let historyActive = step(0.0, pathTime);
    let brushActive = step(delay, uniforms.frame.y) * historyActive * uniforms.state.x;
    var output: MaskOutput;
    output.position = vec4f(world.x / uniforms.frame.x, world.y, 0.0, 1.0);
    output.local = local;
    output.strength = brushActive * mix(0.52, 0.82, smoothstep(0.0, 0.75, age));
    if (brushActive < 0.5) { output.position = vec4f(3.0, 3.0, 0.0, 1.0); }
    return output;
  }

  @fragment
  fn maskFragment(input: MaskOutput) -> @location(0) vec4f {
    let angle = atan2(input.local.y, input.local.x);
    let breakup = sin(angle * 5.0 + uniforms.frame.z * 0.12) * 0.035
      + sin(angle * 11.0 - 1.7) * 0.018;
    let radius = length(input.local);
    let coverage = 1.0 - smoothstep(0.82 + breakup, 1.02 + breakup, radius);
    let value = coverage * input.strength * 0.16;
    return vec4f(value, value, value, value);
  }
`;
const imageShader = /* wgsl */ `
  struct SceneUniforms {
    frame: vec4f,
    viewport: vec4f,
    style: vec4f,
    imageA: vec4f,
    imageB: vec4f,
    state: vec4f,
  };

  @group(0) @binding(0) var<uniform> uniforms: SceneUniforms;
  @group(0) @binding(1) var imageSampler: sampler;
  @group(0) @binding(2) var sourceImage: texture_2d<f32>;
  @group(0) @binding(3) var targetImage: texture_2d<f32>;
  @group(0) @binding(4) var revealImage: texture_2d<f32>;

  fn hash21(p: vec2f) -> f32 {
    let q = fract(p * vec2f(0.1031, 0.1030));
    let mixed = q + dot(q, q.yx + vec2f(33.33));
    return fract((mixed.x + mixed.y) * mixed.x);
  }

  fn boundaryStars(uv: vec2f, cellSize: f32, salt: f32) -> vec2f {
    let cell = uv * uniforms.viewport.xy / cellSize;
    let id = floor(cell);
    let local = fract(cell) - vec2f(0.5);
    let offset = (vec2f(
      hash21(id + vec2f(salt, 1.7)),
      hash21(id + vec2f(7.3, salt))
    ) - vec2f(0.5)) * 0.68;
    let delta = local - offset;
    let radius2 = dot(delta, delta);
    let selection = step(0.34, hash21(id + vec2f(13.1 + salt, 9.7)));
    let phase = uniforms.frame.z * (1.45 + hash21(id + vec2f(4.2, salt)) * 2.6)
      + hash21(id + vec2f(19.4, 3.1)) * 19.0;
    let twinkle = 0.24 + 0.76 * pow(0.5 + 0.5 * sin(phase), 7.0);
    let point = exp(-radius2 * 64.0);
    let opticalHalo = exp(-radius2 * 13.0) * 0.12;
    return vec2f(point, opticalHalo) * selection * twinkle;
  }

  struct PlaneOutput {
    @builtin(position) position: vec4f,
    @location(0) uv: vec2f,
  };

  @vertex
  fn planeVertex(@builtin(vertex_index) vertexIndex: u32) -> PlaneOutput {
    let points = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
    let point = points[vertexIndex];
    var output: PlaneOutput;
    output.position = vec4f(point, 0.0, 1.0);
    output.uv = vec2f(point.x * 0.5 + 0.5, 0.5 - point.y * 0.5);
    return output;
  }

  fn fitUv(uv: vec2f, imageSize: vec2f, contain: f32) -> vec3f {
    let viewAspect = uniforms.viewport.x / max(uniforms.viewport.y, 1.0);
    let imageAspect = imageSize.x / max(imageSize.y, 1.0);
    var mapped = uv;
    if (contain > 0.5) {
      if (imageAspect > viewAspect) {
        let h = viewAspect / imageAspect;
        mapped.y = (uv.y - 0.5) / h + 0.5;
      } else {
        let w = imageAspect / viewAspect;
        mapped.x = (uv.x - 0.5) / w + 0.5;
      }
    } else {
      if (imageAspect > viewAspect) {
        mapped.x = (uv.x - 0.5) * viewAspect / imageAspect + 0.5;
      } else {
        mapped.y = (uv.y - 0.5) * imageAspect / viewAspect + 0.5;
      }
    }
    let inside = step(0.0, mapped.x) * step(mapped.x, 1.0) * step(0.0, mapped.y) * step(mapped.y, 1.0);
    return vec3f(mapped, inside);
  }

  fn sampleFitted(image: texture_2d<f32>, imageSize: vec2f, uv: vec2f) -> vec3f {
    let fit = fitUv(uv, imageSize, uniforms.viewport.w);
    let cover = fitUv(uv, imageSize, 0.0);
    let imageColor = textureSample(image, imageSampler, clamp(fit.xy, vec2f(0.0), vec2f(1.0))).rgb;
    let backdropSample = textureSample(image, imageSampler, clamp(cover.xy, vec2f(0.0), vec2f(1.0))).rgb;
    let luma = dot(backdropSample, vec3f(0.2126, 0.7152, 0.0722));
    let backdrop = mix(vec3f(luma), backdropSample, 0.16) * 0.07;
    return mix(backdrop, imageColor, fit.z);
  }

  @fragment
  fn planeFragment(input: PlaneOutput) -> @location(0) vec4f {
    let source = sampleFitted(sourceImage, uniforms.imageA.xy, input.uv);
    let targetColor = sampleFitted(targetImage, uniforms.imageB.xy, input.uv);
    let deposited = textureSample(revealImage, imageSampler, input.uv).r;
    let reveal = smoothstep(0.045, 0.46, deposited);
    var color = mix(source, targetColor, reveal);
    let fringe = smoothstep(0.045, 0.20, deposited) * (1.0 - smoothstep(0.28, 0.48, deposited));
    color += vec3f(0.15, 0.22, 0.30) * fringe * uniforms.style.z * 0.045;

    // Derive the glint field from the reveal texture itself.  This makes the
    // visible stardust and the image boundary mathematically inseparable.
    let dimensions = vec2f(textureDimensions(revealImage));
    let texel = 1.0 / max(dimensions, vec2f(1.0));
    let left = textureSample(revealImage, imageSampler, input.uv - vec2f(texel.x, 0.0)).r;
    let right = textureSample(revealImage, imageSampler, input.uv + vec2f(texel.x, 0.0)).r;
    let up = textureSample(revealImage, imageSampler, input.uv - vec2f(0.0, texel.y)).r;
    let down = textureSample(revealImage, imageSampler, input.uv + vec2f(0.0, texel.y)).r;
    let gradient = length(vec2f(right - left, down - up));
    let depositedBand = smoothstep(0.028, 0.13, deposited)
      * (1.0 - smoothstep(0.28, 0.54, deposited));
    let edgeOnly = max(smoothstep(0.0015, 0.018, gradient), depositedBand);
    let glints = boundaryStars(input.uv, 4.2, 2.7)
      + boundaryStars(input.uv, 7.4, 11.9) * 0.76;
    let glintFade = uniforms.state.x * (1.0 - smoothstep(0.04, 0.92, uniforms.state.y));
    let starCore = glints.x * edgeOnly * glintFade * (0.92 + uniforms.style.z * 0.88);
    let starHalo = glints.y * edgeOnly * glintFade * (0.58 + uniforms.style.z * 0.50);
    // A restrained blue corona remains visible on white images, while the
    // compact additive core stays crisp on dark images.
    color = mix(color, vec3f(0.38, 0.68, 1.0), clamp(starHalo, 0.0, 0.20));
    color += vec3f(0.88, 0.96, 1.0) * starCore;
    return vec4f(color, 1.0);
  }
`;

function hash(value: number): number {
  let x = value | 0;
  x = Math.imul(x ^ (x >>> 16), 0x21f0aaad);
  x = Math.imul(x ^ (x >>> 15), 0x735a2d97);
  x ^= x >>> 15;
  return (x >>> 0) / 4294967296;
}

type KitBuffer = Awaited<ReturnType<typeof Buffer.create>>;

class MeteorWakeEffect implements TransitionEffect {
  readonly canvas = document.createElement('canvas');
  readonly continuous = true;

  private context!: GPUCanvasContext;
  private device!: GPUDevice;
  private format!: GPUTextureFormat;
  private items: LoadedImage[] = [];
  private textures: GPUTexture[] = [];
  private imageSizes: Array<[number, number]> = [];
  private particleCount = DEFAULT_PARTICLE_COUNT;
  private positionBuffer!: KitBuffer;
  private velocityBuffer!: KitBuffer;
  private metaBuffer!: KitBuffer;
  private seedBuffer!: KitBuffer;
  private uniformBuffer!: GPUBuffer;
  private sampler!: GPUSampler;
  private particleLayout!: GPUBindGroupLayout;
  private imageLayout!: GPUBindGroupLayout;
  private particleBindGroup!: GPUBindGroup;
  private imageBindGroup?: GPUBindGroup;
  private particlePipeline!: GPURenderPipeline;
  private headPipeline!: GPURenderPipeline;
  private maskPipeline!: GPURenderPipeline;
  private imagePipeline!: GPURenderPipeline;
  private revealTexture?: GPUTexture;
  private positionData = new Float32Array();
  private velocityData = new Float32Array();
  private metaData = new Float32Array();
  private seedData = new Float32Array();
  private fromIndex = 0;
  private toIndex = 0;
  private width = 1;
  private height = 1;
  private dpr = 1;
  private aspect = 1;
  private elapsed = 0;
  private settle = 1;
  private lastProgress = 0;
  private maskNeedsClear = true;
  private transitioning = false;
  private reportError: (error: Error) => void = () => undefined;

  async init(context: TransitionEffectContext): Promise<void> {
    this.items = context.items;
    this.reportError = context.reportError;
    const requestedCount = Number(context.options.particleCount);
    this.particleCount = Number.isFinite(requestedCount)
      ? Math.max(8192, Math.min(98304, Math.round(requestedCount)))
      : DEFAULT_PARTICLE_COUNT;
    if (!navigator.gpu) throw new Error('WebGPU is required for the meteor-wake transition.');
    const gpu = await GpuContext.get();
    this.device = gpu.device;
    const canvasContext = this.canvas.getContext('webgpu');
    if (!canvasContext) throw new Error('Unable to create a WebGPU canvas for meteor-wake.');
    this.context = canvasContext;
    this.format = navigator.gpu.getPreferredCanvasFormat();
    this.context.configure({ device: this.device, format: this.format, alphaMode: 'opaque' });
    context.host.appendChild(this.canvas);
    this.createParticleData();
    await this.createBuffers();
    this.createLayouts();
    await this.loadTextures();
    await this.createPipelines();
    this.resize(context.width, context.height, context.dpr);
    this.setImagePair(0, 0);
    await updateKernel.run(this.kernelResources(), {
      dt: 0,
      progress: 0,
      time: 0,
      aspect: this.aspect,
      spread: Number(context.options.spread ?? 0.66),
      turbulence: Number(context.options.turbulence ?? 0.44),
    });
    this.device.lost.then((info) => {
      this.reportError(new Error(`WebGPU device lost: ${info.message || info.reason}`));
    });
  }

  private createParticleData(): void {
    const count = this.particleCount;
    this.positionData = new Float32Array(count * 2);
    this.velocityData = new Float32Array(count * 2);
    this.metaData = new Float32Array(count * 4);
    this.seedData = new Float32Array(count);
    const delays = [0.025, 0.105, 0.175];
    for (let index = 0; index < count; index += 1) {
      const emitter = index % 3;
      const seed = hash(index + 911);
      const birthNoise = hash(index * 7 + 37);
      const depth = hash(index * 13 + 101);
      this.positionData[index * 2] = -3;
      this.positionData[index * 2 + 1] = -3;
      this.metaData[index * 4] = -1;
      this.metaData[index * 4 + 1] = 0.30 + depth * 0.60;
      this.metaData[index * 4 + 2] = delays[emitter] + Math.pow(birthNoise, 1.08) * (0.955 - delays[emitter]);
      this.metaData[index * 4 + 3] = emitter;
      this.seedData[index] = seed;
    }
  }

  private async createBuffers(): Promise<void> {
    [this.positionBuffer, this.velocityBuffer, this.metaBuffer, this.seedBuffer] = await Promise.all([
      Buffer.create('vec2f', this.particleCount),
      Buffer.create('vec2f', this.particleCount),
      Buffer.create('vec4f', this.particleCount),
      Buffer.create('f32', this.particleCount),
    ]);
    this.resetParticles();
    this.seedBuffer.write(this.seedData as Float32Array<ArrayBuffer>);
    this.uniformBuffer = this.device.createBuffer({
      label: 'varyloom-meteor-uniforms',
      size: 96,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.sampler = this.device.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
    });
  }

  private resetParticles(): void {
    this.positionBuffer?.write(this.positionData as Float32Array<ArrayBuffer>);
    this.velocityBuffer?.write(this.velocityData as Float32Array<ArrayBuffer>);
    this.metaBuffer?.write(this.metaData as Float32Array<ArrayBuffer>);
  }

  private createLayouts(): void {
    this.particleLayout = this.device.createBindGroupLayout({
      label: 'varyloom-meteor-particle-layout',
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
        { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
        { binding: 2, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
        { binding: 3, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
        { binding: 4, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      ],
    });
    this.imageLayout = this.device.createBindGroupLayout({
      label: 'varyloom-meteor-image-layout',
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
        { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
        { binding: 4, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
      ],
    });
    this.particleBindGroup = this.device.createBindGroup({
      label: 'varyloom-meteor-particle-bind-group',
      layout: this.particleLayout,
      entries: [
        { binding: 0, resource: { buffer: this.positionBuffer.gpuBuffer } },
        { binding: 1, resource: { buffer: this.velocityBuffer.gpuBuffer } },
        { binding: 2, resource: { buffer: this.metaBuffer.gpuBuffer } },
        { binding: 3, resource: { buffer: this.seedBuffer.gpuBuffer } },
        { binding: 4, resource: { buffer: this.uniformBuffer } },
      ],
    });
  }

  private async loadTextures(): Promise<void> {
    for (const item of this.items) {
      const texture = this.device.createTexture({
        label: item.caption || item.alt || 'varyloom meteor image',
        size: [item.width, item.height, 1],
        format: 'rgba8unorm',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
      });
      this.device.queue.copyExternalImageToTexture({ source: item.source }, { texture }, [item.width, item.height]);
      this.textures.push(texture);
      this.imageSizes.push([item.width, item.height]);
    }
  }

  private async checkedModule(label: string, code: string): Promise<GPUShaderModule> {
    const module = this.device.createShaderModule({ label, code });
    const diagnostics = await module.getCompilationInfo();
    const errors = diagnostics.messages.filter((message) => message.type === 'error');
    if (errors.length) {
      throw new Error(errors.map((error) => `WGSL ${error.lineNum}:${error.linePos} ${error.message}`).join('\n'));
    }
    return module;
  }

  private async createPipelines(): Promise<void> {
    const [particles, maskModule, imageModule] = await Promise.all([
      this.checkedModule('varyloom-meteor-particles', particleShader),
      this.checkedModule('varyloom-meteor-mask', maskShader),
      this.checkedModule('varyloom-meteor-image', imageShader),
    ]);
    const particlePipelineLayout = this.device.createPipelineLayout({ bindGroupLayouts: [this.particleLayout] });
    const imagePipelineLayout = this.device.createPipelineLayout({ bindGroupLayouts: [this.imageLayout] });
    const additiveTarget: GPUColorTargetState = {
      format: this.format,
      blend: {
        color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
        alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
      },
    };
    this.imagePipeline = await this.device.createRenderPipelineAsync({
      label: 'varyloom-meteor-image',
      layout: imagePipelineLayout,
      vertex: { module: imageModule, entryPoint: 'planeVertex' },
      fragment: { module: imageModule, entryPoint: 'planeFragment', targets: [{ format: this.format }] },
      primitive: { topology: 'triangle-list' },
    });
    this.particlePipeline = await this.device.createRenderPipelineAsync({
      label: 'varyloom-meteor-particles',
      layout: particlePipelineLayout,
      vertex: { module: particles, entryPoint: 'particleVertex' },
      fragment: { module: particles, entryPoint: 'particleFragment', targets: [additiveTarget] },
      primitive: { topology: 'triangle-list' },
    });
    this.headPipeline = await this.device.createRenderPipelineAsync({
      label: 'varyloom-meteor-heads',
      layout: particlePipelineLayout,
      vertex: { module: particles, entryPoint: 'headVertex' },
      fragment: { module: particles, entryPoint: 'headFragment', targets: [additiveTarget] },
      primitive: { topology: 'triangle-list' },
    });
    this.maskPipeline = await this.device.createRenderPipelineAsync({
      label: 'varyloom-meteor-mask',
      layout: particlePipelineLayout,
      vertex: { module: maskModule, entryPoint: 'maskVertex' },
      fragment: {
        module: maskModule,
        entryPoint: 'maskFragment',
        targets: [{
          format: 'rgba8unorm',
          blend: {
            color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
            alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
          },
        }],
      },
      primitive: { topology: 'triangle-list' },
    });
  }

  resize(width: number, height: number, dpr: number): void {
    const nextWidth = Math.max(1, Math.round(width * Math.min(dpr, 1.75)));
    const nextHeight = Math.max(1, Math.round(height * Math.min(dpr, 1.75)));
    this.dpr = Math.min(dpr, 1.75);
    this.aspect = nextWidth / nextHeight;
    if (this.canvas.width === nextWidth && this.canvas.height === nextHeight) return;
    this.canvas.width = nextWidth;
    this.canvas.height = nextHeight;
    if (this.device) this.recreateMask();
  }

  private recreateMask(): void {
    this.revealTexture?.destroy();
    this.revealTexture = this.device.createTexture({
      label: 'varyloom-meteor-persistent-reveal',
      size: [Math.max(1, Math.ceil(this.canvas.width * 0.55)), Math.max(1, Math.ceil(this.canvas.height * 0.55)), 1],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    this.maskNeedsClear = true;
    if (this.textures.length) this.setImagePair(this.fromIndex, this.toIndex);
  }

  private setImagePair(sourceIndex: number, targetIndex: number): void {
    if (!this.revealTexture) return;
    this.imageBindGroup = this.device.createBindGroup({
      label: `varyloom-meteor-pair-${sourceIndex}-${targetIndex}`,
      layout: this.imageLayout,
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer } },
        { binding: 1, resource: this.sampler },
        { binding: 2, resource: this.textures[sourceIndex].createView() },
        { binding: 3, resource: this.textures[targetIndex].createView() },
        { binding: 4, resource: this.revealTexture.createView() },
      ],
    });
  }

  private kernelResources(): {
    pos: KitBuffer;
    vel: KitBuffer;
    lifeState: KitBuffer;
    seeds: KitBuffer;
  } {
    return {
      pos: this.positionBuffer,
      vel: this.velocityBuffer,
      lifeState: this.metaBuffer,
      seeds: this.seedBuffer,
    };
  }

  prepare(fromIndex: number, toIndex: number, _direction: Direction): void {
    if (fromIndex === toIndex && this.transitioning) {
      this.transitioning = false;
      this.settle = 0;
      this.fromIndex = fromIndex;
      this.toIndex = toIndex;
      this.setImagePair(fromIndex, toIndex);
      return;
    }
    this.fromIndex = fromIndex;
    this.toIndex = toIndex;
    this.transitioning = fromIndex !== toIndex;
    this.elapsed = 0;
    this.settle = this.transitioning ? 0 : 1;
    this.lastProgress = 0;
    this.maskNeedsClear = true;
    if (this.transitioning) this.resetParticles();
    this.setImagePair(fromIndex, toIndex);
  }

  private writeUniforms(frame: TransitionFrame, running: boolean): void {
    const options = frame.options as MeteorWakeOptions;
    const sourceSize = this.imageSizes[this.fromIndex] || [1, 1];
    const targetSize = this.imageSizes[this.toIndex] || sourceSize;
    const values = new Float32Array([
      this.aspect, frame.progress, this.elapsed, frame.delta,
      this.canvas.width, this.canvas.height, this.dpr, options.imageFit === 'contain' ? 1 : 0,
      options.spread ?? 0.66, options.turbulence ?? 0.44, options.glow ?? 0.68, options.afterglow ?? 0.58,
      sourceSize[0], sourceSize[1], 0, 0,
      targetSize[0], targetSize[1], 0, 0,
      running ? 1 : 0, this.settle, this.particleCount, frame.duration,
    ]);
    this.device.queue.writeBuffer(this.uniformBuffer, 0, values);
  }

  async render(frame: TransitionFrame): Promise<void> {
    if (!this.imageBindGroup || !this.revealTexture) return;
    const options = frame.options as MeteorWakeOptions;
    const settling = !frame.active && this.settle < 1;
    const running = frame.active || settling;
    if (frame.active) {
      if (frame.progress + 0.0001 < this.lastProgress) {
        this.elapsed = frame.progress * MOTION_REFERENCE_DURATION;
      }
      const motionDt = Math.min(frame.delta * MOTION_REFERENCE_DURATION / Math.max(frame.duration, 0.001), 1 / 24);
      this.elapsed += motionDt;
      await updateKernel.run(this.kernelResources(), {
        dt: motionDt,
        progress: frame.progress,
        time: this.elapsed,
        aspect: this.aspect,
        spread: options.spread ?? 0.66,
        turbulence: options.turbulence ?? 0.44,
      });
    } else if (settling) {
      const linger = 0.65 + (options.afterglow ?? 0.58) * 1.05;
      this.settle = Math.min(1, this.settle + frame.delta / linger);
      const motionDt = Math.min(frame.delta, 1 / 24);
      this.elapsed += motionDt;
      await updateKernel.run(this.kernelResources(), {
        dt: motionDt,
        progress: 1,
        time: this.elapsed,
        aspect: this.aspect,
        spread: options.spread ?? 0.66,
        turbulence: options.turbulence ?? 0.44,
      });
    }
    this.lastProgress = frame.progress;
    this.writeUniforms(frame, running);

    const encoder = this.device.createCommandEncoder({ label: 'varyloom-meteor-frame' });
    if (frame.active || this.maskNeedsClear) {
      const maskPass = encoder.beginRenderPass({
        colorAttachments: [{
          view: this.revealTexture.createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          loadOp: this.maskNeedsClear ? 'clear' : 'load',
          storeOp: 'store',
        }],
      });
      if (frame.active) {
        maskPass.setPipeline(this.maskPipeline);
        maskPass.setBindGroup(0, this.particleBindGroup);
        maskPass.draw(6, WAKE_SEGMENTS * 3);
      }
      maskPass.end();
      this.maskNeedsClear = false;
    }

    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: this.context.getCurrentTexture().createView(),
        clearValue: { r: 0.004, g: 0.006, b: 0.012, a: 1 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });
    pass.setPipeline(this.imagePipeline);
    pass.setBindGroup(0, this.imageBindGroup);
    pass.draw(3);
    if (running) {
      pass.setBindGroup(0, this.particleBindGroup);
      pass.setPipeline(this.particlePipeline);
      pass.draw(6, this.particleCount);
      if (frame.active) {
        pass.setPipeline(this.headPipeline);
        pass.draw(6, 3);
      }
    }
    pass.end();
    this.device.queue.submit([encoder.finish()]);
  }

  destroy(): void {
    this.positionBuffer?.destroy();
    this.velocityBuffer?.destroy();
    this.metaBuffer?.destroy();
    this.seedBuffer?.destroy();
    this.uniformBuffer?.destroy();
    this.revealTexture?.destroy();
    this.textures.forEach((texture) => texture.destroy());
    this.context?.unconfigure();
    this.canvas.remove();
  }
}

export const meteorWakeTransition = defineTransition({
  name: 'meteor-wake',
  backend: 'webgpu',
  defaults: {
    spread: 0.66,
    turbulence: 0.44,
    glow: 0.68,
    afterglow: 0.58,
    particleCount: DEFAULT_PARTICLE_COUNT,
    imageFit: 'cover',
  },
  phaseEasing: 'none',
  supported: () => typeof navigator !== 'undefined' && Boolean(navigator.gpu),
  create: () => new MeteorWakeEffect(),
});
