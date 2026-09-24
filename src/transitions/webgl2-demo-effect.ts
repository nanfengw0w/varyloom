import type {
  Direction,
  LoadedImage,
  TransitionDefinition,
  TransitionEffect,
  TransitionEffectContext,
  TransitionFrame,
} from '../types';
import {
  bindWebGL2Texture,
  createWebGL2Program,
  createWebGL2Texture,
} from './webgl2-utils';

export interface DemoShaderRenderContext {
  gl: WebGL2RenderingContext;
  locations: Readonly<Record<string, WebGLUniformLocation | null>>;
  frame: TransitionFrame;
  direction: Direction;
}

export interface DemoShaderTransitionConfig {
  name: string;
  fragmentShader: string;
  defaults: Record<string, unknown>;
  uniforms: readonly string[];
  phaseEasing?: string;
  renderUniforms(context: DemoShaderRenderContext): void;
}

class DemoShaderEffect implements TransitionEffect {
  readonly canvas = document.createElement('canvas');
  private gl!: WebGL2RenderingContext;
  private program!: WebGLProgram;
  private vao: WebGLVertexArrayObject | null = null;
  private items: LoadedImage[] = [];
  private textures: WebGLTexture[] = [];
  private fromIndex = 0;
  private toIndex = 0;
  private direction: Direction = 1;
  private width = 1;
  private height = 1;
  private locations: Record<string, WebGLUniformLocation | null> = {};

  constructor(private readonly config: DemoShaderTransitionConfig) {}

  init(context: TransitionEffectContext): void {
    const gl = this.canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
      powerPreference: 'high-performance',
    });
    if (!gl) throw new Error(`WebGL2 is required for the ${this.config.name} transition.`);
    this.gl = gl;
    this.items = context.items;
    this.program = createWebGL2Program(gl, this.config.fragmentShader);
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    const names = [
      'uOld', 'uNew', 'uViewport', 'uOldSize', 'uNewSize', 'uProgress',
      'uCover', 'uDebug', 'uTime', ...this.config.uniforms,
    ];
    this.locations = Object.fromEntries(
      [...new Set(names)].map((name) => [name, gl.getUniformLocation(this.program, name)]),
    );
    this.textures = this.items.map((item) => createWebGL2Texture(gl, item));
    context.host.appendChild(this.canvas);
    this.resize(context.width, context.height, context.dpr);
  }

  prepare(fromIndex: number, toIndex: number, direction: Direction): void {
    this.fromIndex = fromIndex;
    this.toIndex = toIndex;
    this.direction = direction;
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
    const gl = this.gl;
    const oldItem = this.items[this.fromIndex];
    const newItem = this.items[this.toIndex];
    gl.viewport(0, 0, this.width, this.height);
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    bindWebGL2Texture(gl, this.textures[this.fromIndex], 0, this.locations.uOld);
    bindWebGL2Texture(gl, this.textures[this.toIndex], 1, this.locations.uNew);
    gl.uniform2f(this.locations.uViewport, this.width, this.height);
    gl.uniform2f(this.locations.uOldSize, oldItem.width, oldItem.height);
    gl.uniform2f(this.locations.uNewSize, newItem.width, newItem.height);
    gl.uniform1f(this.locations.uProgress, frame.progress);
    gl.uniform1f(this.locations.uCover, frame.options.imageFit === 'cover' ? 1 : 0);
    gl.uniform1f(this.locations.uDebug, 0);
    gl.uniform1f(this.locations.uTime, frame.time);
    this.config.renderUniforms({ gl, locations: this.locations, frame, direction: this.direction });
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  destroy(): void {
    this.textures.forEach((texture) => this.gl.deleteTexture(texture));
    if (this.vao) this.gl.deleteVertexArray(this.vao);
    if (this.program) this.gl.deleteProgram(this.program);
    this.canvas.remove();
  }
}

export function createDemoShaderTransition(
  config: DemoShaderTransitionConfig,
): TransitionDefinition {
  return {
    name: config.name,
    backend: 'webgl2',
    defaults: config.defaults,
    phaseEasing: config.phaseEasing ?? 'none',
    supported: () => typeof WebGL2RenderingContext !== 'undefined',
    create: () => new DemoShaderEffect(config),
  };
}
