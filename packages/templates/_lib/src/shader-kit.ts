// 全屏着色器模板的公用部分（第 4 批，docs/templates/batch-4.md）：铺满舞台的着色器四边形、公用的 GLSL 片段、
// 带动画的贴图在自定义着色器里取当前帧、参数的颜色。只用 ctx 给的东西；不含任何模板自己的数值。
//
// 颜色与 alpha 的约定（docs/02-engine.md 2.6、docs/05-export.md 5.4）：画面缓冲是线性、预乘 alpha 的，
// 材质保持 Three 默认的 NormalBlending，所以片元着色器输出的是**直通**的颜色和 alpha（不要自己乘 alpha）。
// 一个着色器里叠几层时，先在预乘空间里用 over() 合成，最后用 straight() 换回直通，半透明边缘才不会发黑或发亮。
// 参数里的颜色交给 THREE.Color 换成线性值再当 uniform；贴图按 sRGB 解码，取出来就是线性值。
//
// 不设 glslVersion：Three 在 WebGL2 上照样按 GLSL ES 3.00 编译，textureGrad、texelFetch、textureSize、uint 都能用
// （docs/decisions.md M6a）。
import type { ParamValue, SetupContext } from '@allay/template-sdk';

type Three = SetupContext['THREE'];
type Texture = InstanceType<Three['Texture']>;
type Vector2 = InstanceType<Three['Vector2']>;
type Mesh = InstanceType<Three['Mesh']>;
type ShaderMaterial = InstanceType<Three['ShaderMaterial']>;
type Color = InstanceType<Three['Color']>;

export interface Uniform<T = unknown> {
  value: T;
}
export type Uniforms = Record<string, Uniform>;

/**
 * 公用的顶点着色器：vUv 是四边形的 0–1 坐标，vPos 是舞台坐标（设计单位，原点在中心、+y 向上），
 * 四边形的位置和大小跟着 mesh 变（全屏四边形就是整个舞台）。
 */
