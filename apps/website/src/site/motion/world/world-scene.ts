// 全页共用的一块 3D 方块世界（docs/decisions.md 官网 · 画布）：一个 WebGL 上下文、一个渲染循环，固定在所有内容后面。
// - 每一节是这个世界里的一个“机位”（一串竖着排开的方块群）。走到哪一节由滚动位置决定，相机用弹簧自己飞过去，
//   中途的方块从身边掠过；停手也会飞到终态，不绑滚动位置逐帧；
// - 光：环境光 + 白色主光 + 品牌蓝的轮廓光 + 一盏跟着指针走的点光（场景光照是内容，不做泛光和光柱）；
// - 景深：方块分远、中、近三层，远近两层画进半分辨率的离屏缓冲、两遍高斯模糊后合成；
// - 能玩：指针推开附近的方块；点空白处的方块把它敲碎（碎块带重力掉下去），几秒后长回来；
// - 页尾的字标由方块拼成：对齐 DOM 里那段字的位置，走到页尾时方块从四面飞进来拼好，也能推、能敲；
// - 悦灵在这个空间里飞（应用同一份烘焙图集画在一块面片上），会被近处的方块挡住。
// 贴图来自官网专用的原版贴图（public/mc/），没有提取时用纯色。three 与引擎同一版本。这个模块懒加载。
import { BLOCKS, resolveBlockFaces, type Face } from '@allay/assets';
import * as THREE from 'three';
import { mcGameVersion, mcTexture } from '../../../host/mc-pack';

type Layer = 0 | 1 | 2; // 远、中（焦平面）、近

interface Spec {
  x: number;
  y: number;
  z: number;
  s: number;
  id: string;
}

/** 一个机位的方块群（宽屏的构图；首屏原样，其余机位镜像、抽稀） */
const SPECS: Spec[] = [
  { x: 4.7, y: 2.5, z: -0.6, s: 1.1, id: 'minecraft:diamond_block' },
  { x: 6.6, y: 0.6, z: 0.6, s: 0.62, id: 'minecraft:sea_lantern' },
  { x: 2.7, y: 3.5, z: -2.2, s: 0.56, id: 'minecraft:amethyst_block' },
  { x: -7.9, y: -3.9, z: 0.4, s: 0.86, id: 'minecraft:crafting_table' },
  { x: -1.6, y: -4.6, z: -1.4, s: 0.52, id: 'minecraft:tnt' },
  { x: 0.6, y: -0.6, z: -3.4, s: 0.42, id: 'minecraft:gold_block' },
  { x: 5.9, y: 4.0, z: -3.4, s: 0.48, id: 'minecraft:packed_ice' },
  { x: -1.2, y: 4.1, z: -3.8, s: 0.42, id: 'minecraft:glowstone' },
  { x: 7.6, y: -1.8, z: -2.4, s: 0.78, id: 'minecraft:deepslate_bricks' },
  { x: -8.4, y: 3.7, z: -2.6, s: 0.58, id: 'minecraft:lapis_block' },
  { x: 1.4, y: -4.4, z: -0.8, s: 0.46, id: 'minecraft:copper_block' },
  { x: -2.6, y: 1.4, z: -9, s: 1.4, id: 'minecraft:obsidian' },
  { x: 3.2, y: -1.0, z: -10, s: 1.6, id: 'minecraft:deepslate_bricks' },
  { x: -8.4, y: -0.8, z: -11, s: 1.5, id: 'minecraft:diamond_block' },
  { x: 9.0, y: 3.6, z: -12, s: 1.8, id: 'minecraft:amethyst_block' },
  { x: 0.4, y: 4.8, z: -13, s: 1.6, id: 'minecraft:packed_ice' },
  { x: -5.2, y: 4.9, z: -10, s: 1.2, id: 'minecraft:crying_obsidian' },
  { x: 1.6, y: -4.8, z: -9, s: 1.3, id: 'minecraft:emerald_block' },
  { x: 10.4, y: -4.2, z: -11, s: 1.4, id: 'minecraft:sea_lantern' },
  { x: -11, y: 3.2, z: -13, s: 1.6, id: 'minecraft:lapis_block' },
  { x: -7.4, y: -5.3, z: 4.4, s: 1.5, id: 'minecraft:diamond_block' },
  { x: 7.2, y: 4.6, z: 3.8, s: 1.2, id: 'minecraft:amethyst_block' },
];

const EMISSIVE = new Set(['minecraft:sea_lantern', 'minecraft:glowstone', 'minecraft:crying_obsidian']);
const FALLBACK: Record<string, string> = {
  'minecraft:diamond_block': '#52D6DC',
  'minecraft:sea_lantern': '#A9DCD3',
  'minecraft:amethyst_block': '#9B85E8',
  'minecraft:crafting_table': '#9C6B3C',
  'minecraft:tnt': '#C2362F',
  'minecraft:gold_block': '#F2C94C',
  'minecraft:packed_ice': '#9CC3F5',
  'minecraft:glowstone': '#F3C969',
  'minecraft:deepslate_bricks': '#4A4A50',
  'minecraft:lapis_block': '#2F5DB8',
  'minecraft:copper_block': '#C8734A',
  'minecraft:obsidian': '#22183A',
  'minecraft:crying_obsidian': '#3A1F66',
  'minecraft:emerald_block': '#3FBF6F',
  'minecraft:quartz_block': '#ECE6DE',
  'minecraft:black_concrete': '#141518',
};
/** 字标的方块：深色主题石英块（偶尔一块钻石块），浅色主题黑色混凝土（偶尔一块青金石） */
const LETTER_IDS = { dark: ['minecraft:quartz_block', 'minecraft:diamond_block'], light: ['minecraft:black_concrete', 'minecraft:lapis_block'] } as const;

