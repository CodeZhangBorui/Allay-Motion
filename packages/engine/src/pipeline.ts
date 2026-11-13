// 帧管线（docs/02-engine.md 2.6）：子帧 → sceneRT（RGBA16F、线性、MSAA 4×、预乘 alpha）
// → 加法累积进 accumRT（RGBA16F）→ 全屏 resolve 着色器输出到 8 位目标。
import {
  AddEquation,
  BufferGeometry,
  CustomBlending,
  Float32BufferAttribute,
  GLSL3,
  HalfFloatType,
  Mesh,
  NearestFilter,
  NoBlending,
  OneFactor,
  OrthographicCamera,
  RawShaderMaterial,
  RGBAFormat,
  Scene,
  UnsignedByteType,
  Vector3,
  WebGLRenderTarget,
  type Camera,
  type Texture,
  type WebGLRenderer,
} from 'three';

/** resolve 的三种模式 */
export type ResolveMode = 'preview' | 'straight' | 'opaque';
const MODE_CODE: Record<ResolveMode, number> = { preview: 0, straight: 1, opaque: 2 };

const VERTEX = /* glsl */ `
in vec3 position;
void main() {
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

// 把子帧按权重 1/N 加进 accumRT（混合方式是 ONE, ONE）
const ACCUMULATE = /* glsl */ `
precision highp float;
precision highp sampler2D;
uniform sampler2D tSrc;
uniform float uWeight;
out highp vec4 fragColor;
void main() {
  fragColor = texelFetch(tSrc, ivec2(gl_FragCoord.xy), 0) * uWeight;
}`;

// 源缓冲是线性、预乘 alpha。
// 预览：反预乘 → 线性转 sRGB → 再预乘（canvas 是 premultipliedAlpha: true）。
// 导出（透明）：反预乘 rgb / max(a, 1e-5) → 线性转 sRGB，输出直通 alpha。
// 导出（不透明）：在线性空间盖到底色上 → 转 sRGB，alpha 写 1。
// uFlipY 为真时采样翻转 v，这样 readPixels 读出的第一行就是画面顶部，CPU 不用再翻。
const RESOLVE = /* glsl */ `
precision highp float;
precision highp sampler2D;
uniform sampler2D tSrc;
uniform int uMode;
uniform bool uFlipY;
uniform vec3 uBackground;
out highp vec4 fragColor;

vec3 linearToSrgb(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  vec3 lo = c * 12.92;
  vec3 hi = 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055;
  return mix(lo, hi, step(vec3(0.0031308), c));
}