export const VERTEX = /* glsl */ `
uniform vec2 uStage;
varying vec2 vUv;
varying vec2 vPos;
void main() {
  vUv = uv;
  vPos = (uv - 0.5) * uStage;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

/**
 * 整数散列、带种子的值噪声和分形噪声。只用整数运算做散列，同一台机器上逐位可复现；
 * 种子从 uniform 来（float 形式的整数，`uint(uSeed)`），不用时间。
 */
export const GLSL_NOISE = /* glsl */ `
uint hashU(uint x) {
  x ^= x >> 16u; x *= 0x7feb352du;
  x ^= x >> 15u; x *= 0x846ca68bu;
  x ^= x >> 16u;
  return x;
}
uint hashU(uvec2 v) { return hashU(v.x ^ hashU(v.y)); }
uint hashU(uvec3 v) { return hashU(v.x ^ hashU(v.y ^ hashU(v.z))); }
/** [0, 1) */
float hashF(uint h) { return float(h >> 8u) * (1.0 / 16777216.0); }
// 负的整数先挪到正数再转 uint（负数转 uint 在 GLSL ES 里没有规定），坐标范围是 ±2^20 格
float rand1(int i, uint seed) { return hashF(hashU(uvec2(uint(i + 1048576), seed))); }
float rand2(ivec2 c, uint seed) { return hashF(hashU(uvec3(uvec2(c + 1048576), seed))); }
float rand3(ivec3 c, uint seed) { ivec3 k = c + 1048576; return hashF(hashU(uvec3(uint(k.x), uint(k.y) ^ hashU(uint(k.z)), seed))); }
/** 值噪声，[0, 1]，格点间做三次插值 */
float vnoise(vec2 p, uint seed) {
  vec2 i = floor(p);
  vec2 f = p - i;
  vec2 u = f * f * (3.0 - 2.0 * f);
  ivec2 c = ivec2(i);
  float a = rand2(c, seed);
  float b = rand2(c + ivec2(1, 0), seed);
  float d = rand2(c + ivec2(0, 1), seed);
  float e = rand2(c + ivec2(1, 1), seed);
  return mix(mix(a, b, u.x), mix(d, e, u.x), u.y);
}
/** 一维值噪声，[0, 1] */
float vnoise1(float x, uint seed) {
  float i = floor(x);
  float f = x - i;
  float u = f * f * (3.0 - 2.0 * f);
  return mix(rand1(int(i), seed), rand1(int(i) + 1, seed), u);
}
/** 四层分形噪声，[0, 1] */
float fbm(vec2 p, uint seed) {
  float s = 0.0;
  float w = 0.5;
  for (int k = 0; k < 4; k++) {
    s += w * vnoise(p, seed + uint(k) * 7919u);
    p = p * 2.03 + vec2(17.3, -9.1);
    w *= 0.5;
  }
  return s / 0.9375;
}
`;

/** 预乘空间里的合成、换回直通，以及常用的小工具 */
export const GLSL_COMPOSITE = /* glsl */ `
/** 直通颜色 + alpha → 预乘 */
vec4 pm(vec3 c, float a) { return vec4(c * a, a); }
/** 预乘空间：top 盖在 bottom 上 */
vec4 over(vec4 top, vec4 bottom) { return top + bottom * (1.0 - top.a); }
/** 预乘 → 直通（输出给 gl_FragColor 用） */
vec4 straight(vec4 p) { return p.a > 1e-6 ? vec4(p.rgb / p.a, p.a) : vec4(0.0); }
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
/** 把坐标吸附到 px 大小的格子中心（像素画的边） */
vec2 snapTo(vec2 p, float px) { return (floor(p / px) + 0.5) * px; }
float snapTo(float x, float px) { return (floor(x / px) + 0.5) * px; }
mat2 rot2(float a) { float c = cos(a), s = sin(a); return mat2(c, s, -s, c); }
`;

/**
 * 带动画的贴图（.mcmeta）在自定义着色器里取当前帧：引擎每个子帧在调用 update(t) 之前改好贴图的 offset / repeat
 * （当前帧在整张图里的位置和大小，docs/02-engine.md 2.8），uniform 直接引用这两个 Vector2（只读，不改它们）。
 * 没有动画的贴图 offset = (0, 0)、repeat = (1, 1)，同一段代码照样成立。
 *
 * tileFrame：按连续坐标 p 平铺当前帧（一格 = p 的一个单位），导数用连续坐标的（textureGrad，docs/decisions.md M6a），
 * 并把格内坐标收进半个纹素，最近邻采样时不会取到相邻那一帧。
 * frameAt：在当前帧里取 0–1 坐标 f 处（f 不平铺，超出时钳到边上）。
 */
export const GLSL_FRAME = /* glsl */ `
vec2 frameInset(sampler2D tex, vec2 rep, vec2 f) {
  vec2 texels = max(rep * vec2(textureSize(tex, 0)), vec2(1.0));
  return clamp(f, 0.5 / texels, 1.0 - 0.5 / texels);
}
vec4 tileFrame(sampler2D tex, vec2 off, vec2 rep, vec2 p) {
  vec2 f = frameInset(tex, rep, fract(p));
  return textureGrad(tex, off + f * rep, dFdx(p) * rep, dFdy(p) * rep);
}
vec4 frameAt(sampler2D tex, vec2 off, vec2 rep, vec2 f) {
  return texture2D(tex, off + frameInset(tex, rep, f) * rep);
}
/**
 * 平铺的双线性采样（四次 texelFetch 自己插值）：引擎缓存里的贴图放大时是最近邻，不能改它的过滤方式；
 * 要平滑的地方（附魔光效这类游戏里本来就是线性过滤的贴图）用它。uv 按整张图平铺，不管动画帧。
 */