/** 机位之间在世界里竖着隔多远 */
export const STATION_GAP = 64;
/** 每个机位的相机（相对机位中心）和方块密度：首屏最满，正文多的几节稀一些 */
const CAMS: { p: [number, number, number]; l: [number, number, number]; density: number; mirror: boolean }[] = [
  { p: [0, 0, 16], l: [0, 0, 0], density: 1, mirror: false }, // 首屏
  { p: [-1.5, 0.5, 17], l: [1.5, 0, 0], density: 0.75, mirror: true }, // 工作流
  { p: [0, 0, 22], l: [0, 0, 0], density: 0.45, mirror: false }, // 剪辑点
  { p: [2, 1, 26], l: [0, 0, 0], density: 0.35, mirror: true }, // 试用
  { p: [-2, 1.5, 20], l: [0, 0, 0], density: 0.5, mirror: false }, // 模板
  { p: [2, -1, 20], l: [0, 0, 0], density: 0.5, mirror: true }, // 特性
  { p: [0, 0, 18], l: [0, 0, 0], density: 0.6, mirror: false }, // 开源
  { p: [0, 0.5, 16], l: [0, 0, 0], density: 0.7, mirror: true }, // 页尾
];
export const STATION_COUNT = CAMS.length;

const layerOf = (z: number): Layer => (z < -5 ? 0 : z > 2.5 ? 2 : 1);

function h01(n: number, seed: number): number {
  let x = Math.imul(n + 1, 2654435761) ^ Math.imul(seed + 7, 1597334677);
  x = Math.imul(x ^ (x >>> 15), 2246822519);
  x = Math.imul(x ^ (x >>> 13), 3266489917);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

const BOX_FACES: Face[] = ['east', 'west', 'up', 'down', 'south', 'north'];

/** 一张贴图（动画贴图只取第一帧）和它的平均色（碎块用） */
async function faceTexture(id: string): Promise<{ tex: THREE.Texture; avg: THREE.Color } | null> {
  const r = await mcTexture(id);
  if (!r) return null;
  const bitmap = await createImageBitmap(new Blob([new Uint8Array(r.png)], { type: 'image/png' }));
  const w = bitmap.width;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = w;
  const g = canvas.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(bitmap, 0, 0, w, w, 0, 0, w, w);
  bitmap.close();
  const px = g.getImageData(0, 0, w, w).data;
  let rr = 0;
  let gg = 0;
  let bb = 0;
  let n = 0;
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3]! < 128) continue;
    rr += px[i]!;
    gg += px[i + 1]!;
    bb += px[i + 2]!;
    n++;
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestMipmapLinearFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const avg = new THREE.Color().setRGB(rr / n / 255, gg / n / 255, bb / n / 255, THREE.SRGBColorSpace);
  return { tex, avg };
}

const BLUR_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const BLUR_FRAG = /* glsl */ `
uniform sampler2D tMap;
uniform vec2 uDir;
varying vec2 vUv;
void main() {
  vec4 c = texture2D(tMap, vUv) * 0.2270270270;
  c += texture2D(tMap, vUv + uDir * 1.3846153846) * 0.3162162162;
  c += texture2D(tMap, vUv - uDir * 1.3846153846) * 0.3162162162;
  c += texture2D(tMap, vUv + uDir * 3.2307692308) * 0.0702702703;
  c += texture2D(tMap, vUv - uDir * 3.2307692308) * 0.0702702703;
  gl_FragColor = c;
}`;
const COMPOSITE_FRAG = /* glsl */ `
uniform sampler2D tMap;
uniform float uOpacity;
varying vec2 vUv;
void main() {
  vec4 c = texture2D(tMap, vUv);
  vec3 rgb = c.a > 0.0001 ? c.rgb / c.a : vec3(0.0);
  gl_FragColor = vec4(rgb, c.a * uOpacity);
  #include <colorspace_fragment>
  gl_FragColor.rgb *= gl_FragColor.a;
}`;

/** 一块会动的方块（漂浮的、字标里的都用它） */
interface Block {
  group: THREE.InstancedMesh;
  index: number;
  /** 世界里的基准位置 */
  base: THREE.Vector3;
  size: number;
  rot: THREE.Euler;
  spin: THREE.Vector3;
  phase: number;
  /** 被指针推开的偏移和速度 */
  push: THREE.Vector3;
  pushV: THREE.Vector3;
  /** 敲碎的时刻（毫秒，0 表示完好） */
  brokenAt: number;
  /** 敲碎后多久长回来 */
  regrowMs: number;
  avg: THREE.Color;
  station: number;
  /** 给正文让位的程度（0 完整、1 缩没了），平滑地变 */
  hide: number;
}

interface Particle {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  born: number;
  size: number;
}

export interface WorldFrame {
  now: number;
  dt: number;
  /** 当前该在哪个机位（由滚动位置决定） */
  station: number;
  /** 指针的归一化坐标（−1–1，y 向下），没有指针时为 null */
  pointer: { x: number; y: number } | null;
  /** 页尾字标在视口里的位置（CSS 像素）；不在视口里时为 null */
  wordmark: { left: number; top: number; height: number } | null;
  /** 悦灵：视口坐标（CSS 像素）、显示尺寸、当前帧在图集里的序号、朝向；不出场时为 null */
  allay: { x: number; y: number; size: number; frame: number; facing: 1 | -1; tilt: number } | null;
  vw: number;
  vh: number;
  /** 减少动效：不漂浮、不入场、不跟鼠标，相机直接到位 */
  still: boolean;
  /** 正文在视口里的位置（CSS 像素，每 4 个数一个框：左、上、右、下）：落在这些框后面的方块缩起来让位 */
  textRects: Float32Array | null;
}

