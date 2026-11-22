import { RUNOFF_FRAGMENT_SHADER } from '../src/renderer';

const result = document.querySelector<HTMLElement>('#result')!;
const canvas = document.createElement('canvas');
canvas.width = 1;
canvas.height = 1;
const gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: false });

function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function compile(type: number, source: string): WebGLShader {
  const shader = gl!.createShader(type)!;
  gl!.shaderSource(shader, source);
  gl!.compileShader(shader);
  check(gl!.getShaderParameter(shader, gl!.COMPILE_STATUS), gl!.getShaderInfoLog(shader) ?? 'Shader compilation failed.');
  return shader;
}

function close(actual: number, expected: number, message: string): void {
  check(Math.abs(actual - expected) <= 2, `${message}: expected ${expected}, got ${actual}`);
}

try {
  check(Boolean(gl), 'WebGL 2 is unavailable.');
  const vertex = compile(gl!.VERTEX_SHADER, `#version 300 es
precision highp float;
out highp vec3 v_color;
out highp vec2 v_world;
void main(){ vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2); gl_Position=vec4(p*2.0-1.0,0.0,1.0); v_world=p; v_color=vec3(1.0,0.302,0.161); }
`);
  const fragment = compile(gl!.FRAGMENT_SHADER, RUNOFF_FRAGMENT_SHADER);
  const program = gl!.createProgram()!;
  gl!.attachShader(program, vertex);
  gl!.attachShader(program, fragment);
  gl!.linkProgram(program);
  check(gl!.getProgramParameter(program, gl!.LINK_STATUS), gl!.getProgramInfoLog(program) ?? 'Program link failed.');

  const colorTarget = gl!.createTexture()!;
  gl!.bindTexture(gl!.TEXTURE_2D, colorTarget);
  gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MIN_FILTER, gl!.NEAREST);
  gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MAG_FILTER, gl!.NEAREST);
  gl!.texImage2D(gl!.TEXTURE_2D, 0, gl!.RGBA8, 1, 1, 0, gl!.RGBA, gl!.UNSIGNED_BYTE, null);
  const framebuffer = gl!.createFramebuffer()!;
  gl!.bindFramebuffer(gl!.FRAMEBUFFER, framebuffer);
  gl!.framebufferTexture2D(gl!.FRAMEBUFFER, gl!.COLOR_ATTACHMENT0, gl!.TEXTURE_2D, colorTarget, 0);
  check(gl!.checkFramebufferStatus(gl!.FRAMEBUFFER) === gl!.FRAMEBUFFER_COMPLETE, 'Could not create test framebuffer.');

  const makeTexture = (rgba: [number, number, number, number]): WebGLTexture => {
    const texture = gl!.createTexture()!;
    gl!.bindTexture(gl!.TEXTURE_2D, texture);
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MIN_FILTER, gl!.NEAREST);
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MAG_FILTER, gl!.NEAREST);
    gl!.texImage2D(gl!.TEXTURE_2D, 0, gl!.RGBA8, 1, 1, 0, gl!.RGBA, gl!.UNSIGNED_BYTE, new Uint8Array(rgba));
    return texture;
  };
  const mask = makeTexture([255, 0, 0, 255]);
  const halfMask = makeTexture([128, 0, 0, 255]);
  const ao = makeTexture([128, 128, 128, 255]);
  gl!.useProgram(program);
  gl!.uniform1i(gl!.getUniformLocation(program, 'u_maskOnly'), 0);
  gl!.uniform1i(gl!.getUniformLocation(program, 'u_hasPaintMask'), 1);
  gl!.uniform1i(gl!.getUniformLocation(program, 'u_paintMask'), 0);
  gl!.uniform1i(gl!.getUniformLocation(program, 'u_aoMap'), 1);
  gl!.uniform1i(gl!.getUniformLocation(program, 'u_hasAoMap'), 0);
  gl!.uniform1i(gl!.getUniformLocation(program, 'u_applySurfaceMaterial'), 1);
  gl!.uniform1f(gl!.getUniformLocation(program, 'u_surfaceAoStrength'), 0.14);
  gl!.activeTexture(gl!.TEXTURE1);
  gl!.bindTexture(gl!.TEXTURE_2D, ao);
  gl!.activeTexture(gl!.TEXTURE0);
  gl!.bindTexture(gl!.TEXTURE_2D, mask);
  gl!.viewport(0, 0, 1, 1);

  const paint = [255, 77, 41];
  const under = [32, 64, 96];
  const read = (): Uint8Array => {
    const pixel = new Uint8Array(4);
    gl!.readPixels(0, 0, 1, 1, gl!.RGBA, gl!.UNSIGNED_BYTE, pixel);
    return pixel;
  };
  const draw = (maskTexture: WebGLTexture, hasAo: boolean): Uint8Array => {
    gl!.activeTexture(gl!.TEXTURE0);
    gl!.bindTexture(gl!.TEXTURE_2D, maskTexture);
    gl!.uniform1i(gl!.getUniformLocation(program, 'u_hasAoMap'), hasAo ? 1 : 0);
    gl!.clearColor(under[0] / 255, under[1] / 255, under[2] / 255, 1);
    gl!.clear(gl!.COLOR_BUFFER_BIT);
    gl!.enable(gl!.BLEND);
    gl!.blendFuncSeparate(gl!.SRC_ALPHA, gl!.ONE_MINUS_SRC_ALPHA, gl!.ONE, gl!.ONE_MINUS_SRC_ALPHA);
    gl!.drawArrays(gl!.TRIANGLES, 0, 3);
    gl!.disable(gl!.BLEND);
    return read();
  };

  for (const hasAo of [false, true]) {
    const expectedPaint = hasAo ? paint.map((value) => Math.round(value * (1 - 0.14 * (1 - 128 / 255)))) : paint;
    const full = draw(mask, hasAo);
    expectedPaint.forEach((channel, index) => close(full[index], channel, `Full mask, AO ${hasAo}, channel ${index}`));
    close(full[3], 255, `Full mask alpha, AO ${hasAo}`);

    const partial = draw(halfMask, hasAo);
    const coverage = 128 / 255;
    expectedPaint.forEach((channel, index) => {
      close(partial[index], Math.round(channel * coverage + under[index] * (1 - coverage)), `Half mask, AO ${hasAo}, channel ${index}`);
    });
    close(partial[3], 255, `Half mask alpha over opaque surface, AO ${hasAo}`);
  }
  result.textContent = 'PASS: actual runoff shader preserves paint RGB at full coverage and source-over composites mask coverage with AO on or off.';
} catch (error) {
  result.textContent = `FAIL: ${error instanceof Error ? error.message : String(error)}`;
  throw error;
}