void main() {
  ivec2 size = textureSize(tSrc, 0);
  ivec2 p = ivec2(gl_FragCoord.xy);
  if (uFlipY) p.y = size.y - 1 - p.y;
  vec4 c = texelFetch(tSrc, p, 0);
  float a = clamp(c.a, 0.0, 1.0);
  if (uMode == 2) {
    fragColor = vec4(linearToSrgb(c.rgb + uBackground * (1.0 - a)), 1.0);
    return;
  }
  vec3 srgb = linearToSrgb(c.rgb / max(a, 1e-5));
  fragColor = uMode == 0 ? vec4(srgb * a, a) : vec4(srgb, a);
}`;

function fullscreenTriangle(): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  return g;
}

function halfFloatTarget(width: number, height: number, samples: number, depth: boolean): WebGLRenderTarget {
  const rt = new WebGLRenderTarget(width, height, {
    type: HalfFloatType,
    format: RGBAFormat,
    samples,
    depthBuffer: depth,
    stencilBuffer: false,
    generateMipmaps: false,
    minFilter: NearestFilter,
    magFilter: NearestFilter,
  });
  return rt;
}

export interface PipelineRenderOptions {
  scene: Scene;
  camera: Camera;
  /** 子帧时间；长度就是 N */
  times: readonly number[];
  /** 在每个子帧前调用（模板的 update） */
  update(t: number): void;
}

export class FramePipeline {
  private width: number;
  private height: number;
  private sceneRT: WebGLRenderTarget;
  private accumRT: WebGLRenderTarget;
  private outRT: WebGLRenderTarget | null = null;

  private readonly passScene = new Scene();
  private readonly passCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly passMesh: Mesh;
  private readonly accumulate: RawShaderMaterial;
  private readonly resolve: RawShaderMaterial;

  constructor(
    private readonly renderer: WebGLRenderer,
    width: number,
    height: number,
    private readonly withOutputTarget: boolean,
  ) {
    this.width = width;
    this.height = height;
    this.sceneRT = halfFloatTarget(width, height, 4, true);
    this.accumRT = halfFloatTarget(width, height, 0, false);
    if (withOutputTarget) this.outRT = this.makeOutputTarget();

    this.accumulate = new RawShaderMaterial({
      glslVersion: GLSL3,
      vertexShader: VERTEX,
      fragmentShader: ACCUMULATE,
      uniforms: { tSrc: { value: null }, uWeight: { value: 1 } },
      blending: CustomBlending,
      blendEquation: AddEquation,
      blendSrc: OneFactor,
      blendDst: OneFactor,
      blendEquationAlpha: AddEquation,
      blendSrcAlpha: OneFactor,
      blendDstAlpha: OneFactor,
      depthTest: false,
      depthWrite: false,
    });
    this.resolve = new RawShaderMaterial({
      glslVersion: GLSL3,
      vertexShader: VERTEX,
      fragmentShader: RESOLVE,
      uniforms: {
        tSrc: { value: null },
        uMode: { value: 0 },
        uFlipY: { value: false },
        uBackground: { value: new Vector3() },
      },
      blending: NoBlending,
      depthTest: false,
      depthWrite: false,
    });
    this.passMesh = new Mesh(fullscreenTriangle(), this.accumulate);
    this.passMesh.frustumCulled = false;
    this.passScene.add(this.passMesh);
  }

  get size(): { width: number; height: number } {
    return { width: this.width, height: this.height };
  }

  setSize(width: number, height: number): void {
    if (width === this.width && height === this.height) return;
    this.width = width;
    this.height = height;
    this.sceneRT.setSize(width, height);
    this.accumRT.setSize(width, height);
    this.outRT?.setSize(width, height);
  }

  /** 渲染所有子帧，返回存着线性、预乘 alpha 结果的纹理 */
  private renderSubframes(opts: PipelineRenderOptions): Texture {
    const { renderer } = this;
    const n = opts.times.length;
    renderer.setClearColor(0x000000, 0);

    if (n === 1) {
      opts.update(opts.times[0]!);
      renderer.setRenderTarget(this.sceneRT);
      renderer.clear(true, true, false);
      renderer.render(opts.scene, opts.camera);
      return this.sceneRT.texture;
    }

    renderer.setRenderTarget(this.accumRT);
    renderer.clear(true, false, false);
    this.accumulate.uniforms.tSrc!.value = this.sceneRT.texture;
    this.accumulate.uniforms.uWeight!.value = 1 / n;
    for (let k = 0; k < n; k++) {
      opts.update(opts.times[k]!);
      renderer.setRenderTarget(this.sceneRT);
      renderer.clear(true, true, false);
      renderer.render(opts.scene, opts.camera);

      renderer.setRenderTarget(this.accumRT);
      this.passMesh.material = this.accumulate;
      renderer.render(this.passScene, this.passCamera);
    }
    return this.accumRT.texture;
  }

  private runResolve(source: Texture, mode: ResolveMode, flipY: boolean, background: readonly [number, number, number]): void {
    const u = this.resolve.uniforms;
    u.tSrc!.value = source;
    u.uMode!.value = MODE_CODE[mode];
    u.uFlipY!.value = flipY;
    (u.uBackground!.value as Vector3).set(background[0], background[1], background[2]);
    this.passMesh.material = this.resolve;
    this.renderer.render(this.passScene, this.passCamera);
  }

  /** 预览：画到 canvas（默认帧缓冲） */
  renderToCanvas(opts: PipelineRenderOptions): void {
    const autoClear = this.renderer.autoClear;
    this.renderer.autoClear = false;
    try {
      const source = this.renderSubframes(opts);
      this.renderer.setRenderTarget(null);
      this.runResolve(source, 'preview', false, [0, 0, 0]);
    } finally {
      this.renderer.autoClear = autoClear;
    }
  }

  /**
   * 导出：resolve 到 8 位目标并读回。返回直通 alpha（或不透明）的 RGBA8，第一行是画面顶部。
   * background 是线性 RGB，只在 opaque 模式下用。
   */
  renderToPixels(opts: PipelineRenderOptions, mode: Exclude<ResolveMode, 'preview'>, background: readonly [number, number, number]): Uint8Array<ArrayBuffer> {
    if (!this.outRT) throw new Error('this pipeline has no output target');
    const autoClear = this.renderer.autoClear;
    this.renderer.autoClear = false;
    try {
      const source = this.renderSubframes(opts);
      this.renderer.setRenderTarget(this.outRT);
      this.runResolve(source, mode, true, background);
      const pixels = new Uint8Array(this.width * this.height * 4);
      this.renderer.readRenderTargetPixels(this.outRT, 0, 0, this.width, this.height, pixels);
      return pixels;
    } finally {
      this.renderer.setRenderTarget(null);
      this.renderer.autoClear = autoClear;
    }
  }

  private makeOutputTarget(): WebGLRenderTarget {
    return new WebGLRenderTarget(this.width, this.height, {
      type: UnsignedByteType,
      format: RGBAFormat,
      depthBuffer: false,
      stencilBuffer: false,
      generateMipmaps: false,
      minFilter: NearestFilter,
      magFilter: NearestFilter,
    });
  }

  dispose(): void {
    this.sceneRT.dispose();
    this.accumRT.dispose();
    this.outRT?.dispose();
    this.accumulate.dispose();
    this.resolve.dispose();
    this.passMesh.geometry.dispose();
  }
}