export interface WordmarkGrid {
  cols: number;
  rows: number;
  /** 有方块的格子（列、行） */
  cells: [number, number][];
}

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpS = new THREE.Vector3();
const tmpV = new THREE.Vector3();
const tmpV2 = new THREE.Vector3();
const tmpE = new THREE.Euler();

export class World {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(30, 1, 0.1, 400);
  private readonly rtA: THREE.WebGLRenderTarget;
  private readonly rtB: THREE.WebGLRenderTarget;
  private readonly quad: THREE.Mesh;
  private readonly blurMat: THREE.ShaderMaterial;
  private readonly compMat: THREE.ShaderMaterial;
  private readonly quadScene = new THREE.Scene();
  private readonly quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly cursorLight: THREE.PointLight;
  private readonly rim: THREE.DirectionalLight;
  private readonly key: THREE.DirectionalLight;
  private readonly ambient: THREE.AmbientLight;
  private readonly geo = new THREE.BoxGeometry(1, 1, 1);
  private readonly blocks: Block[] = [];
  private readonly letters: Block[] = [];
  private readonly groups: THREE.InstancedMesh[] = [];
  private readonly matsByType = new Map<string, THREE.MeshLambertMaterial[]>();
  private readonly avgByType = new Map<string, THREE.Color>();
  private readonly dimMaterials: THREE.MeshLambertMaterial[] = [];
  private readonly allMaterials: THREE.MeshLambertMaterial[] = [];
  private particles!: THREE.InstancedMesh;
  private readonly parts: Particle[] = [];
  private partNext = 0;
  private letterMesh: THREE.InstancedMesh | null = null;
  private letterGrid: WordmarkGrid | null = null;
  private letterState: 'gone' | 'assembling' | 'ready' = 'gone';
  private letterT0 = 0;
  private letterStart: THREE.Vector3[] = [];
  private allayMesh: THREE.Mesh | null = null;
  private allayMat: THREE.MeshBasicMaterial | null = null;
  private allayAtlas: { columns: number; rx: number; ry: number } | null = null;
  private width = 1;
  private height = 1;
  private aspect = 1;
  private narrow = false;
  private theme: 'dark' | 'light' = 'dark';
  private camPos = new THREE.Vector3(0, 0, 16);
  private camVel = new THREE.Vector3();
  private lookPos = new THREE.Vector3();
  private lookVel = new THREE.Vector3();
  private lightPos = new THREE.Vector3(2, 1, 4);
  private firstFrame = true;
  private t0 = 0;
  private disposed = false;
  /** 相机落到机位、字标拼好（或不在）时为真 */
  settled = true;