vec4 bilerpRepeat(sampler2D tex, vec2 uv) {
  vec2 size = vec2(textureSize(tex, 0));
  vec2 q = uv * size - 0.5;
  vec2 i = floor(q);
  vec2 f = q - i;
  ivec2 a = ivec2(mod(i, size));
  ivec2 b = ivec2(mod(i + 1.0, size));
  vec4 c00 = texelFetch(tex, a, 0);
  vec4 c10 = texelFetch(tex, ivec2(b.x, a.y), 0);
  vec4 c01 = texelFetch(tex, ivec2(a.x, b.y), 0);
  vec4 c11 = texelFetch(tex, b, 0);
  return mix(mix(c00, c10, f.x), mix(c01, c11, f.x), f.y);
}
`;

/** 上面三段拼在一起（大多数模板都要），加上舞台宽高 uStage（shaderQuad 自动给） */
export const GLSL_COMMON = `uniform vec2 uStage;
${GLSL_NOISE}${GLSL_COMPOSITE}${GLSL_FRAME}`;

/** 贴图当前帧的两个 uniform：有贴图时引用它的 offset / repeat，没有时是整张图 */
export function frameUniforms(ctx: SetupContext, texture: Texture | null): { off: Uniform<Vector2>; rep: Uniform<Vector2> } {
  const { THREE } = ctx;
  return { off: { value: texture ? texture.offset : new THREE.Vector2(0, 0) }, rep: { value: texture ? texture.repeat : new THREE.Vector2(1, 1) } };
}

/** 参数里的颜色（#RRGGBB 或 #RRGGBBAA，丢掉 alpha）→ 线性的 THREE.Color；不合法时用 fallback */
export function linearColor(ctx: SetupContext, v: ParamValue | undefined, fallback: string): Color {
  const hex = typeof v === 'string' && /^#[0-9a-fA-F]{6}/.test(v) ? v.slice(0, 7) : fallback;
  return new ctx.THREE.Color(hex);
}

/**
 * 输出的一个像素是多少设计单位（预览、缩略图的分辨率比导出低，一个像素就更大）。软边、抗锯齿的宽度按它算，
 * 首末帧和剪辑点的“全空、全满”要留出几个像素的余量，低分辨率下才不会在画面边上露出半透明的一圈。
 */
export function outputPixel(stage: { pixelScale: number }): number {
  return 1 / Math.max(1e-3, stage.pixelScale);
}

/**
 * “每隔一小段时间换一次”的效果（雪花、故障）用的步号：每步 frames 帧，换步的时刻对齐到两帧正中间。
 * 运动模糊的子帧离帧时刻最多半帧（快门角 360° 时也到不了），所以同一帧的所有子帧落在同一步里，画面是清楚的一张，
 * 不会把相邻两步叠成半透明的重影。仍然只是 t 的函数。
 */
export function frameStep(t: number, fps: number, frames: number): number {
  const k = Math.max(1, Math.round(frames));
  return Math.floor((t * fps + 0.5) / k);
}

/** 第 step 步开始的时刻（frameStep 的反函数的下界） */
export function stepStart(step: number, fps: number, frames: number): number {
  const k = Math.max(1, Math.round(frames));
  return (step * k - 0.5) / fps;
}

/** 一步多少帧：步长（秒）按帧率取整，至少 1 帧 */
export function framesPerStep(seconds: number, fps: number): number {
  return Math.max(1, Math.round(seconds * fps));
}

/** seed 参数 → 着色器用的种子（[0, 2^24) 里的整数，float 能精确表示） */
export function shaderSeed(v: ParamValue | undefined): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : 1;
  return ((n % 16777216) + 16777216) % 16777216;
}

export interface ShaderQuad {
  mesh: Mesh;
  material: ShaderMaterial;
  uniforms: Uniforms;
  dispose(): void;
}

export interface ShaderQuadOptions {
  fragment: string;
  uniforms?: Uniforms;
  /** 默认铺满舞台；给了就是这个大小（设计单位），中心在原点 */
  width?: number;
  height?: number;
  vertex?: string;
  /** 同一层里先后画的顺序（大的后画）。几块四边形叠在一起时用它定先后，不靠 z */
  renderOrder?: number;
}

/**
 * 一块着色器四边形（默认铺满舞台），加到场景里。uniforms 里自动带上 uStage（舞台宽高）。
 * transparent、不写深度、不做深度测试：走 NormalBlending，叠放顺序只看 renderOrder。
 */
export function shaderQuad(ctx: SetupContext, opts: ShaderQuadOptions): ShaderQuad {
  const { THREE, stage } = ctx;
  const uniforms: Uniforms = { uStage: { value: new THREE.Vector2(stage.width, stage.height) }, ...opts.uniforms };
  const geometry = new THREE.PlaneGeometry(opts.width ?? stage.width, opts.height ?? stage.height);
  const material = new THREE.ShaderMaterial({ uniforms, vertexShader: opts.vertex ?? VERTEX, fragmentShader: opts.fragment, transparent: true, depthWrite: false, depthTest: false });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = opts.renderOrder ?? 0;
  ctx.scene.add(mesh);
  return {
    mesh,
    material,
    uniforms,
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}

/** 按顺序试几个可选贴图 ID（新路径在前），返回第一个有的；都没有时是 null，不记警告 */
export async function optionalTexture(ctx: SetupContext, ids: readonly string[]): Promise<Texture | null> {
  for (const id of ids) {
    const texture = await ctx.resources.texture(id, { optional: true });
    if (texture) return texture;
  }
  return null;
}
