// 首屏的 3D 场景：几十块原版方块悬浮在空间里，有光照、有景深，对鼠标有反应。
// 用的是与引擎同一版本的 three，贴图来自官网专用的原版贴图（public/mc/，没有提取时用纯色）。
// 没有用引擎的模板来画它：模板的画面是时间的纯函数，不能每帧响应鼠标（docs/decisions.md 官网 · 第三版）。
//
// - 光：环境光 + 白色主光 + 品牌蓝的轮廓光（从背后打过来），以及一盏跟着指针走的品牌蓝点光——“光标附近的光”在 3D 里；
// - 景深：方块分三层，远层和近层先画进半分辨率的离屏缓冲、做两遍高斯模糊再合成，焦平面（中层）清晰；
// - 入场：方块按顺序带一点过冲地弹出来（与方块擦除模板同一种语言，但只在开场一次）；
// - 滚动：首屏往分镜过渡时，相机后退、方块向外散开（progress 0–1）。
// 这个模块是懒加载的（three 在单独的代码块里），首屏文字不等它。
import { BLOCKS, resolveBlockFaces, type Face } from '@allay/assets';
import * as THREE from 'three';
import { mcGameVersion, mcTexture } from '../../host/mc-pack';

type Layer = 0 | 1 | 2; // 远、中（焦平面）、近

interface Spec {
  x: number;
  y: number;
  z: number;
  s: number;
  id: string;
}

/** 手摆的构图（宽屏）：焦平面上的方块围着右下的预览面板和左上的标题，远处的虚化，近处两块大的压在角上 */
const SPECS: Spec[] = [
  // 焦平面
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
  // 远层（虚化）
  { x: -2.6, y: 1.4, z: -9, s: 1.4, id: 'minecraft:obsidian' },
  { x: 3.2, y: -1.0, z: -10, s: 1.6, id: 'minecraft:deepslate_bricks' },
  { x: -8.4, y: -0.8, z: -11, s: 1.5, id: 'minecraft:diamond_block' },
  { x: 9.0, y: 3.6, z: -12, s: 1.8, id: 'minecraft:amethyst_block' },
  { x: 0.4, y: 4.8, z: -13, s: 1.6, id: 'minecraft:packed_ice' },
  { x: -5.2, y: 4.9, z: -10, s: 1.2, id: 'minecraft:crying_obsidian' },
  { x: 1.6, y: -4.8, z: -9, s: 1.3, id: 'minecraft:emerald_block' },
  { x: 10.4, y: -4.2, z: -11, s: 1.4, id: 'minecraft:sea_lantern' },
  { x: -11, y: 3.2, z: -13, s: 1.6, id: 'minecraft:lapis_block' },
  // 近层（虚化、大）
  { x: -7.4, y: -5.3, z: 4.4, s: 1.5, id: 'minecraft:diamond_block' },
  { x: 7.2, y: 4.6, z: 3.8, s: 1.2, id: 'minecraft:amethyst_block' },
];

const EMISSIVE = new Set(['minecraft:sea_lantern', 'minecraft:glowstone', 'minecraft:crying_obsidian', 'minecraft:magma_block']);
/** 没有原版贴图时的纯色 */
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
};

const layerOf = (z: number): Layer => (z < -5 ? 0 : z > 2.5 ? 2 : 1);