  private constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, premultipliedAlpha: true, powerPreference: 'high-performance' });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.autoClear = false;
    const rt = () => new THREE.WebGLRenderTarget(4, 4, { depthBuffer: true, type: THREE.HalfFloatType });
    this.rtA = rt();
    this.rtB = rt();
    this.blurMat = new THREE.ShaderMaterial({ uniforms: { tMap: { value: null }, uDir: { value: new THREE.Vector2() } }, vertexShader: BLUR_VERT, fragmentShader: BLUR_FRAG, depthTest: false, depthWrite: false });
    this.compMat = new THREE.ShaderMaterial({
      uniforms: { tMap: { value: null }, uOpacity: { value: 1 } },
      vertexShader: BLUR_VERT,
      fragmentShader: COMPOSITE_FRAG,
      depthTest: false,
      depthWrite: false,
      transparent: true,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      premultipliedAlpha: false,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.blurMat);
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);

    this.ambient = new THREE.AmbientLight(0xffffff, 0.55);
    this.key = new THREE.DirectionalLight(0xffffff, 2.1);
    this.key.position.set(-4, 6, 7);
    this.rim = new THREE.DirectionalLight(0x3cb7f4, 3.2);
    this.rim.position.set(5, -2, -6);
    this.cursorLight = new THREE.PointLight(0x3cb7f4, 38, 0, 1.4);
    const hemi = new THREE.HemisphereLight(0x9fdcfa, 0x0d0d0e, 0.6);
    for (const l of [this.ambient, this.key, this.rim, this.cursorLight, hemi]) {
      l.layers.enableAll();
      this.scene.add(l);
    }
    // 方向光跟着相机走（机位在世界里竖着排开）
    this.scene.add(this.key.target, this.rim.target);
    this.camera.layers.enableAll();
  }

  static async create(canvas: HTMLCanvasElement, opts: { theme: 'dark' | 'light'; narrow: boolean }): Promise<World> {
    const w = new World(canvas);
    w.theme = opts.theme;
    w.narrow = opts.narrow;
    await w.build();
    w.applyTheme();
    return w;
  }

  private async materialsFor(id: string, cache: Map<string, Promise<{ tex: THREE.Texture; avg: THREE.Color } | null>>): Promise<THREE.MeshLambertMaterial[]> {
    const hit = this.matsByType.get(id);
    if (hit) return hit;
    const def = BLOCKS[id];
    const faces = def ? resolveBlockFaces(def).faces : null;
    const tex = (tid: string) => {
      let p = cache.get(tid);
      if (!p) {
        p = mcGameVersion ? faceTexture(tid).catch(() => null) : Promise.resolve(null);
        cache.set(tid, p);
      }
      return p;
    };
    const emissive = EMISSIVE.has(id);
    let avg: THREE.Color | null = null;
    const mats = await Promise.all(
      BOX_FACES.map(async (f) => {
        const t = faces ? await tex(faces[f].texture) : null;
        if (t && f === 'north') avg = t.avg;
        const m = new THREE.MeshLambertMaterial(t ? { map: t.tex } : { color: new THREE.Color(FALLBACK[id] ?? '#888888') });
        if (emissive) {
          m.emissive = new THREE.Color(0xffffff);
          if (t) m.emissiveMap = t.tex;
          m.emissiveIntensity = t ? 0.85 : 0.35;
        }
        this.allMaterials.push(m);
        return m;
      }),
    );
    this.matsByType.set(id, mats);
    this.avgByType.set(id, avg ?? new THREE.Color(FALLBACK[id] ?? '#888888'));
    return mats;
  }

  private async build(): Promise<void> {
    const cache = new Map<string, Promise<{ tex: THREE.Texture; avg: THREE.Color } | null>>();
    // 先把每个机位要放哪些方块算出来（确定性的抽稀和镜像），再按“方块类型 × 层”建实例化网格
    const plan: { spec: Spec; station: number; layer: Layer; i: number }[] = [];
    CAMS.forEach((cam, st) => {
      const density = cam.density * (this.narrow ? 0.6 : 1);
      SPECS.forEach((spec, i) => {
        if (st > 0 && h01(i, st * 31) > density) return;
        const x = cam.mirror ? -spec.x : spec.x;
        const y = st === 0 ? spec.y : spec.y + (h01(i, st) - 0.5) * 2.4;
        plan.push({ spec: { ...spec, x, y, id: st === 0 ? spec.id : SPECS[(i + st * 5) % SPECS.length]!.id }, station: st, layer: layerOf(spec.z), i: plan.length });
      });
    });
    const keyOf = (id: string, layer: Layer) => `${id}|${layer}`;
    const counts = new Map<string, number>();
    for (const p of plan) counts.set(keyOf(p.spec.id, p.layer), (counts.get(keyOf(p.spec.id, p.layer)) ?? 0) + 1);
    const meshes = new Map<string, THREE.InstancedMesh>();
    const used = new Map<string, number>();
    for (const [k, n] of counts) {
      const [id, layerStr] = k.split('|') as [string, string];
      const layer = Number(layerStr) as Layer;
      let mats = await this.materialsFor(id, cache);
      if (layer === 0) {
        // 远层：单独一套材质（深色主题压暗、浅色主题蒙一层雾）
        mats = mats.map((m) => {
          const c = m.clone();
          this.dimMaterials.push(c);
          this.allMaterials.push(c);
          return c;
        });
      }
      const mesh = new THREE.InstancedMesh(this.geo, mats, n);
      mesh.frustumCulled = false;
      mesh.layers.set(layer);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      // 实例矩阵默认是单位矩阵（一块方块摆在原点）：先全部缩成 0，离相机远、这一帧不更新的也不会冒出来
      for (let i = 0; i < n; i++) mesh.setMatrixAt(i, tmpM.makeScale(0, 0, 0));
      this.scene.add(mesh);
      this.groups.push(mesh);
      meshes.set(k, mesh);
      used.set(k, 0);
    }
    for (const p of plan) {
      const k = keyOf(p.spec.id, p.layer);
      const mesh = meshes.get(k)!;
      const index = used.get(k)!;
      used.set(k, index + 1);
      const cy = -p.station * STATION_GAP;
      this.blocks.push({
        group: mesh,
        index,
        base: new THREE.Vector3(p.spec.x, cy + p.spec.y, p.spec.z),
        size: p.spec.s * (this.narrow ? 0.72 : 1),
        rot: new THREE.Euler(h01(p.i, 1) * Math.PI * 2, h01(p.i, 2) * Math.PI * 2, h01(p.i, 3) * 0.6),
        spin: new THREE.Vector3((h01(p.i, 5) - 0.5) * 0.3, (h01(p.i, 6) - 0.5) * 0.5 + 0.12, (h01(p.i, 7) - 0.5) * 0.2),
        phase: h01(p.i, 4) * Math.PI * 2,
        push: new THREE.Vector3(),
        pushV: new THREE.Vector3(),
        brokenAt: 0,
        regrowMs: 3500 + h01(p.i, 9) * 2500,
        avg: this.avgByType.get(p.spec.id)!,
        station: p.station,
        hide: 0,
      });
    }
    // 碎块：一个小方块的实例池
    const pm = new THREE.MeshLambertMaterial({ color: 0xffffff });
    this.allMaterials.push(pm);
    this.particles = new THREE.InstancedMesh(this.geo, pm, 160);
    this.particles.frustumCulled = false;
    this.particles.layers.set(1);
    this.particles.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < 160; i++) {
      this.particles.setMatrixAt(i, tmpM.makeScale(0, 0, 0));
      this.particles.setColorAt(i, new THREE.Color(1, 1, 1));
    }
    this.scene.add(this.particles);
    // 字标的方块材质预先装好（主题一变就换）
    await Promise.all([...LETTER_IDS.dark, ...LETTER_IDS.light].map((id) => this.materialsFor(id, cache)));
  }

  setTheme(theme: 'dark' | 'light'): void {
    this.theme = theme;
    this.applyTheme();
    if (this.letterGrid) this.buildLetters(this.letterGrid);
  }

  private applyTheme(): void {
    const light = this.theme === 'light';
    this.ambient.intensity = light ? 1.15 : 0.5;
    this.key.intensity = light ? 1.9 : 2.1;
    this.rim.color.set(light ? 0x0b6aa6 : 0x3cb7f4);
    this.rim.intensity = light ? 1.6 : 3.4;
    this.cursorLight.color.set(light ? 0x2b8fd6 : 0x3cb7f4);
    this.cursorLight.intensity = light ? 26 : 42;
    for (const m of this.dimMaterials) {
      m.color.setScalar(light ? 0.92 : 0.5);
      if (!m.emissiveMap) {
        m.emissive.set(light ? 0xe4e8ef : 0x000000);
        m.emissiveIntensity = light ? 0.45 : 0;
      }
    }
  }

  /** 页尾字标的点阵（由页面按 DOM 里那段字的字体栅格化出来） */
  setWordmark(grid: WordmarkGrid): void {
    this.letterGrid = grid;
    this.buildLetters(grid);
  }

  private buildLetters(grid: WordmarkGrid): void {
    if (this.letterMesh) {
      this.scene.remove(this.letterMesh);
      this.letterMesh.dispose();
      this.letterMesh = null;
    }
    this.letters.length = 0;
    const [mainId, accentId] = LETTER_IDS[this.theme];
    const mats = this.matsByType.get(mainId);
    const accent = this.matsByType.get(accentId);
    if (!mats || !accent) return;
    // 两种方块各一个实例化网格：主色和零星的强调色
    const isAccent = grid.cells.map((_, i) => h01(i, 77) < 0.06);
    const nA = isAccent.filter(Boolean).length;
    const main = new THREE.InstancedMesh(this.geo, mats, grid.cells.length - nA);
    const acc = new THREE.InstancedMesh(this.geo, accent, Math.max(1, nA));
    for (const m of [main, acc]) {
      m.frustumCulled = false;
      m.layers.set(1);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.scene.add(m);
    }
    let iMain = 0;
    let iAcc = 0;
    grid.cells.forEach((_, i) => {
      const a = isAccent[i]!;
      const group = a ? acc : main;
      const index = a ? iAcc++ : iMain++;
      group.setMatrixAt(index, tmpM.makeScale(0, 0, 0));
      this.letters.push({
        group,
        index,
        base: new THREE.Vector3(),
        size: 1,
        rot: new THREE.Euler(),
        spin: new THREE.Vector3(),
        phase: h01(i, 11) * Math.PI * 2,
        push: new THREE.Vector3(),
        pushV: new THREE.Vector3(),
        brokenAt: 0,
        regrowMs: 2600 + h01(i, 12) * 1800,
        avg: this.avgByType.get(a ? accentId : mainId)!,
        station: -1,
        hide: 0,
      });
    });
    // 两个网格都登记起来（销毁、换主题时一起处理）
    this.letterMesh = main;
    this.letterExtra = acc;
    this.letterState = 'gone';
  }

  private letterExtra: THREE.InstancedMesh | null = null;

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
    this.allayMesh.layers.set(1);
    this.allayMesh.renderOrder = 5;
    this.allayMesh.visible = false;
    this.scene.add(this.allayMesh);
  }

  resize(width: number, height: number): void {
    this.width = Math.max(2, Math.round(width));
    this.height = Math.max(2, Math.round(height));
    this.aspect = this.width / this.height;
    this.renderer.setSize(this.width, this.height, false);
    const hw = Math.max(2, Math.round(this.width / 2));
    const hh = Math.max(2, Math.round(this.height / 2));
    this.rtA.setSize(hw, hh);
    this.rtB.setSize(hw, hh);
    this.camera.aspect = this.aspect;
    this.camera.fov = this.aspect < 1 ? 44 : 30;
    this.camera.updateProjectionMatrix();
  }

  /** 视口坐标（CSS 像素）→ 世界里 z = zPlane 那个平面上的点（用当前相机） */
  private unproject(x: number, y: number, vw: number, vh: number, zPlane: number, out: THREE.Vector3): THREE.Vector3 {
    tmpV2.set((x / vw) * 2 - 1, -(y / vh) * 2 + 1, 0.5).unproject(this.camera);
    tmpV2.sub(this.camera.position).normalize();
    const t = (zPlane - this.camera.position.z) / tmpV2.z;
    return out.copy(this.camera.position).addScaledVector(tmpV2, t);
  }

  /** 在 z = zPlane 处，一个 CSS 像素对应多少世界单位 */
  private unitsPerPx(vh: number, zPlane: number): number {
    const dist = this.camera.position.z - zPlane;
    return (2 * Math.tan((this.camera.fov * Math.PI) / 360) * dist) / vh;
  }

  /** 点一下：指针下面有完好的方块就敲碎它。返回是否敲到了 */
  pick(ndcX: number, ndcY: number, now: number): boolean {
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(ndcX, -ndcY), this.camera);
    let best: { b: Block; d: number; p: THREE.Vector3 } | null = null;
    const cands = [...this.blocks, ...(this.letterState === 'ready' ? this.letters : [])];
    for (const b of cands) {
      if (b.brokenAt) continue;
      if (b.group.layers.mask & 1) continue; // 远层不让敲（虚化的远景）
      const p = tmpV.copy(b.base).add(b.push);
      const r = b.size * 0.75;
      const toC = p.clone().sub(ray.ray.origin);
      const along = toC.dot(ray.ray.direction);
      if (along < 0) continue;
      const d2 = toC.lengthSq() - along * along;
      if (d2 > r * r) continue;
      if (!best || along < best.d) best = { b, d: along, p: p.clone() };
    }
    if (!best) return false;
    best.b.brokenAt = now;
    // 碎成 8 块，带着方块的平均色往外崩、受重力掉下去
    for (let i = 0; i < 8; i++) {
      const k = this.partNext++ % 160;
      const part = this.parts[k] ?? { pos: new THREE.Vector3(), vel: new THREE.Vector3(), born: 0, size: 0 };
      part.pos.copy(best.p).add(new THREE.Vector3((i & 1) - 0.5, ((i >> 1) & 1) - 0.5, ((i >> 2) & 1) - 0.5).multiplyScalar(best.b.size * 0.5));
      part.vel.set((Math.random() - 0.5) * 6, Math.random() * 6 + 2, (Math.random() - 0.5) * 6).multiplyScalar(best.b.size);
      part.born = now;
      part.size = best.b.size * 0.32;
      this.parts[k] = part;
      this.particles.setColorAt(k, best.b.avg);
    }
    if (this.particles.instanceColor) this.particles.instanceColor.needsUpdate = true;
    return true;
  }

  /** 指针下面有没有能敲的方块（给光标反馈用） */
  hovering(ndcX: number, ndcY: number): boolean {
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(ndcX, -ndcY), this.camera);
    for (const b of this.blocks) {
      if (b.brokenAt || b.group.layers.mask & 1) continue;
      const p = tmpV.copy(b.base).add(b.push);
      const r = b.size * 0.75;
      const toC = p.sub(ray.ray.origin);
      const along = toC.dot(ray.ray.direction);
      if (along > 0 && toC.lengthSq() - along * along < r * r) return true;
    }
    return false;
  }

  frame(f: WorldFrame): void {
    if (this.disposed) return;
    this.t0 ||= f.now;
    const ms = f.still ? 1e6 : f.now - this.t0;
    const t = ms / 1000;
    const dt = f.still ? 1 : f.dt;

    // 相机：机位由滚动决定，位置用弹簧追过去（第一帧、减少动效时直接到位）
    const cam = CAMS[Math.max(0, Math.min(CAMS.length - 1, f.station))]!;
    const cy = -f.station * STATION_GAP;
    const px = f.pointer && !f.still ? f.pointer.x : 0;
    const py = f.pointer && !f.still ? f.pointer.y : 0;
    const target = tmpV.set(cam.p[0] + px * 0.9, cy + cam.p[1] - py * 0.55, cam.p[2]);
    const look = tmpV2.set(cam.l[0], cy + cam.l[1], cam.l[2]);
    if (this.firstFrame || f.still) {
      this.camPos.copy(target);
      this.lookPos.copy(look);
      this.camVel.set(0, 0, 0);
      this.lookVel.set(0, 0, 0);
      this.firstFrame = false;
    } else {
      // 大跳（锚点、连按 PageDown）：先切到离目标一个半机位的地方再飞过去，飞行总在一秒多一点之内，不把中间各节都放一遍
      const dy = target.y - this.camPos.y;
      if (Math.abs(dy) > STATION_GAP * 1.5) {
        const jump = dy - Math.sign(dy) * STATION_GAP * 1.5;
        this.camPos.y += jump;
        this.lookPos.y += jump;
        this.camVel.set(0, 0, 0);
        this.lookVel.set(0, 0, 0);
      }
      springVec(this.camPos, this.camVel, target, 4.4, dt);
      springVec(this.lookPos, this.lookVel, look, 4.4, dt);
      if (this.camPos.distanceTo(target) < 0.12 && this.camVel.length() < 0.2) {
        this.camPos.copy(target);
        this.lookPos.copy(look);
        this.camVel.set(0, 0, 0);
        this.lookVel.set(0, 0, 0);
      }
    }
    const travelling = !this.camPos.equals(target);
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.lookPos);
    this.key.position.set(this.camPos.x - 4, this.camPos.y + 6, 7);
    this.key.target.position.set(this.lookPos.x, this.lookPos.y, 0);
    this.rim.position.set(this.camPos.x + 5, this.camPos.y - 2, -6);
    this.rim.target.position.set(this.lookPos.x, this.lookPos.y, 0);

    // 指针：点光跟着走，附近的方块被推开
    const ray = f.pointer && !f.still ? new THREE.Raycaster() : null;
    if (ray) ray.setFromCamera(new THREE.Vector2(f.pointer!.x, -f.pointer!.y), this.camera);
    const vFov = (this.camera.fov * Math.PI) / 180;
    const hh = Math.tan(vFov / 2) * 13;
    const lx = f.pointer ? f.pointer.x * hh * this.aspect : Math.cos(t * 0.3) * 4;
    const ly = f.pointer ? -f.pointer.y * hh : Math.sin(t * 0.4) * 2 + 1;
    this.lightPos.lerp(new THREE.Vector3(this.camPos.x + lx, this.camPos.y + ly, 3), f.still ? 1 : 0.12);
    this.cursorLight.position.copy(this.lightPos);

    const squeeze = Math.min(1, this.aspect / 1.55);
    const halfW = Math.tan((this.camera.fov * Math.PI) / 360) * 16 * this.aspect;
    const narrow = this.aspect < 1;
    const updatePush = (b: Block, pos: THREE.Vector3) => {
      let tx = 0;
      let ty = 0;
      if (ray && !b.brokenAt) {
        const toC = tmpV2.copy(pos).sub(ray.ray.origin);
        const along = toC.dot(ray.ray.direction);
        const closest = ray.ray.origin.clone().addScaledVector(ray.ray.direction, along);
        const off = pos.clone().sub(closest);
        const d = off.length();
        const R = 2.4 * Math.max(0.6, b.size);
        if (along > 0 && d < R && d > 1e-4) {
          off.multiplyScalar(((R - d) / d) * 0.9);
          tx = off.x;
          ty = off.y;
        }
      }
      b.pushV.x += ((tx - b.push.x) * 60 - b.pushV.x * 12) * dt;
      b.pushV.y += ((ty - b.push.y) * 60 - b.pushV.y * 12) * dt;
      b.push.x += b.pushV.x * dt;
      b.push.y += b.pushV.y * dt;
    };

    // 正文让位：方块投到屏幕上落在正文框里（远层除外，它是虚化的远景），就缩起来
    const rects = f.textRects;
    const pxPerUnitAt = (z: number) => f.vh / (2 * Math.tan((this.camera.fov * Math.PI) / 360) * Math.max(0.5, this.camera.position.z - z));
    const behindText = (pos: THREE.Vector3, size: number): boolean => {
      if (!rects || rects.length === 0) return false;
      tmpV2.copy(pos).project(this.camera);
      if (tmpV2.z > 1) return false;
      const sx = (tmpV2.x * 0.5 + 0.5) * f.vw;
      const sy = (-tmpV2.y * 0.5 + 0.5) * f.vh;
      const r = size * 0.8 * pxPerUnitAt(pos.z);
      for (let i = 0; i < rects.length; i += 4) {
        if (sx + r > rects[i]! && sx - r < rects[i + 2]! && sy + r > rects[i + 1]! && sy - r < rects[i + 3]!) return true;
      }
      return false;
    };
    const hideStep = Math.min(1, dt * 7);

    // 漂浮的方块
    for (const b of this.blocks) {
      // 离相机太远的不更新（看不见）
      if (Math.abs(b.base.y - this.camPos.y) > STATION_GAP * 1.6 && !travelling) continue;
      const pop = popScale(ms, 120 + (b.index % 24) * 45, f.still);
      const bob = f.still ? 0 : Math.sin(t * (0.5 + (b.phase % 0.4)) + b.phase) * 0.16 * b.size;
      const x = narrow && !(b.group.layers.mask & 1) ? Math.sign(b.base.x || 1) * (halfW * 0.92 + Math.abs(b.base.x) * 0.12) : b.base.x * squeeze;
      const pos = tmpS.set(x, b.base.y + bob, b.base.z);
      updatePush(b, pos);
      pos.add(b.push);
      let scale = b.size * pop;
      if (b.brokenAt) {
        const since = f.now - b.brokenAt;
        if (since < 140) scale *= 1 - since / 140;
        else if (since < b.regrowMs) scale = 0;
        else if (since < b.regrowMs + 520) scale *= popCurve((since - b.regrowMs) / 520);
        else b.brokenAt = 0;
      }
      // 远景层虚化、压暗，宽屏上留着当景深；窄屏上正文占满宽度，远景也让位
      if (!(b.group.layers.mask & 1) || narrow) {
        const want = behindText(pos, b.size) ? 1 : 0;
        b.hide += (want - b.hide) * (f.still ? 1 : hideStep);
        scale *= 1 - easeInOut(b.hide);
      }
      tmpE.set(b.rot.x + t * b.spin.x, b.rot.y + t * b.spin.y, b.rot.z + Math.sin(t * 0.4 + b.phase) * 0.08 + t * b.spin.z);
      tmpQ.setFromEuler(tmpE);
      tmpM.compose(pos, tmpQ, new THREE.Vector3(scale, scale, scale));
      b.group.setMatrixAt(b.index, tmpM);
    }
    for (const g of this.groups) g.instanceMatrix.needsUpdate = true;

    // 页尾的字标：对齐 DOM 里那段字（视口坐标 → 世界），走到页尾时从四面飞进来拼好
    let lettersBusy = false;
    if (this.letterGrid && this.letterMesh) {
      const grid = this.letterGrid;
      const wm = f.wordmark;
      if (!wm) {
        if (this.letterState !== 'gone') {
          this.letterState = 'gone';
          for (const b of this.letters) b.group.setMatrixAt(b.index, tmpM.makeScale(0, 0, 0));
        }
      } else {
        const zPlane = 0;
        const cellPx = wm.height / grid.rows;
        const upp = this.unitsPerPx(f.vh, zPlane);
        const size = cellPx * upp * 0.98;
        if (this.letterState === 'gone') {
          this.letterState = f.still ? 'ready' : 'assembling';
          this.letterT0 = f.now;
          this.letterStart = this.letters.map((_, i) =>
            this.unproject(wm.left + grid.cells[i]![0] * cellPx, wm.top + grid.cells[i]![1] * cellPx, f.vw, f.vh, zPlane, new THREE.Vector3()).add(
              new THREE.Vector3((h01(i, 21) - 0.5) * 30, -8 - h01(i, 22) * 16, -10 - h01(i, 23) * 20),
            ),
          );
        }
        const span = 1100;
        let allDone = true;
        this.letters.forEach((b, i) => {
          const [gx, gy] = grid.cells[i]!;
          const target = this.unproject(wm.left + (gx + 0.5) * cellPx, wm.top + (gy + 0.5) * cellPx, f.vw, f.vh, zPlane, tmpS);
          target.z += (h01(i, 31) - 0.5) * size * 0.6;
          let p = 1;
          if (this.letterState === 'assembling') {
            const delay = (gx / grid.cols) * 700 + h01(i, 33) * 220;
            p = Math.min(1, Math.max(0, (f.now - this.letterT0 - delay) / span));
            if (p < 1) allDone = false;
          }
          const e = 1 - (1 - p) ** 3;
          const pos = new THREE.Vector3().lerpVectors(this.letterStart[i] ?? target, target, e);
          // 半路往镜头这边抬一点，像被抛进来
          pos.z += Math.sin(Math.PI * e) * 4;
          updatePush(b, pos);
          pos.add(b.push);
          let scale = size * Math.min(1, e * 1.4);
          if (b.brokenAt) {
            const since = f.now - b.brokenAt;
            if (since < 120) scale *= 1 - since / 120;
            else if (since < b.regrowMs) scale = 0;
            else if (since < b.regrowMs + 480) scale *= popCurve((since - b.regrowMs) / 480);
            else b.brokenAt = 0;
          }
          tmpE.set((1 - e) * (h01(i, 41) - 0.5) * 6, (1 - e) * (h01(i, 42) - 0.5) * 6, 0);
          tmpQ.setFromEuler(tmpE);
          tmpM.compose(pos, tmpQ, new THREE.Vector3(scale, scale, scale));
          b.group.setMatrixAt(b.index, tmpM);
          b.base.copy(pos);
          b.size = size;
        });
        if (this.letterState === 'assembling' && allDone) this.letterState = 'ready';
        lettersBusy = this.letterState === 'assembling';
      }
      this.letterMesh.instanceMatrix.needsUpdate = true;
      if (this.letterExtra) this.letterExtra.instanceMatrix.needsUpdate = true;
    }

    // 碎块
    let anyPart = false;
    for (let i = 0; i < this.parts.length; i++) {
      const p = this.parts[i];
      if (!p) continue;
      const age = (f.now - p.born) / 1000;
      if (age > 1.1) {
        this.particles.setMatrixAt(i, tmpM.makeScale(0, 0, 0));
        continue;
      }
      anyPart = true;
      p.vel.y -= 22 * dt;
      p.pos.addScaledVector(p.vel, dt);
      const s = p.size * (1 - Math.max(0, age - 0.7) / 0.4);
      tmpM.compose(p.pos, tmpQ.setFromEuler(tmpE.set(age * 7, age * 5, 0)), new THREE.Vector3(s, s, s));
      this.particles.setMatrixAt(i, tmpM);
    }
    this.particles.instanceMatrix.needsUpdate = true;

    // 悦灵：视口坐标 → 世界（放在焦平面略靠前），按图集的帧取格子
    if (this.allayMesh && this.allayAtlas && this.allayMat) {
      const a = f.allay;
      this.allayMesh.visible = !!a;
      if (a) {
        const zPlane = 1.2;
        this.unproject(a.x, a.y, f.vw, f.vh, zPlane, this.allayMesh.position);
        const s = a.size * this.unitsPerPx(f.vh, zPlane);
        this.allayMesh.scale.set(s * a.facing, s, 1);
        this.allayMesh.quaternion.copy(this.camera.quaternion);
        this.allayMesh.rotateZ((-a.tilt * Math.PI) / 180);
        const map = this.allayMat.map!;
        const col = a.frame % this.allayAtlas.columns;
        const row = Math.floor(a.frame / this.allayAtlas.columns);
        map.offset.set(col * this.allayAtlas.rx, (row + 1) * this.allayAtlas.ry);
      }
    }

    this.settled = !travelling && !lettersBusy;
    this.render(anyPart);
  }

  private renderBlurred(layer: Layer, radius: number, opacity: number): void {
    const r = this.renderer;
    this.camera.layers.set(layer);
    r.setRenderTarget(this.rtA);
    r.setClearColor(0x000000, 0);
    r.clear(true, true, true);
    r.render(this.scene, this.camera);
    this.quad.material = this.blurMat;
    for (let pass = 0; pass < 2; pass++) {
      const s = radius * (pass + 1) * 0.5;
      this.blurMat.uniforms.tMap!.value = this.rtA.texture;
      (this.blurMat.uniforms.uDir!.value as THREE.Vector2).set(s / this.rtA.width, 0);
      r.setRenderTarget(this.rtB);
      r.clear(true, false, false);
      r.render(this.quadScene, this.quadCam);
      this.blurMat.uniforms.tMap!.value = this.rtB.texture;
      (this.blurMat.uniforms.uDir!.value as THREE.Vector2).set(0, s / this.rtA.height);
      r.setRenderTarget(this.rtA);
      r.clear(true, false, false);
      r.render(this.quadScene, this.quadCam);
    }
    this.quad.material = this.compMat;
    this.compMat.uniforms.tMap!.value = this.rtA.texture;
    this.compMat.uniforms.uOpacity!.value = opacity;
    r.setRenderTarget(null);
    r.render(this.quadScene, this.quadCam);
  }

  private render(_parts: boolean): void {
    const r = this.renderer;
    r.setRenderTarget(null);
    r.setClearColor(0x000000, 0);
    r.clear(true, true, true);
    this.renderBlurred(0, 2.2, 1);
    this.camera.layers.set(1);
    r.setRenderTarget(null);
    r.clearDepth();
    r.render(this.scene, this.camera);
    this.renderBlurred(2, 4.5, 0.95);
    this.camera.layers.enableAll();
  }

  dispose(): void {
    this.disposed = true;
    for (const m of this.allMaterials) {
      m.map?.dispose();
      m.dispose();
    }
    this.allayMat?.map?.dispose();
    this.allayMat?.dispose();
    this.blurMat.dispose();
    this.compMat.dispose();
    this.rtA.dispose();
    this.rtB.dispose();
    this.geo.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}

function easeInOut(x: number): number {
  return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;
}

/** 入场：按顺序带一点过冲地弹出 */
function popScale(ms: number, delay: number, still: boolean): number {
  if (still) return 1;
  return Math.max(0.0001, popCurve(Math.min(1, Math.max(0, (ms - delay) / 900))));
}

function popCurve(p: number): number {
  const c1 = 1.5;
  return p >= 1 ? 1 : 1 + (c1 + 1) * (p - 1) ** 3 + c1 * (p - 1) ** 2;
}

/** 三维的临界阻尼弹簧 */
function springVec(pos: THREE.Vector3, vel: THREE.Vector3, target: THREE.Vector3, omega: number, dt: number): void {
  for (const k of ['x', 'y', 'z'] as const) {
    const x = pos[k] - target[k];
    const e = Math.exp(-omega * dt);
    const nx = (x + (vel[k] + omega * x) * dt) * e;
    const nv = (vel[k] - omega * (vel[k] + omega * x) * dt) * e;
    pos[k] = target[k] + nx;
    vel[k] = nv;
  }
}
