// 全页共用的一块体素雕塑（docs/decisions.md 官网 · 体素雕塑）：一个 WebGL 上下文、一次实例化绘制画上万块方块。
// - 每块方块在每个“形”（forms.ts）里各有一个位置；着色器从数据纹理里取出“从哪个形”“到哪个形”的位置，
//   按重组的进度（一次触发、按时间自己播完，不绑滚动位置）在两者之间飞。重组的方式用产品自己的转场：
//   体素悦灵从一粒种子长出来（由中心往外），散成细尘用像素溶解（随机先后），剪辑点 ◆ 用方块掉落（一列一列、带重力），
//   时间线和字标用方块擦除（从左到右）；
// - 形放在页面上的哪里由 DOM 决定：各节里有一个空的占位框（data-voxel-slot），每帧把它在视口里的位置换算到世界里，
//   所以雕塑跟着页面一起滚、永远在给它留的空白里；字标对齐 DOM 里那段字的墨迹；
// - 指针划过像手拨开沙子：最近一秒的指针轨迹把附近的方块推开、往镜头这边抬一点、转一下，轨迹越快越亮，慢慢流回原位；
//   按下（不在文字、按钮、卡片上）放出一圈冲击波；按住拖动转雕塑（松手后弹回）；
// - 正文后面不放方块：页面把正文框画成一张低分辨率的遮罩，落在框里的方块缩起来；
// - 光：环境光 + 天光/地光 + 一盏主光，方块边缘略暗（看得出一块一块），远处融进页面底色；不做泛光、景深和辉光。
// 贴图来自官网专用的原版贴图（public/mc/），拼成一张 8×4 的贴图集；没有提取时用纯色。three 与引擎同一版本。这个模块懒加载。
import { BLOCKS, resolveBlockFaces } from '@allay/assets';
import { ALLAY_PALETTE } from '@allay/mascot/model';
import * as THREE from 'three';
import { mcGameVersion, mcTexture } from '../../../host/mc-pack';
import { FORM_INDEX, FORM_NAMES, TILES, allayForm, cutForm, restForm, timelineForm, wordForm, type Form, type FormName, type WordmarkGrid } from './forms';

export type { FormName, WordmarkGrid };

/**
 * 设备档位：决定体素悦灵最多切多细（每模型像素几格）和细尘有多少。实际的格数按首屏给它留的框有多高来定，
 * 让一格在屏幕上约 5.5 px（看得出是一块一块的方块），再按档位封顶：1440×900 上高档约 1.3 万块，2560×1440 约 2.8 万块
 */
export type Tier = 'high' | 'mid' | 'narrow';
export const TIERS: Record<Tier, { kMax: number; dust: number }> = {
  high: { kMax: 9, dust: 240 },
  mid: { kMax: 5, dust: 180 },
  narrow: { kMax: 3, dust: 100 },
};

/** 每模型像素几格：悦灵约 11 个模型像素高，一格约 5.5 CSS px */
export function voxelsPerPixel(tier: Tier, slotHeight: number): number {
  return Math.max(3, Math.min(TIERS[tier].kMax, Math.round(slotHeight / 60)));
}

const F = FORM_NAMES.length;
const TEX_W = 256;
const CAM_Z = 16;
const FOV = 30;
const TAN_HALF = Math.tan((FOV * Math.PI) / 360);
const TRAIL = 16;

/** 各形的重组方式（0 像素溶解、1 方块擦除、2 方块掉落、3 由中心长出）和时长 */
const STYLE: Record<FormName, { style: number; ms: number }> = {
  rest: { style: 0, ms: 1300 },
  allay: { style: 3, ms: 1800 },
  cut: { style: 2, ms: 1700 },
  timeline: { style: 1, ms: 1500 },
  word: { style: 1, ms: 1600 },
};

