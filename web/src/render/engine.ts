export interface DriftDataPoint {
  serviceId: number;
  timestamp: number;
  jitter: number;
  drift: number;
}

export class HeatmapRenderEngine {
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private buffers: {
    position: WebGLBuffer;
    color: WebGLBuffer;
    instance: WebGLBuffer;
  };
  private attributeLocations: {
    position: number;
    offset: number;
    color: number;
  };
  private uniformLocations: {
    projectionMatrix: WebGLUniformLocation;
    viewMatrix: WebGLUniformLocation;
  };

  constructor(canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { antialias: true, alpha: false });
    if (!gl) {
      throw new Error('WebGL2 not supported');
    }
    this.gl = gl;
    this.program = this.initShaderProgram();
    this.buffers = this.initBuffers();
    this.attributeLocations = {
      position: gl.getAttribLocation(this.program, 'aVertexPosition'),
      offset: gl.getAttribLocation(this.program, 'aInstanceOffset'),
      color: gl.getAttribLocation(this.program, 'aInstanceColor'),
    };
    this.uniformLocations = {
      projectionMatrix: gl.getUniformLocation(this.program, 'uProjectionMatrix')!,
      viewMatrix: gl.getUniformLocation(this.program, 'uViewMatrix')!,
    };
  }

  private initShaderProgram(): WebGLProgram {
    const vsSource = `#version 300 es
      in vec4 aVertexPosition;
      in vec3 aInstanceOffset;
      in vec4 aInstanceColor;
      uniform mat4 uModelViewMatrix;
      uniform mat4 uProjectionMatrix;
      uniform mat4 uViewMatrix;
      out lowp vec4 vColor;
      void main(void) {
        vec4 pos = aVertexPosition + vec4(aInstanceOffset, 0.0);
        gl_Position = uProjectionMatrix * uViewMatrix * pos;
        vColor = aInstanceColor;
      }`;

    const fsSource = `#version 300 es
      precision mediump float;
      in lowp vec4 vColor;
      out vec4 fragColor;
      void main(void) {
        fragColor = vColor;
      }`;

    const vertexShader = this.loadShader(this.gl.VERTEX_SHADER, vsSource);
    const fragmentShader = this.loadShader(this.gl.FRAGMENT_SHADER, fsSource);

    const shaderProgram = this.gl.createProgram()!;
    this.gl.attachShader(shaderProgram, vertexShader);
    this.gl.attachShader(shaderProgram, fragmentShader);
    this.gl.linkProgram(shaderProgram);

    if (!this.gl.getProgramParameter(shaderProgram, this.gl.LINK_STATUS)) {
      throw new Error('Unable to initialize shader program');
    }
    return shaderProgram;
  }

  private loadShader(type: number, source: string): WebGLShader {
    const shader = this.gl.createShader(type)!;
    this.gl.shaderSource(shader, source);
    this.gl.compileShader(shader);
    if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) {
      const info = this.gl.getShaderInfoLog(shader);
      this.gl.deleteShader(shader);
      throw new Error('An error occurred compiling the shaders: ' + info);
    }
    return shader;
  }

  private initBuffers() {
    const gl = this.gl;
    // Cube vertices for the heatmap bars
    const positions = [
      -0.5,  0.5,  0.5,  0.5,  0.5,  0.5, -0.5, -0.5,  0.5,  0.5, -0.5,  0.5,
      -0.5,  0.5, -0.5,  0.5,  0.5, -0.5, -0.5, -0.5, -0.5,  0.5, -0.5, -0.5,
    ];
    const positionBuffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.STATIC_DRAW);

    return {
      position: positionBuffer,
      color: gl.createBuffer()!,
      instance: gl.createBuffer()!,
    };
  }

  public render(data: DriftDataPoint[], projectionMatrix: Float32Array, viewMatrix: Float32Array) {
    const gl = this.gl;
    const count = data.length;

    const offsets = new Float32Array(count * 3);
    const colors = new Float32Array(count * 4);

    data.forEach((point, i) => {
      // X: Service Index, Y: Jitter (Height), Z: Timestamp
      offsets[i * 3] = point.serviceId * 1.5;
      offsets[i * 3 + 1] = point.jitter * 0.1; 
      offsets[i * 3 + 2] = (point.timestamp % 10000) * 0.01;

      // Color mapping: Intensity of drift (Red = high drift, Blue = stable)
      const intensity = Math.min(Math.abs(point.drift) / 50, 1.0);
      colors[i * 4] = intensity;     // R
      colors[i * 4 + 1] = 1 - intensity; // G
      colors[i * 4 + 2] = 0.5;       // B
      colors[i * 4 + 3] = 1.0;       // A
    });

    gl.clearColor(0.05, 0.05, 0.1, 1.0);
    gl.clearDepth(1.0);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    gl.useProgram(this.program);

    gl.uniformMatrix4fv(this.uniformLocations.projectionMatrix, false, projectionMatrix);
    gl.uniformMatrix4fv(this.uniformLocations.viewMatrix, false, viewMatrix);

    // Bind cube geometry
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.position);
    gl.vertexAttribPointer(this.attributeLocations.position, 3, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(this.attributeLocations.position);

    // Bind Instance Offsets
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.instance);
    gl.bufferData(gl.ARRAY_BUFFER, offsets, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(this.attributeLocations.offset);
    gl.vertexAttribPointer(this.attributeLocations.offset, 3, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(this.attributeLocations.offset, 1);

    // Bind Instance Colors
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.color);
    gl.bufferData(gl.ARRAY_BUFFER, colors, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(this.attributeLocations.color);
    gl.vertexAttribPointer(this.attributeLocations.color, 4, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(this.attributeLocations.color, 1);

    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 8, count);
  }

  public resize(width: number, height: number) {
    this.gl.viewport(0, 0, width, height);
  }
}