/** 确定性的散列（0–1） */
function h01(n: number, seed: number): number {
  let x = Math.imul(n + 1, 2654435761) ^ Math.imul(seed + 7, 1597334677);
  x = Math.imul(x ^ (x >>> 15), 2246822519);
  x = Math.imul(x ^ (x >>> 13), 3266489917);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

const BOX_FACES: Face[] = ['east', 'west', 'up', 'down', 'south', 'north']; // BoxGeometry 的材质顺序：+x −x +y −y +z −z

async function faceTexture(id: string): Promise<THREE.Texture | null> {
  const r = await mcTexture(id);
  if (!r) return null;
  const bitmap = await createImageBitmap(new Blob([new Uint8Array(r.png)], { type: 'image/png' }));
  // 动画贴图（竖条）只取第一帧
  const w = bitmap.width;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = w;
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, w, w, 0, 0, w, w);
  bitmap.close();
  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestMipmapLinearFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
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

/** 离屏缓冲里是预乘的线性颜色；合成时转到输出色彩空间再预乘，按 (1, 1−αs) 混合 */
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

export interface HeroSceneFrame {
  now: number;
  /** 指针的归一化位置（−1–1），没有指针时为 null */
  pointer: { x: number; y: number } | null;
  /** 首屏 → 分镜的进度 0–1 */
  progress: number;
  /** 减少动效：不漂浮、不入场、不跟鼠标 */
  still: boolean;
}

export class HeroScene {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
  private readonly blocks: { mesh: THREE.Mesh; spec: Spec; layer: Layer; phase: number; spin: THREE.Vector3; base: THREE.Euler; delay: number }[] = [];
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
  private readonly materials: THREE.MeshLambertMaterial[] = [];
  private width = 1;
  private height = 1;
  private aspect = 1;
  private t0 = 0;
  private cam = { x: 0, y: 0 };
  private lightPos = new THREE.Vector3(2, 1, 4);
  private theme: 'dark' | 'light' = 'dark';
  private disposed = false;

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

    // 光
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
    this.camera.position.set(0, 0, 16);
    this.camera.layers.enableAll();
  }

  static async create(canvas: HTMLCanvasElement, theme: 'dark' | 'light'): Promise<HeroScene> {
    const scene = new HeroScene(canvas);
    scene.theme = theme;
    await scene.build();
    scene.applyTheme();
    return scene;
  }

  private async build(): Promise<void> {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const cache = new Map<string, Promise<THREE.Texture | null>>();
    const tex = (id: string) => {
      let p = cache.get(id);
      if (!p) {
        p = mcGameVersion ? faceTexture(id).catch(() => null) : Promise.resolve(null);
        cache.set(id, p);
      }
      return p;
    };
    await Promise.all(
      SPECS.map(async (spec, i) => {
        const def = BLOCKS[spec.id];
        const faces = def ? resolveBlockFaces(def).faces : null;
        const emissive = EMISSIVE.has(spec.id);
        const mats = await Promise.all(
          BOX_FACES.map(async (f) => {
            const map = faces ? await tex(faces[f].texture) : null;
            const m = new THREE.MeshLambertMaterial(map ? { map } : { color: new THREE.Color(FALLBACK[spec.id] ?? '#888888') });
            if (emissive) {
              m.emissive = new THREE.Color(0xffffff);
              if (map) m.emissiveMap = map;
              m.emissiveIntensity = map ? 0.85 : 0.35;
            }
            this.materials.push(m);
            return m;
          }),
        );
        if (this.disposed) return;
        const mesh = new THREE.Mesh(geo, mats);
        const layer = layerOf(spec.z);
        mesh.layers.set(layer);
        mesh.position.set(spec.x, spec.y, spec.z);
        mesh.scale.setScalar(spec.s);
        const base = new THREE.Euler(h01(i, 1) * Math.PI * 2, h01(i, 2) * Math.PI * 2, h01(i, 3) * 0.6);
        mesh.rotation.copy(base);
        mesh.userData.dim = layer === 0;
        this.scene.add(mesh);
        this.blocks.push({
          mesh,
          spec,
          layer,
          phase: h01(i, 4) * Math.PI * 2,
          spin: new THREE.Vector3((h01(i, 5) - 0.5) * 0.3, (h01(i, 6) - 0.5) * 0.5 + 0.12, (h01(i, 7) - 0.5) * 0.2),
          base,
          delay: 120 + i * 45,
        });
      }),
    );
  }

  setTheme(theme: 'dark' | 'light'): void {
    this.theme = theme;
    this.applyTheme();
  }

  private applyTheme(): void {
    const light = this.theme === 'light';
    this.ambient.intensity = light ? 1.15 : 0.5;
    this.key.intensity = light ? 1.9 : 2.1;
    this.rim.color.set(light ? 0x0b6aa6 : 0x3cb7f4);
    this.rim.intensity = light ? 1.6 : 3.4;
    this.cursorLight.color.set(light ? 0x2b8fd6 : 0x3cb7f4);
    this.cursorLight.intensity = light ? 26 : 42;
    // 远处的方块：深色主题压暗，浅色主题蒙一层雾（大气透视）
    for (const b of this.blocks) {
      if (b.layer !== 0) continue;
      for (const m of b.mesh.material as THREE.MeshLambertMaterial[]) {
        m.color.setScalar(light ? 0.92 : 0.5);
        if (!m.emissiveMap) {
          m.emissive.set(light ? 0xe4e8ef : 0x000000);
          m.emissiveIntensity = light ? 0.45 : 0;
        }
      }
    }
  }

  /** 画布的设备像素尺寸 */
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
    // 窄屏：视角放宽一点，方块往中间收
    this.camera.fov = this.aspect < 1 ? 44 : 30;
    this.camera.updateProjectionMatrix();
  }

  frame(f: HeroSceneFrame): void {
    if (this.disposed) return;
    this.t0 ||= f.now;
    const ms = f.still ? 1e6 : f.now - this.t0;
    const t = ms / 1000;
    const k = f.progress;
    // 窄屏把横向位置收进来
    const squeeze = Math.min(1, this.aspect / 1.55);

    for (const b of this.blocks) {
      const { spec } = b;
      // 入场：带一点过冲地弹出
      const p = Math.min(1, Math.max(0, (ms - b.delay) / 900));
      const c1 = 1.5;
      const pop = p >= 1 ? 1 : 1 + (c1 + 1) * (p - 1) ** 3 + c1 * (p - 1) ** 2;
      const spread = 1 + k * (b.layer === 2 ? 0.9 : 0.35);
      const bob = f.still ? 0 : Math.sin(t * (0.5 + (b.phase % 0.4)) + b.phase) * 0.16 * spec.s;
      b.mesh.position.set(spec.x * squeeze * spread, spec.y * spread + bob, spec.z + k * (b.layer === 2 ? 3 : 0));
      b.mesh.scale.setScalar(spec.s * Math.max(0.0001, pop));
      if (!f.still) {
        b.mesh.rotation.set(b.base.x + t * b.spin.x, b.base.y + t * b.spin.y, b.base.z + Math.sin(t * 0.4 + b.phase) * 0.08 + t * b.spin.z);
      }
    }

    // 相机：跟着指针轻轻移动（视差来自深度本身），滚动时后退
    const px = f.pointer && !f.still ? f.pointer.x : 0;
    const py = f.pointer && !f.still ? f.pointer.y : 0;
    this.cam.x += (px * 0.9 - this.cam.x) * 0.06;
    this.cam.y += (-py * 0.55 - this.cam.y) * 0.06;
    this.camera.position.set(this.cam.x, this.cam.y + k * 1.2, 16 + k * 5);
    this.camera.lookAt(0, k * 0.4, 0);

    // 指针处的点光：投到 z = 3 的平面上；没有指针时慢慢绕圈
    const vFov = (this.camera.fov * Math.PI) / 180;
    const hh = Math.tan(vFov / 2) * (this.camera.position.z - 3);
    const tx = f.pointer ? f.pointer.x * hh * this.aspect : Math.cos(t * 0.3) * 4;
    const ty = f.pointer ? -f.pointer.y * hh : Math.sin(t * 0.4) * 2 + 1;
    this.lightPos.lerp(new THREE.Vector3(tx + this.cam.x, ty + this.cam.y, 3), f.still ? 1 : 0.12);
    this.cursorLight.position.copy(this.lightPos);

    this.render();
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

  private render(): void {
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
    for (const m of this.materials) {
      m.map?.dispose();
      m.dispose();
    }
    this.blurMat.dispose();
    this.compMat.dispose();
    this.rtA.dispose();
    this.rtB.dispose();
    this.renderer.dispose();
  }
}