const VERT = /* glsl */ `
precision highp float;
precision highp int;
precision highp sampler2D;

uniform sampler2D uPos;
uniform sampler2D uCol;
uniform sampler2D uMask;
uniform int uRows;
uniform int uFrom;
uniform int uTo;
uniform float uP;
uniform int uStyle;
uniform vec3 uOrigin[${F}];
uniform float uScale[${F}];
uniform vec2 uRot[${F}];
uniform vec4 uBounds[${F}];
uniform float uTime;
uniform float uDrift;
uniform float uAspect;
uniform vec4 uTrail[${TRAIL}];
uniform vec4 uShock[2];
uniform float uStirR;
uniform float uMaskOn;
uniform vec3 uWingR;
uniform vec3 uWingL;
uniform float uFlap;
uniform float uGemSpin;
uniform float uPlayX;
uniform float uFogNear;
uniform float uFogFar;

attribute float aIndex;

varying vec3 vNormal;
varying vec2 vUv;
varying vec3 vColor;
flat varying float vTile;
varying float vFog;
varying float vGlow;

const float PI = 3.14159265;
const float CAM_Z = ${CAM_Z.toFixed(1)};
const float TAN_HALF = ${TAN_HALF.toFixed(6)};

float hash(float n) { return fract(sin(n * 12.9898 + 4.1414) * 43758.5453); }

mat3 rotY(float a) { float c = cos(a), s = sin(a); return mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c); }
mat3 rotX(float a) { float c = cos(a), s = sin(a); return mat3(1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c); }
mat3 axisAngle(vec3 n, float a) {
  float c = cos(a), s = sin(a), t = 1.0 - c;
  return mat3(t * n.x * n.x + c, t * n.x * n.y + s * n.z, t * n.x * n.z - s * n.y,
              t * n.x * n.y - s * n.z, t * n.y * n.y + c, t * n.y * n.z + s * n.x,
              t * n.x * n.z + s * n.y, t * n.y * n.z - s * n.x, t * n.z * n.z + c);
}

// 取实例 i 在形 f 里的那一块；不属于这个形（大小记为 −1）时取它在 rest 里的位置
void fetchForm(int f, int i, out vec4 p, out vec4 c, out bool obj) {
  p = vec4(0.0);
  c = vec4(0.0);
  ivec2 at = ivec2(i % ${TEX_W}, f * uRows + i / ${TEX_W});
  p = texelFetch(uPos, at, 0);
  c = texelFetch(uCol, at, 0);
  obj = f > 0 && p.w >= 0.0;
  if (!obj) {
    at.y = i / ${TEX_W};
    p = texelFetch(uPos, at, 0);
    c = texelFetch(uCol, at, 0);
  }
}

// 一块在世界里的位置、朝向和大小
vec3 place(int f, bool obj, vec4 p, float code, float seed, vec3 axis, out mat3 R, out float s) {
  R = mat3(1.0);
  s = 0.0;
  vec3 w = vec3(0.0);
  if (!obj) {
    // rest：x、y 是视口的归一化坐标，按深度换算；看得见的细尘随（阻尼过的）滚动缓缓上漂，出了画面从另一头回来
    float dist = CAM_Z - p.z;
    float hh = dist * TAN_HALF;
    float v = p.y;
    if (p.w > 0.0) v = mod(v + uDrift * (9.0 / dist) + 1.25, 2.5) - 1.25;
    w = vec3(p.x * hh * uAspect, v * hh, p.z);
    w.xy += vec2(sin(uTime * 0.13 + seed * 40.0), cos(uTime * 0.11 + seed * 31.0)) * 0.22;
    R = axisAngle(axis, seed * 6.2832 + uTime * (0.15 + seed * 0.35));
    s = p.w;
  } else {
    float part = floor(code / 32.0);
    vec3 l = p.xyz;
    mat3 Rp = mat3(1.0);
    if (part == 5.0) { Rp = rotY(uFlap); l = uWingR + Rp * (l - uWingR); }
    else if (part == 6.0) { Rp = rotY(-uFlap); l = uWingL + Rp * (l - uWingL); }
    else if (part == 8.0) { Rp = rotY(uGemSpin); l = Rp * l; }
    else if (part == 9.0) { l.x += uPlayX; }
    mat3 Rf = rotY(uRot[f].x) * rotX(uRot[f].y);
    R = Rf * Rp;
    s = p.w * uScale[f];
    w = uOrigin[f] + Rf * l * uScale[f];
  }
  return w;
}

void main() {
  int i = int(aIndex + 0.5);
  float seed = hash(aIndex * 0.6180339 + 1.0);
  float seed2 = hash(aIndex * 1.3247 + 7.0);
  vec3 axis = normalize(vec3(hash(aIndex + 3.1), hash(aIndex + 5.7), hash(aIndex + 9.2)) - 0.5 + 1e-3);

  vec4 pb = vec4(0.0), cb = vec4(0.0);
  bool ob = false;
  fetchForm(uTo, i, pb, cb, ob);
  mat3 Rb = mat3(1.0);
  float sb = 0.0;
  vec3 b = place(uTo, ob, pb, cb.w, seed, axis, Rb, sb);

  vec3 a = vec3(0.0);
  mat3 Ra = mat3(1.0);
  float sa = 0.0;
  vec4 ca = vec4(0.0);
  if (uFrom < 0) {
    // 种子：所有方块从目标形的中心、大小为 0 开始
    a = uOrigin[uTo]; Ra = Rb; sa = 0.0; ca = cb;
  } else {
    vec4 pa = vec4(0.0);
    bool oa = false;
    fetchForm(uFrom, i, pa, ca, oa);
    a = place(uFrom, oa, pa, ca.w, seed, axis, Ra, sa);
  }
  if (max(sa, sb) <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }

  // 各块的先后（按目标形的局部坐标和重组方式）
  float d;
  if (!ob) d = seed * 0.85;
  else {
    vec4 bd = uBounds[uTo];
    float xn = clamp((pb.x - bd.x) / max(1e-3, bd.y - bd.x), 0.0, 1.0);
    float yn = clamp((pb.y - bd.z) / max(1e-3, bd.w - bd.z), 0.0, 1.0);
    if (uStyle == 1) d = xn * 0.88 + seed * 0.12;
    else if (uStyle == 2) d = xn * 0.5 + yn * 0.38 + seed * 0.12;
    else if (uStyle == 3) d = clamp(length(pb.xyz) / max(1e-3, 0.5 * max(bd.y - bd.x, bd.w - bd.z)), 0.0, 1.0) * 0.8 + seed * 0.2;
    else d = seed;
  }
  const float S = 0.55;
  float p = clamp((uP - d * S) / (1.0 - S), 0.0, 1.0);
  float e = p < 0.5 ? 4.0 * p * p * p : 1.0 - pow(-2.0 * p + 2.0, 3.0) / 2.0;
  float arc = sin(PI * e) * step(1e-3, distance(a, b));
  vec3 pos;
  if (uStyle == 2 && ob) {
    // 方块掉落：先飞到目标正上方，再带重力落下（最后一点有个小回弹）
    vec3 above = b + vec3(0.0, 5.0 + seed * 3.0, 1.0);
    if (p < 0.5) {
      float q = smoothstep(0.0, 1.0, p / 0.5);
      pos = mix(a, above, q);
      pos.z += sin(PI * q) * 2.0;
    } else {
      float q = (p - 0.5) / 0.5;
      pos = mix(above, b, q * q);
      pos.y += sin(clamp((q - 0.82) / 0.18, 0.0, 1.0) * PI) * 0.25 * (1.0 - q);
    }
    arc = p < 0.5 ? sin(PI * p) : 0.0;
  } else {
    vec3 side = normalize(cross(b - a, vec3(0.0, 0.0, 1.0)) + 1e-4);
    pos = mix(a, b, e) + (side * (seed2 - 0.5) * 3.2 + vec3(0.0, 0.0, 2.4 * seed)) * arc;
  }
  float s = mix(sa, sb, e) * (1.0 + 0.3 * arc);
  mat3 R = Ra * (1.0 - e) + Rb * e;
  R = axisAngle(axis, arc * 2.6 * (0.4 + seed)) * R;
  vec3 col = e < 0.5 ? ca.rgb : cb.rgb;
  vTile = mod(e < 0.5 ? ca.w : cb.w, 32.0);

  // 指针：在“视线角”空间里推开（与深度无关，屏幕上看起来一样大），往镜头这边抬一点、转一下
  vec4 vp = viewMatrix * vec4(pos, 1.0);
  float depth = -vp.z;
  vec2 q = vp.xy / depth;
  vec2 push = vec2(0.0);
  float glow = 0.0;
  for (int k = 0; k < ${TRAIL}; k++) {
    vec4 tr = uTrail[k];
    if (tr.z <= 0.0) continue;
    vec2 dd = q - tr.xy;
    float r2 = dot(dd, dd);
    float f = exp(-r2 / (uStirR * uStirR)) * tr.z;
    push += dd * inversesqrt(r2 + 1e-7) * f;
    glow += f * tr.w;
  }
  for (int k = 0; k < 2; k++) {
    vec4 sh = uShock[k];
    if (sh.w <= 0.0) continue;
    vec2 dd = q - sh.xy;
    float r = length(dd);
    float ring = (r - sh.z) / (uStirR * 0.8);
    float f = exp(-ring * ring) * sh.w;
    push += dd / max(r, 1e-4) * f * 1.6;
    glow += f * 0.7;
  }
  float amt = length(push);
  if (amt > 1.0) { push *= 1.0 / amt; amt = 1.0; }
  q += push * uStirR * 0.6;
  vp.xy = q * depth;
  vp.z += amt * 1.4;
  R = axisAngle(axis, amt * 1.6) * R;
  s *= 1.0 - amt * 0.3;

  // 正文后面不放方块
  vec4 cc = projectionMatrix * vp;
  vec2 suv = cc.xy / cc.w * 0.5 + 0.5;
  float m = uMaskOn * textureLod(uMask, suv, 0.0).r;
  s *= 1.0 - smoothstep(0.08, 0.7, m);

  vec4 mv = vp + vec4(mat3(viewMatrix) * (R * (position * s)), 0.0);
  gl_Position = projectionMatrix * mv;
  vNormal = R * normal;
  vUv = uv;
  vColor = col;
  vGlow = clamp(glow, 0.0, 1.0);
  vFog = smoothstep(uFogNear, uFogFar, -mv.z) * 0.88;
}`;

