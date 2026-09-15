import type { LoadedImage } from '../types';

export const fullScreenVertexShader = `#version 300 es
precision highp float;

const vec2 POSITIONS[3] = vec2[3](
  vec2(-1.0, -1.0),
  vec2(3.0, -1.0),
  vec2(-1.0, 3.0)
);

out vec2 vUv;

void main() {
  vec2 position = POSITIONS[gl_VertexID];
  vUv = position * 0.5 + 0.5;
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

function compileShader(
  gl: WebGL2RenderingContext,
  type: number,
  source: string,
): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('Unable to create WebGL2 shader.');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) || 'WebGL2 shader compilation failed.';
    gl.deleteShader(shader);
    throw new Error(message);
  }
  return shader;
}

export function createWebGL2Program(
  gl: WebGL2RenderingContext,
  fragmentShader: string,
): WebGLProgram {
  const program = gl.createProgram();
  if (!program) throw new Error('Unable to create WebGL2 program.');
  const vertex = compileShader(gl, gl.VERTEX_SHADER, fullScreenVertexShader);
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, fragmentShader);
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(program) || 'WebGL2 program linking failed.';
    gl.deleteProgram(program);
    throw new Error(message);
  }
  return program;
}

export function createWebGL2Texture(
  gl: WebGL2RenderingContext,
  item: LoadedImage,
): WebGLTexture {
  const texture = gl.createTexture();
  if (!texture) throw new Error('Unable to create WebGL2 texture.');
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    item.source,
  );
  return texture;
}

export function bindWebGL2Texture(
  gl: WebGL2RenderingContext,
  texture: WebGLTexture,
  unit: number,
  location: WebGLUniformLocation | null,
): void {
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.uniform1i(location, unit);
}

export type AxisDirection = 'auto' | 'right' | 'left' | 'down' | 'up';

export function resolveAxis(
  direction: AxisDirection | undefined,
  navigationDirection: -1 | 1,
): [number, number] {
  const resolved = direction && direction !== 'auto'
    ? direction
    : navigationDirection > 0 ? 'right' : 'left';
  return {
    right: [1, 0] as [number, number],
    left: [-1, 0] as [number, number],
    down: [0, -1] as [number, number],
    up: [0, 1] as [number, number],
  }[resolved];
}

export function resolveDirectionIndex(
  direction: AxisDirection | undefined,
  navigationDirection: -1 | 1,
): number {
  const axis = resolveAxis(direction, navigationDirection);
  if (axis[0] > 0) return 0;
  if (axis[0] < 0) return 1;
  if (axis[1] < 0) return 2;
  return 3;
}