const FRAG = /* glsl */ `
precision highp float;
uniform sampler2D uAtlas;
uniform vec3 uFogColor;
uniform vec3 uKeyDir;
uniform vec3 uKeyCol;
uniform vec3 uSky;
uniform vec3 uGround;
uniform vec3 uGlowCol;

varying vec3 vNormal;
varying vec2 vUv;
varying vec3 vColor;
flat varying float vTile;
varying float vFog;
varying float vGlow;

void main() {
  vec3 n = normalize(vNormal);
  vec2 uv = clamp(vUv, 0.002, 0.998);
  vec2 tuv = (vec2(mod(vTile, 8.0), 3.0 - floor(vTile / 8.0)) + uv) / vec2(8.0, 4.0);
  // 手算细化级别，最多到每格 1 个像素（第 4 级正好是一格的平均色，不和相邻的格子混）
  vec2 g = vUv * 16.0;
  vec2 dx = dFdx(g), dy = dFdy(g);
  float lod = clamp(0.5 * log2(max(dot(dx, dx), dot(dy, dy))), 0.0, 4.0);
  vec3 base = textureLod(uAtlas, tuv, lod).rgb * vColor;
  float key = max(dot(n, uKeyDir), 0.0);
  vec3 hemi = mix(uGround, uSky, n.y * 0.5 + 0.5);
  vec3 lit = base * (hemi + uKeyCol * key);
  vec2 ed = min(uv, 1.0 - uv);
  lit *= mix(0.8, 1.0, smoothstep(0.0, 0.16, min(ed.x, ed.y)));
  lit = mix(lit, uGlowCol, vGlow * 0.55);
  lit = mix(lit, uFogColor, vFog);
  gl_FragColor = vec4(lit, 1.0);
  #include <colorspace_fragment>
}`;

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface WorldFrame {
  now: number;
  dt: number;
  vw: number;
  vh: number;
  /** 页面滚动位置（CSS 像素） */
  scroll: number;
  /** 该拼成哪个形（由页面按各节的占位框是否在视口里决定） */
  target: FormName;
  /** 各形的占位框（视口坐标）；不显示的为 null */
  slots: Partial<Record<FormName, Box | null>>;
  /** 页尾字标的墨迹框（视口坐标）；不在视口附近时为 null */
  word: { left: number; top: number; height: number } | null;
  pointer: { x: number; y: number } | null;
  /** 指针轨迹：每 4 个数一个点（x、y 视口坐标，距今多少秒，速度 px/s），最近的在前 */
  trail: Float32Array;
  /** 冲击波：每 4 个数一个（x、y，距今多少秒，强度），最多两个 */
  shocks: Float32Array;
  /** 按住拖动转的角度（弧度） */
  drag: { yaw: number; pitch: number };
  /** 悦灵：视口坐标（CSS 像素）、显示尺寸、当前帧在图集里的序号、朝向；不出场时为 null */
  allay: { x: number; y: number; size: number; frame: number; facing: 1 | -1; tilt: number } | null;
  /** 减少动效：直接到终态，不漂、不扇翅膀、不跟指针 */
  still: boolean;
  /** 正文在视口里的位置（每 4 个数一个框：左、上、右、下） */
  textRects: Float32Array | null;
}

/** 一张贴图（动画贴图只取第一帧） */
async function tileBitmap(id: string): Promise<ImageBitmap | null> {
  const def = BLOCKS[id];
  if (!def || !mcGameVersion) return null;
  const tex = resolveBlockFaces(def).faces.south.texture;
  const r = await mcTexture(tex);
  if (!r) return null;
  return createImageBitmap(new Blob([new Uint8Array(r.png)], { type: 'image/png' }));
}

function springTo(v: number, vel: number, target: number, omega: number, dt: number): [number, number] {
  const x = v - target;
  const e = Math.exp(-omega * dt);
  return [target + (x + (vel + omega * x) * dt) * e, (vel - omega * (vel + omega * x) * dt) * e];
}

export class World {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 400);
  private readonly mesh: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;
  private readonly mat: THREE.ShaderMaterial;
  private readonly posTex: THREE.DataTexture;
  private readonly colTex: THREE.DataTexture;
  private readonly atlas: THREE.CanvasTexture;
  private readonly atlasCanvas: HTMLCanvasElement;
  private readonly mask: THREE.CanvasTexture;
  private readonly maskCanvas: HTMLCanvasElement;
  private maskSig = NaN;
  private readonly rows: number;
  readonly instances: number;
  private readonly forms: (Form | null)[] = new Array<Form | null>(F).fill(null);
  private wordGrid: WordmarkGrid | null = null;
  private allayMesh: THREE.Mesh | null = null;
  private allayMat: THREE.MeshBasicMaterial | null = null;
  private allayAtlas: { columns: number; rx: number; ry: number } | null = null;
  private width = 1;
  private height = 1;
  private theme: 'dark' | 'light' = 'dark';
  private t0 = 0;
  private disposed = false;
  // 重组：从哪个形（−1 是种子）到哪个形、进度、排着队的下一个
  private from = 0;
  private to = 0;
  private p = 1;
  private pending: number | null = null;
  private started = false;
  /** 各形的朝向（弹簧追目标） */
  private readonly rot = Array.from({ length: F }, () => ({ yaw: 0, pitch: 0, vy: 0, vp: 0 }));
  private drift = 0;
  private driftV = 0;
  private stillDirty = 3;
  /** 停下来了：没有在重组 */
  settled = false;
  /** 这一帧指针轨迹的总强度（测试和调试看指针有没有真的拨动方块） */
  stir = 0;
  /** 雕塑当前被拖着转了多少（弧度） */
  yaw = 0;
  private readonly tmp = new THREE.Vector3();

  private constructor(canvas: HTMLCanvasElement, n: number) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, premultipliedAlpha: true, powerPreference: 'high-performance' });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.instances = n;
    this.rows = Math.ceil(n / TEX_W);
    const data = () => new Float32Array(TEX_W * this.rows * F * 4);
    const tex = (d: Float32Array) => {
      const t = new THREE.DataTexture(d, TEX_W, this.rows * F, THREE.RGBAFormat, THREE.FloatType);
      t.minFilter = THREE.NearestFilter;
      t.magFilter = THREE.NearestFilter;
      t.generateMipmaps = false;
      t.needsUpdate = true;
      return t;
    };
    this.posTex = tex(data());
    this.colTex = tex(data());

    // 贴图集：先画纯色和噪点，原版贴图装好以后再画上去
    this.atlasCanvas = document.createElement('canvas');
    this.atlasCanvas.width = 128;
    this.atlasCanvas.height = 64;
    const g = this.atlasCanvas.getContext('2d')!;
    TILES.forEach((t, i) => {
      const x = (i % 8) * 16;
      const y = Math.floor(i / 8) * 16;
      g.fillStyle = t.fallback;
      g.fillRect(x, y, 16, 16);
      for (let py = 0; py < 16; py++) {
        for (let px = 0; px < 16; px++) {
          const v = Math.sin((i * 256 + py * 16 + px) * 12.9898) * 43758.5453;
          const r = v - Math.floor(v);
          g.fillStyle = r > 0.5 ? `rgba(255,255,255,${((r - 0.5) * 0.16).toFixed(3)})` : `rgba(0,0,0,${((0.5 - r) * 0.2).toFixed(3)})`;
          g.fillRect(x + px, y + py, 1, 1);
        }
      }
    });
    this.atlas = new THREE.CanvasTexture(this.atlasCanvas);
    this.atlas.colorSpace = THREE.SRGBColorSpace;
    this.atlas.magFilter = THREE.NearestFilter;
    this.atlas.minFilter = THREE.NearestMipmapLinearFilter;
    this.atlas.generateMipmaps = true;

    this.maskCanvas = document.createElement('canvas');
    this.maskCanvas.width = 192;
    this.maskCanvas.height = 108;
    this.mask = new THREE.CanvasTexture(this.maskCanvas);
    this.mask.minFilter = THREE.LinearFilter;
    this.mask.magFilter = THREE.LinearFilter;
    this.mask.generateMipmaps = false;

    const vec3s = () => Array.from({ length: F }, () => new THREE.Vector3());
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uPos: { value: this.posTex },
        uCol: { value: this.colTex },
        uMask: { value: this.mask },
        uAtlas: { value: this.atlas },
        uRows: { value: this.rows },
        uFrom: { value: 0 },
        uTo: { value: 0 },
        uP: { value: 1 },
        uStyle: { value: 0 },
        uOrigin: { value: vec3s() },
        uScale: { value: new Array<number>(F).fill(1) },
        uRot: { value: Array.from({ length: F }, () => new THREE.Vector2()) },
        uBounds: { value: Array.from({ length: F }, () => new THREE.Vector4(-1, 1, -1, 1)) },
        uTime: { value: 0 },
        uDrift: { value: 0 },
        uAspect: { value: 1 },
        uTrail: { value: Array.from({ length: TRAIL }, () => new THREE.Vector4()) },
        uShock: { value: [new THREE.Vector4(), new THREE.Vector4()] },
        uStirR: { value: 0.03 },
        uMaskOn: { value: 1 },
        uWingR: { value: new THREE.Vector3() },
        uWingL: { value: new THREE.Vector3() },
        uFlap: { value: 0 },
        uGemSpin: { value: 0 },
        uPlayX: { value: 0 },
        uFogNear: { value: 22 },
        uFogFar: { value: 72 },
        uFogColor: { value: new THREE.Color(0x0b0b0c) },
        uKeyDir: { value: new THREE.Vector3(-0.45, 0.75, 0.55).normalize() },
        uKeyCol: { value: new THREE.Color(0xffffff) },
        uSky: { value: new THREE.Color(0xffffff) },
        uGround: { value: new THREE.Color(0x222222) },
        uGlowCol: { value: new THREE.Color(0xffffff) },
      },
    });
    const box = new THREE.BoxGeometry(1, 1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = box.index;
    geo.setAttribute('position', box.getAttribute('position'));
    geo.setAttribute('normal', box.getAttribute('normal'));
    geo.setAttribute('uv', box.getAttribute('uv'));
    geo.setAttribute('aIndex', new THREE.InstancedBufferAttribute(Float32Array.from({ length: n }, (_, i) => i), 1));
    geo.instanceCount = n;
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
    this.camera.position.set(0, 0, CAM_Z);
    this.camera.lookAt(0, 0, 0);
  }

  /** 按档位建好各个形；n 是实例数（最大的形 + 细尘） */
  static async create(canvas: HTMLCanvasElement, opts: { theme: 'dark' | 'light'; tier: Tier; slotHeight: number }): Promise<World> {
    const { dust } = TIERS[opts.tier];
    const k = voxelsPerPixel(opts.tier, opts.slotHeight);
    const allay = allayForm(k, 1e9);
    const cut = cutForm(k, 1e9);
    const timeline = timelineForm(k, 1e9);
    const n = Math.max(allay.count, cut.count, timeline.count) + dust;
    const w = new World(canvas, n);
    w.theme = opts.theme;
    w.setForm(FORM_INDEX.rest, restForm(n, dust));
    w.setForm(FORM_INDEX.allay, allay);
    w.setForm(FORM_INDEX.cut, cut);
    w.setForm(FORM_INDEX.timeline, timeline);
    w.applyTheme();
    void w.loadAtlas();
    return w;
  }

  private setForm(fi: number, form: Form): void {
    this.forms[fi] = form;
    const pos = this.posTex.image.data as Float32Array;
    const col = this.colTex.image.data as Float32Array;
    const base = fi * this.rows * TEX_W * 4;
    const n = Math.min(form.count, this.instances);
    pos.set(form.pos.subarray(0, n * 4), base);
    col.set(form.col.subarray(0, n * 4), base);
    for (let i = n; i < this.rows * TEX_W; i++) {
      pos[base + i * 4 + 3] = -1;
    }
    this.posTex.needsUpdate = true;
    this.colTex.needsUpdate = true;
    (this.mat.uniforms.uBounds!.value as THREE.Vector4[])[fi]!.set(...form.bounds);
    if (form.pivot) (this.mat.uniforms.uWingR!.value as THREE.Vector3).set(...form.pivot);
    if (form.pivotL) (this.mat.uniforms.uWingL!.value as THREE.Vector3).set(...form.pivotL);
    this.stillDirty = 3;
  }

  private async loadAtlas(): Promise<void> {
    const g = this.atlasCanvas.getContext('2d')!;
    await Promise.all(
      TILES.map(async (t, i) => {
        if (!t.id) return;
        const bmp = await tileBitmap(t.id).catch(() => null);
        if (!bmp || this.disposed) return;
        g.clearRect((i % 8) * 16, Math.floor(i / 8) * 16, 16, 16);
        g.drawImage(bmp, 0, 0, bmp.width, bmp.width, (i % 8) * 16, Math.floor(i / 8) * 16, 16, 16);
        bmp.close();
      }),
    );
    if (this.disposed) return;
    this.atlas.needsUpdate = true;
    this.stillDirty = 3;
  }

  setTheme(theme: 'dark' | 'light', bg: string): void {
    this.theme = theme;
    (this.mat.uniforms.uFogColor!.value as THREE.Color).setStyle(bg, THREE.SRGBColorSpace);
    this.applyTheme();
    if (this.wordGrid) this.setForm(FORM_INDEX.word, wordForm(this.wordGrid, theme, this.instances));
  }

  private applyTheme(): void {
    const light = this.theme === 'light';
    const u = this.mat.uniforms;
    (u.uKeyCol!.value as THREE.Color).setRGB(...((light ? [0.62, 0.6, 0.57] : [0.78, 0.76, 0.72]) as [number, number, number]));
    (u.uSky!.value as THREE.Color).setRGB(...((light ? [0.62, 0.66, 0.7] : [0.42, 0.47, 0.54]) as [number, number, number]));
    (u.uGround!.value as THREE.Color).setRGB(...((light ? [0.36, 0.36, 0.38] : [0.1, 0.11, 0.13]) as [number, number, number]));
    (u.uGlowCol!.value as THREE.Color).set(light ? ALLAY_PALETTE.light : ALLAY_PALETTE.highlight);
    u.uFogNear!.value = light ? 18 : 22;
    u.uFogFar!.value = light ? 64 : 72;
    this.stillDirty = 3;
  }

  /** 页尾字标的点阵（由页面按 DOM 里那段字的字体栅格化出来） */
  setWordmark(grid: WordmarkGrid): void {
    this.wordGrid = grid;
    this.setForm(FORM_INDEX.word, wordForm(grid, this.theme, this.instances));
  }

  /** 悦灵的图集（应用同一份烘焙产物）：画在一块面片上，放进这个空间里 */
  setAllayAtlas(image: ImageBitmap, atlas: { columns: number; size: number }): void {
    const tex = new THREE.Texture(image);
    tex.needsUpdate = true;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    // ImageBitmap 上传时不能翻转（flipY 无效）：v 从图的顶边往下增，所以 repeat.y 取负、offset 指向格子的底边
    tex.flipY = false;
    const rx = atlas.size / image.width;
    const ry = atlas.size / image.height;
    tex.repeat.set(rx, -ry);
    this.allayAtlas = { columns: atlas.columns, rx, ry };
    this.allayMat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, alphaTest: 0.02 });
    this.allayMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.allayMat);
    this.allayMesh.renderOrder = 5;
    this.allayMesh.visible = false;
    this.scene.add(this.allayMesh);
  }

  resize(width: number, height: number): void {
    this.width = Math.max(2, Math.round(width));
    this.height = Math.max(2, Math.round(height));
    this.renderer.setSize(this.width, this.height, false);
    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();
    this.stillDirty = 3;
  }

  /** 当前（或正在拼向）的形 */
  get form(): FormName {
    return FORM_NAMES[this.to]!;
  }

  /** 视口坐标 → z = 0 平面上的世界坐标 */
  private toWorld(x: number, y: number, vw: number, vh: number, out: THREE.Vector3): THREE.Vector3 {
    const upp = (2 * CAM_Z * TAN_HALF) / vh;
    return out.set((x - vw / 2) * upp, -(y - vh / 2) * upp, 0);
  }

  frame(f: WorldFrame): void {
    if (this.disposed) return;
    this.t0 ||= f.now;
    const t = f.still ? 0 : (f.now - this.t0) / 1000;
    const dt = Math.min(0.1, f.dt);
    const u = this.mat.uniforms;
    const target = FORM_INDEX[f.target];

    // 重组：一次触发后按时间播完；途中目标又变了就排队，并把当前这次加速播完（快速跳过时很快到终态）
    if (!this.started) {
      this.started = true;
      this.to = target;
      this.from = target === FORM_INDEX.rest || f.still ? target : -1;
      this.p = f.still || target === FORM_INDEX.rest ? 1 : 0;
    } else if (target !== this.to) {
      if (this.p >= 1 || f.still) this.begin(target, f.still);
      else this.pending = target;
    } else if (this.pending !== null) this.pending = null;
    const style = STYLE[FORM_NAMES[this.to]!];
    const rate = this.pending !== null ? 3.2 : this.from < 0 ? 0.85 : 1;
    if (!f.still) this.p = Math.min(1, this.p + ((dt * 1000) / style.ms) * rate);
    if (this.p >= 1 && this.pending !== null) {
      const next = this.pending;
      this.pending = null;
      this.begin(next, false);
    }
    this.settled = this.p >= 1 && this.pending === null;

    // 各形放到页面上给它留的框里（视口坐标 → 世界），朝向跟指针、跟拖动
    const upp = (2 * CAM_Z * TAN_HALF) / f.vh;
    const origins = u.uOrigin!.value as THREE.Vector3[];
    const scales = u.uScale!.value as number[];
    const rots = u.uRot!.value as THREE.Vector2[];
    const active = (fi: number) => fi === this.to || fi === this.from || fi === this.pending;
    for (const name of ['allay', 'cut', 'timeline'] as const) {
      const fi = FORM_INDEX[name];
      const form = this.forms[fi];
      const box = f.slots[name];
      if (!form || !box || !active(fi)) continue;
      const fw = form.bounds[1] - form.bounds[0];
      const fh = form.bounds[3] - form.bounds[2];
      const pxPerUnit = Math.min(box.width / fw, box.height / fh) * 0.92;
      scales[fi] = pxPerUnit * upp;
      const cx = box.left + box.width / 2;
      const cy = box.top + box.height / 2;
      this.toWorld(cx, cy, f.vw, f.vh, origins[fi]!);
      if (name === 'allay' && !f.still) origins[fi]!.y += Math.sin(t * 1.3) * 0.9 * scales[fi]!;
      // 朝向：看向指针（悦灵转头最明显），加上拖动
      const look = f.pointer && !f.still ? { x: Math.max(-1, Math.min(1, (f.pointer.x - cx) / (f.vw * 0.45))), y: Math.max(-1, Math.min(1, (f.pointer.y - cy) / (f.vh * 0.6))) } : { x: 0, y: 0 };
      const mine = fi === this.to;
      const dragYaw = mine ? f.drag.yaw : 0;
      const dragPitch = mine ? f.drag.pitch : 0;
      let yawT: number;
      let pitchT: number;
      if (name === 'allay') {
        yawT = (f.still ? 0.32 : Math.sin(t * 0.3) * 0.2) + look.x * 0.5 + dragYaw;
        pitchT = 0.08 + look.y * 0.22 + dragPitch;
      } else if (name === 'cut') {
        yawT = look.x * 0.3 + dragYaw;
        pitchT = 0.14 + look.y * 0.12 + dragPitch;
      } else {
        yawT = -0.3 + look.x * 0.14 + dragYaw;
        pitchT = 0.44 + look.y * 0.1 + dragPitch * 0.5;
      }
      const r = this.rot[fi]!;
      if (f.still) {
        r.yaw = yawT;
        r.pitch = pitchT;
      } else {
        [r.yaw, r.vy] = springTo(r.yaw, r.vy, yawT, 5, dt);
        [r.pitch, r.vp] = springTo(r.pitch, r.vp, Math.max(-0.6, Math.min(0.9, pitchT)), 5, dt);
      }
      rots[fi]!.set(r.yaw, r.pitch);
      if (mine) this.yaw = r.yaw;
    }
    const wordF = this.forms[FORM_INDEX.word];
    if (wordF && this.wordGrid && f.word) {
      const fi = FORM_INDEX.word;
      const cell = f.word.height / this.wordGrid.rows;
      scales[fi] = cell * upp;
      this.toWorld(f.word.left + (this.wordGrid.cols * cell) / 2, f.word.top + (this.wordGrid.rows * cell) / 2, f.vw, f.vh, origins[fi]!);
      rots[fi]!.set(0, 0);
    }

    // 细尘随滚动缓缓上漂（阻尼过的滚动位置，以视口高为单位）
    const scrollVh = f.scroll / f.vh;
    if (f.still) this.drift = scrollVh;
    else [this.drift, this.driftV] = springTo(this.drift, this.driftV, scrollVh, 3, dt);

    // 指针轨迹和冲击波（视口坐标 → “视线角”空间：x、y 除以深度）
    const toTan = (x: number, y: number, out: THREE.Vector4) => out.set(((x / f.vw) * 2 - 1) * TAN_HALF * (f.vw / f.vh), (1 - (y / f.vh) * 2) * TAN_HALF, 0, 0);
    const trail = u.uTrail!.value as THREE.Vector4[];
    this.stir = 0;
    for (let k = 0; k < TRAIL; k++) {
      const v = trail[k]!;
      const at = k * 4;
      if (f.still || at + 3 >= f.trail.length) {
        v.set(0, 0, 0, 0);
        continue;
      }
      const age = f.trail[at + 2]!;
      const speed = f.trail[at + 3]!;
      const strength = Math.exp(-age * 2.4) * (0.55 + 0.45 * Math.min(1, speed / 1400)) * 0.34;
      if (strength < 0.01) {
        v.set(0, 0, 0, 0);
        continue;
      }
      toTan(f.trail[at]!, f.trail[at + 1]!, v);
      v.z = strength;
      v.w = Math.min(1, speed / 2200) ** 1.3 * 1.6;
      this.stir += strength;
    }
    const shocks = u.uShock!.value as THREE.Vector4[];
    for (let k = 0; k < 2; k++) {
      const v = shocks[k]!;
      const at = k * 4;
      if (f.still || at + 3 >= f.shocks.length || f.shocks[at + 3]! <= 0) {
        v.set(0, 0, 0, 0);
        continue;
      }
      const age = f.shocks[at + 2]!;
      toTan(f.shocks[at]!, f.shocks[at + 1]!, v);
      v.z = ((age * 1100) / f.vh) * 2 * TAN_HALF; // 环的半径：每秒扩 1100 px
      v.w = age > 1.4 ? 0 : Math.exp(-age * 1.8) * f.shocks[at + 3]!;
    }
    u.uStirR!.value = ((78 / f.vh) * 2 * TAN_HALF);

    // 正文遮罩（框变了才重画、重新上传）
    this.updateMask(f);

    u.uFrom!.value = this.from;
    u.uTo!.value = this.to;
    u.uP!.value = this.p;
    u.uStyle!.value = style.style;
    u.uTime!.value = t;
    u.uDrift!.value = this.drift;
    u.uAspect!.value = f.vw / f.vh;
    u.uFlap!.value = f.still ? 0.12 : Math.sin(t * 2.4) * 0.2;
    u.uGemSpin!.value = f.still ? 0.5 : t * 0.6;
    const tl = this.forms[FORM_INDEX.timeline];
    u.uPlayX!.value = tl?.playWidth ? (((t * 0.06) % 1) - 0.5) * tl.playWidth : 0;

    // 带路的悦灵：视口坐标 → 世界（放在雕塑前面一点），按图集的帧取格子
    if (this.allayMesh && this.allayAtlas && this.allayMat) {
      const a = f.allay;
      this.allayMesh.visible = !!a;
      if (a) {
        const zPlane = 1.5;
        const dist = CAM_Z - zPlane;
        const uppZ = (2 * dist * TAN_HALF) / f.vh;
        this.allayMesh.position.set((a.x - f.vw / 2) * uppZ, -(a.y - f.vh / 2) * uppZ, zPlane);
        const s = a.size * uppZ;
        this.allayMesh.scale.set(s * a.facing, s, 1);
        this.allayMesh.rotation.set(0, 0, (-a.tilt * Math.PI) / 180);
        const map = this.allayMat.map!;
        const col = a.frame % this.allayAtlas.columns;
        const row = Math.floor(a.frame / this.allayAtlas.columns);
        map.offset.set(col * this.allayAtlas.rx, (row + 1) * this.allayAtlas.ry);
      }
    }

    if (f.still) {
      if (this.stillDirty <= 0) return;
      this.stillDirty--;
    }
    this.renderer.render(this.scene, this.camera);
  }

  private begin(target: number, still: boolean): void {
    this.from = this.to;
    this.to = target;
    this.p = still ? 1 : 0;
    this.stillDirty = 3;
  }

  private updateMask(f: WorldFrame): void {
    const rects = f.textRects;
    let sig = rects ? rects.length : 0;
    if (rects) for (let i = 0; i < rects.length; i++) sig = (sig * 31 + Math.round(rects[i]! / 4)) % 1e9;
    if (sig === this.maskSig) return;
    this.maskSig = sig;
    const g = this.maskCanvas.getContext('2d')!;
    const W = this.maskCanvas.width;
    const H = this.maskCanvas.height;
    g.clearRect(0, 0, W, H);
    if (rects && rects.length) {
      g.filter = 'blur(2px)';
      g.fillStyle = '#fff';
      for (let i = 0; i < rects.length; i += 4) {
        const x0 = (rects[i]! / f.vw) * W;
        const y0 = (rects[i + 1]! / f.vh) * H;
        g.fillRect(x0, y0, ((rects[i + 2]! - rects[i]!) / f.vw) * W, ((rects[i + 3]! - rects[i + 1]!) / f.vh) * H);
      }
      g.filter = 'none';
    }
    this.mask.needsUpdate = true;
    this.stillDirty = 3;
  }

  /** 量一帧的渲染要多久（毫秒，含等 GPU 画完）：连画 n 帧，每帧读回一个像素逼它画完。只给测试和调试用 */
  bench(n: number): number {
    const gl = this.renderer.getContext();
    const px = new Uint8Array(4);
    const t0 = performance.now();
    for (let i = 0; i < n; i++) {
      this.renderer.render(this.scene, this.camera);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    }
    return (performance.now() - t0) / n;
  }

  dispose(): void {
    this.disposed = true;
    this.mesh.geometry.dispose();
    this.mat.dispose();
    this.posTex.dispose();
    this.colTex.dispose();
    this.atlas.dispose();
    this.mask.dispose();
    this.allayMat?.map?.dispose();
    this.allayMat?.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}

/** 档位：窄屏、核少内存小的设备、其余（都可以被页面覆盖，测试用） */
export function pickTier(): Tier {
  if (window.innerWidth < 1024 || matchMedia('(pointer: coarse)').matches) return 'narrow';
  const nav = navigator as Navigator & { deviceMemory?: number };
  if ((navigator.hardwareConcurrency || 8) <= 4 || (nav.deviceMemory ?? 8) <= 4) return 'mid';
  return 'high';
}
