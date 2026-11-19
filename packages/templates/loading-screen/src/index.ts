// T4 加载界面 allay.builtin.loading-screen（docs/04-templates.md 4.10）。
// 只用公开的模板接口：THREE 和所有辅助函数都从 ctx 拿，只从 template-sdk 做类型导入（4.9）。
//
// style 选版本样式，每种样式对照的原版行为和依据写在 docs/04-templates.md 的 T4 一节。布局以“界面像素”计（GUI 坐标，左上角为原点、y 向下），
// 一个界面像素 = g 个设计单位；界面宽高 = 舞台宽高 / g，和游戏在同样窗口、同样界面缩放下的 guiWidth、guiHeight 一样。
// - custom：本模板最初的样子（标题、副标题、进度条，大小自由）。
// - javaClassic：Java 版 Beta–1.13 的“正在加载世界 / 正在生成地形”（LoadingScreenRenderer、ProgressScreen）：泥土背景 0x404040，
//   标题在 h/2 − 4 − 16，副标题在 h/2 − 4 + 8；进度条（1.3 之前才有）100 × 2，在 h/2 + 16，底 0x808080、进度 0x80FF80。
// - javaChunks：Java 版 1.14–1.20.4（LevelLoadingScreen）：泥土背景，百分比在 h/2 − 4 − 30，区块状态图以 (w/2, h/2 + 30) 为中心，每个区块 2 × 2，带黑边。
// - javaChunksModern：Java 版 1.20.5（24w09a）–1.21.8：背景换成模糊的全景图加菜单背景，区块图没有黑边（24w19a）。
// - javaTerrain：“正在加载地形……”（ReceivingLevelScreen，进服务器、换维度），文字在 h/2 − 50；背景可选泥土、全景图、下界传送门、末地传送门。
// - javaSplash：Java 版 1.16 起的资源加载画面（LoadingOverlay）：红底 0xEF323D（单色模式黑底，1.17 起），标志和白色进度条；
//   退出时先用 1 秒淡出进度条，再用 1 秒淡出背景和标志。
// - bedrock：基岩版的世界加载（近似）：全景图背景，中间深色框里“正在构建地形”，经验条样式的进度条，下面一行提示。
import type { FontStyle, ParamValue, SetupContext, TemplateInstance, TemplateModule, TextObject } from '@allay/template-sdk';

const num = (v: ParamValue | undefined, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const str = (v: ParamValue | undefined, fallback: string): string => (typeof v === 'string' ? v : fallback);
const fontOf = (v: ParamValue | undefined): FontStyle | undefined =>
  v && typeof v === 'object' && !Array.isArray(v) && typeof (v as { family?: unknown }).family === 'string' ? (v as unknown as FontStyle) : undefined;

type Motion = 'fade' | 'slideUp' | 'dissolve';
const motion = (v: ParamValue | undefined): Motion => (v === 'slideUp' || v === 'dissolve' ? v : 'fade');
type Style = 'custom' | 'javaClassic' | 'javaChunks' | 'javaChunksModern' | 'javaTerrain' | 'javaSplash' | 'bedrock';
const STYLES: readonly Style[] = ['custom', 'javaClassic', 'javaChunks', 'javaChunksModern', 'javaTerrain', 'javaSplash', 'bedrock'];
type Background = 'dirt' | 'panorama' | 'netherPortal' | 'endPortal' | 'solid';

/** custom 样式：文字行之间的间距、文字和进度条之间的间距（字体像素），进度条的高度和边框 */
const GAP = 6;
const BAR_HEIGHT = 3;
const BAR_BORDER = 1;
/** 阈值比较的余量：进度为 1 时阈值为 1 的格子也算过了 */
const EPS = 1e-3;
/** 游戏的背景压暗：0x404040 */
const DIRT_DIM = 64 / 255;
/** 资源加载画面的底色 */
const SPLASH_RED = '#EF323D';

/** 区块生成阶段（1.18 起的 ChunkStatus 顺序）和 LevelLoadingScreen 里的颜色 */
const CHUNK_COLORS = [0x545454, 0x999999, 0x5f6191, 0x80b252, 0xd1d1d1, 0x726809, 0x303572, 0x21c600, 0xcccccc, 0xcccccc, 0xf26060, 0xffffff];
const FULL = CHUNK_COLORS.length - 1;
/** 区块图的边长（区块数，出生点半径 11 加上外圈的低阶段区块）和每个区块的界面像素 */
const MAP_SIDE = 35;
const MAP_FULL_RADIUS = 11;
const MAP_CELL = 2;

/** 各样式的默认标题、副标题（游戏语言文件的原文）。参数保持某一条默认文字时换成当前样式的那一句 */
const TITLES: Record<string, { zh: string; en: string }> = {
  custom: { zh: '正在加载世界', en: 'Loading world' },
  javaClassic: { zh: '正在加载世界', en: 'Loading world' },
  javaTerrain: { zh: '正在加载地形……', en: 'Loading terrain...' },
  bedrock: { zh: '正在构建地形', en: 'Building terrain' },
};
const SUBTITLES: Record<string, { zh: string; en: string }> = {
  custom: { zh: '正在生成地形…', en: 'Building terrain…' },
  javaClassic: { zh: '正在生成地形', en: 'Building terrain' },
  bedrock: { zh: '提示：按住潜行键可以在方块边缘停下', en: 'Tip: Sneak to stop at the edge of a block' },
};
function swapDefault(value: string, table: Record<string, { zh: string; en: string }>, want: string): string {
  const target = table[want];
  if (!target) return value;
  for (const e of Object.values(table)) {
    if (value === e.zh) return target.zh;
    if (value === e.en) return target.en;
  }
  return value;
}

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

/** 平铺贴图（泥土、菜单背景）：按 tile 设计单位一格，相对舞台左上角对齐；连续坐标的导数避免接缝处的 mipmap 跳级 */
const TILE_FRAG = /* glsl */ `
uniform sampler2D map;
uniform vec2 stageSize;
uniform float tile;
uniform vec3 tint;
uniform float opacity;
varying vec2 vUv;
void main() {
  // y 取“离顶边的距离”的相反数：fract 之后每格的顶边在 v = 1（贴图第一行在 v = 1）
  vec2 p = vec2(vUv.x, vUv.y - 1.0) * stageSize / tile;
  vec4 c = textureGrad(map, fract(p), dFdx(p), dFdy(p));
  gl_FragColor = vec4(c.rgb * tint, c.a * opacity);
  #include <colorspace_fragment>
}`;

/**
 * 全景图（CubeMap）：透视 85°，先俯 10°，再绕竖直轴转 spin；六张面贴图 panorama_0–5（前、右、后、左、上、下）。
 * blur > 0 时取高一级的 mipmap 并做 8 个方向的平均，近似游戏 1.20.5 起的模糊背景。
 */
const PANORAMA_FRAG = /* glsl */ `
uniform sampler2D f0; uniform sampler2D f1; uniform sampler2D f2; uniform sampler2D f3; uniform sampler2D f4; uniform sampler2D f5;
uniform float aspect;
uniform float spin;
uniform float blur;
uniform float opacity;
varying vec2 vUv;
vec3 face(vec3 d, vec2 o, float lod) {
  vec3 a = abs(d);
  vec2 uv; int k;
  if (a.z >= a.x && a.z >= a.y) { if (d.z < 0.0) { k = 0; uv = vec2(d.x, -d.y) / a.z; } else { k = 2; uv = vec2(-d.x, -d.y) / a.z; } }
  else if (a.x >= a.y) { if (d.x > 0.0) { k = 1; uv = vec2(d.z, -d.y) / a.x; } else { k = 3; uv = vec2(-d.z, -d.y) / a.x; } }
  else { if (d.y > 0.0) { k = 4; uv = vec2(d.x, d.z) / a.y; } else { k = 5; uv = vec2(d.x, -d.z) / a.y; } }
  // 上面算出的 v 向下增大（图像坐标），贴图的第一行在 v = 1，所以翻一下
  uv = clamp(uv * 0.5 + 0.5 + o, 0.0, 1.0);
  uv.y = 1.0 - uv.y;
  if (k == 0) return textureLod(f0, uv, lod).rgb;
  if (k == 1) return textureLod(f1, uv, lod).rgb;
  if (k == 2) return textureLod(f2, uv, lod).rgb;
  if (k == 3) return textureLod(f3, uv, lod).rgb;
  if (k == 4) return textureLod(f4, uv, lod).rgb;
  return textureLod(f5, uv, lod).rgb;
}
void main() {
  float t = tan(radians(85.0) * 0.5);
  vec3 d = normalize(vec3((vUv.x * 2.0 - 1.0) * t * aspect, (vUv.y * 2.0 - 1.0) * t, -1.0));
  float p = radians(10.0);
  d = vec3(d.x, d.y * cos(p) - d.z * sin(p), d.y * sin(p) + d.z * cos(p));
  float s = radians(spin);
  d = vec3(d.x * cos(s) - d.z * sin(s), d.y, d.x * sin(s) + d.z * cos(s));
  vec3 c = face(d, vec2(0.0), blur);
  if (blur > 0.0) {
    float r = 0.012;
    for (int i = 0; i < 8; i++) {
      float a = float(i) * 0.7853982;
      c += face(d, vec2(cos(a), sin(a)) * r, blur);
    }
    c /= 9.0;
  }
  gl_FragColor = vec4(c, opacity);
  #include <colorspace_fragment>
}`;

/** 末地传送门（游戏的 rendertype_end_portal 着色器）：天空贴图加 15 层随时间移动、旋转的传送门贴图，按层乘上固定颜色 */
const END_FRAG = /* glsl */ `
uniform sampler2D sky;
uniform sampler2D portal;
uniform vec2 stageSize;
uniform float gameTime;
uniform float opacity;
varying vec2 vUv;
const vec3 COLORS[16] = vec3[](
  vec3(0.022087, 0.098399, 0.110818), vec3(0.011892, 0.095924, 0.089485), vec3(0.027636, 0.101689, 0.100326), vec3(0.046564, 0.109883, 0.114838),
  vec3(0.064901, 0.117696, 0.097189), vec3(0.063761, 0.086895, 0.123646), vec3(0.084817, 0.111994, 0.166380), vec3(0.097489, 0.154120, 0.091064),
  vec3(0.106152, 0.131144, 0.195191), vec3(0.097721, 0.110188, 0.187229), vec3(0.133516, 0.138278, 0.148582), vec3(0.070006, 0.243332, 0.235792),
  vec3(0.196766, 0.142899, 0.214696), vec3(0.047281, 0.315338, 0.321970), vec3(0.204675, 0.390010, 0.302066), vec3(0.080955, 0.314821, 0.661491)
);
vec3 tap(sampler2D tex, vec2 p) { return textureGrad(tex, fract(p), dFdx(p), dFdy(p)).rgb; }
void main() {
  // 屏幕坐标（0–1），按短边归一，和游戏里按窗口投影一样不随画幅拉伸
  vec2 base = vec2(vUv.x, 1.0 - vUv.y) * stageSize / min(stageSize.x, stageSize.y);
  vec2 q = base * 0.5 + 0.25;
  vec3 color = tap(sky, q) * COLORS[0];
  for (int i = 0; i < 15; i++) {
    float layer = float(i + 1);
    vec2 p = q + vec2(17.0 / layer, (2.0 + layer / 1.5) * (gameTime * 1.5));
    float a = radians((layer * layer * 4321.0 + layer * 9.0) * 2.0);
    p = mat2(cos(a), sin(a), -sin(a), cos(a)) * p;
    p *= (4.5 - layer / 4.0) * 2.0;
    color += tap(portal, p) * COLORS[i];
  }
  gl_FragColor = vec4(color, opacity);
  #include <colorspace_fragment>
}`;

/** 经验条样式的进度条：贴图按原尺寸铺满条的全长，进度之外的部分裁掉（游戏里按宽度截取贴图） */
const BAR_FRAG = /* glsl */ `
uniform sampler2D map;
uniform float cut;
uniform float opacity;
varying vec2 vUv;
void main() {
  if (vUv.x > cut) discard;
  vec4 c = texture2D(map, vUv);
  gl_FragColor = vec4(c.rgb, c.a * opacity);
  #include <colorspace_fragment>
}`;

/** 资源加载画面的标志：取亮度当覆盖率（贴图是黑底白字还是透明底都一样），游戏里用加法混合画在红底上 */
const LOGO_FRAG = /* glsl */ `
uniform sampler2D map;
uniform vec4 uvRect;
uniform float opacity;
varying vec2 vUv;
void main() {
  vec2 uv = vec2(mix(uvRect.x, uvRect.z, vUv.x), mix(uvRect.y, uvRect.w, 1.0 - vUv.y));
  vec4 c = texture2D(map, vec2(uv.x, 1.0 - uv.y));
  float cov = max(c.r, max(c.g, c.b)) * c.a;
  gl_FragColor = vec4(1.0, 1.0, 1.0, cov * opacity);
}`;

const template: TemplateModule = {
  async setup(ctx: SetupContext): Promise<TemplateInstance> {
    const { THREE, stage, scene, params } = ctx;
    const W = stage.width;
    const H = stage.height;
    // 不用类型断言：打包后断言会被去掉，复制出来的 template.js 在外部编辑器里会报类型错误（T-DEV-3）
    const style: Style = STYLES.find((s) => s === params.style) ?? 'javaClassic';
    const blockId = str(params.block, 'minecraft:dirt');
    const dim = Math.min(1, Math.max(0, num(params.dim, 0.25)));
    const title = swapDefault(str(params.title, 'Loading world'), TITLES, style);
    const subtitle = swapDefault(str(params.subtitle, ''), SUBTITLES, style);
    const textColor = str(params.textColor, '#FFFFFF');
    const showBar = params.showBar !== false;
    const barColor = str(params.barColor, '#55FF55');
    const inStyle = motion(params.inStyle);
    const outStyle = motion(params.outStyle);
    const inDuration = num(params.inDuration, 0.3);
    const hold = num(params.hold, 0.9);
    const outDuration = num(params.outDuration, 0.3);
    const cutAt = Math.min(1, Math.max(0, num(params.cutAt, 0.5)));
    const titleFont = fontOf(params.titleFont);
    const subtitleFont = fontOf(params.subtitleFont);
    const custom = style === 'custom';
    // 界面缩放：custom 用 textScale（一个字体像素的设计单位），其余样式用 guiScale
    const g = custom ? num(params.textScale, 5) : Math.max(1, num(params.guiScale, 4));
    const guiW = W / g;
    const guiH = H / g;

    const duration = inDuration + hold + outDuration;
    const cutTime = inDuration + hold * cutAt;

    // 背景
    const bgParam = str(params.background, 'auto');
    let background: Background;
    if (style === 'javaSplash') background = 'solid';
    else if (style === 'javaChunksModern' || style === 'bedrock') background = bgParam === 'auto' ? 'panorama' : (bgParam as Background);
    else background = bgParam === 'auto' ? 'dirt' : (bgParam as Background);
    if (!['dirt', 'panorama', 'netherPortal', 'endPortal', 'solid'].includes(background)) background = 'dirt';

    const disposables: { dispose(): void }[] = [];
    /** 随进出淡入淡出的材质（opacity 属性或 uniform） */
    const fades: ((a: number) => void)[] = [];
    const root = new THREE.Object3D();
    scene.add(root);
    const quad = new THREE.PlaneGeometry(1, 1);
    disposables.push(quad);

    // ---- 背景 ----
    // 泥土：custom 按 tileSize；其余按游戏的 32 界面像素一格（16 像素的贴图放大一倍）、压暗到 0x404040
    const tile = custom ? Math.max(1, num(params.tileSize, 128)) : 32 * g;
    const tileDim = custom ? dim : DIRT_DIM;
    let tiles: ReturnType<Awaited<ReturnType<typeof ctx.resources.block>>['instanced']> | null = null;
    let tx = new Float64Array(0);
    let ty = new Float64Array(0);
    let count = 0;
    const thresholds: number[] = [];
    const shader = (frag: string, uniforms: Record<string, { value: unknown }>) => {
      const mat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: frag, uniforms: { ...uniforms, opacity: { value: 1 } }, transparent: true, depthWrite: false });
      disposables.push(mat);
      fades.push((a) => {
        mat.uniforms.opacity!.value = a;
      });
      return mat;
    };
    const fullScreen = (mat: InstanceType<typeof THREE.Material>, z: number) => {
      const mesh = new THREE.Mesh(quad, mat);
      mesh.scale.set(W, H, 1);
      mesh.position.z = z;
      root.add(mesh);
      return mesh;
    };

    // 游戏的屏幕在画背景之前是清成黑色的；半透明的背景贴图（下界传送门、菜单背景）垫一层黑底，剪辑点时画面才完全不透明
    if (background !== 'dirt' && background !== 'solid') {
      const black = new THREE.MeshBasicMaterial({ color: new THREE.Color('#000000'), transparent: true, depthWrite: false });
      disposables.push(black);
      fades.push((a) => {
        black.opacity = a;
      });
      fullScreen(black, -3);
    }

    let spinUniform: { value: number } | null = null;
    let endTime: { value: number } | null = null;
    if (background === 'dirt') {
      // 背景是实例化方块（正交相机、不加面明暗，只看得见朝向相机的那一面），资源包换了贴图也跟着变
      const nx = Math.ceil(W / tile);
      const ny = Math.ceil(H / tile);
      count = nx * ny;
      tx = new Float64Array(count);
      ty = new Float64Array(count);
      for (let j = 0; j < ny; j++) {
        for (let i = 0; i < nx; i++) {
          const k = j * nx + i;
          // 游戏的平铺从屏幕左上角开始；custom 沿用居中
          tx[k] = custom ? (i - (nx - 1) / 2) * tile : -W / 2 + (i + 0.5) * tile;
          ty[k] = custom ? ((ny - 1) / 2 - j) * tile : H / 2 - (j + 0.5) * tile;
        }
      }
      tiles = (await ctx.resources.block(blockId, { shading: false })).instanced(count);
      const tint = new THREE.Color().setRGB(tileDim, tileDim, tileDim, THREE.SRGBColorSpace);
      for (let k = 0; k < count; k++) tiles.setTint(k, tint);
      root.add(tiles.object);
      // 像素溶解：每格一个阈值 h ∈ [0, 1]（随机加噪声，再归一化），同 T5 的做法
      if (inStyle === 'dissolve' || outStyle === 'dissolve') {
        const rng = ctx.random('dissolve');
        const raw: number[] = [];
        for (let k = 0; k < count; k++) raw.push(0.5 * rng.next() + 0.25 * (ctx.noise2D(tx[k]! / 600, ty[k]! / 600, 'dissolve') + 1));
        const lo = Math.min(...raw);
        const hi = Math.max(...raw);
        for (const v of raw) thresholds.push(hi > lo ? (v - lo) / (hi - lo) : 0);
      }
    } else if (background === 'panorama') {
      const faces = await Promise.all([0, 1, 2, 3, 4, 5].map((i) => ctx.resources.texture(`minecraft:gui/title/background/panorama_${i}`)));
      spinUniform = { value: 0 };
      const blurred = style !== 'bedrock';
      fullScreen(shader(PANORAMA_FRAG, { f0: { value: faces[0] }, f1: { value: faces[1] }, f2: { value: faces[2] }, f3: { value: faces[3] }, f4: { value: faces[4] }, f5: { value: faces[5] }, aspect: { value: W / H }, spin: spinUniform, blur: { value: blurred ? 4.5 : 0 } }), -2);
      if (blurred) {
        // 1.20.5 起菜单的半透明背景：menu_background 按 32 界面像素平铺
        const menu = await ctx.resources.texture('minecraft:gui/menu_background');
        fullScreen(shader(TILE_FRAG, { map: { value: menu }, stageSize: { value: new THREE.Vector2(W, H) }, tile: { value: 32 * g }, tint: { value: new THREE.Vector3(1, 1, 1) } }), -1);
      }
    } else if (background === 'netherPortal') {
      // 游戏把下界传送门的（动画）贴图拉伸铺满整个屏幕
      const portal = await ctx.resources.texture('minecraft:block/nether_portal');
      const mat = new THREE.MeshBasicMaterial({ map: portal, transparent: true, depthWrite: false });
      disposables.push(mat);
      fades.push((a) => {
        mat.opacity = a;
      });
      fullScreen(mat, -2);
    } else if (background === 'endPortal') {
      const [sky, portal] = await Promise.all([ctx.resources.texture('minecraft:environment/end_sky'), ctx.resources.texture('minecraft:entity/end_portal')]);
      endTime = { value: 0 };
      fullScreen(shader(END_FRAG, { sky: { value: sky }, portal: { value: portal }, stageSize: { value: new THREE.Vector2(W, H) }, gameTime: endTime }), -2);
    } else {
      const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(params.monochrome === true ? '#000000' : SPLASH_RED), transparent: true, depthWrite: false });
      disposables.push(mat);
      fades.push((a) => {
        mat.opacity = a;
      });
      fullScreen(mat, -2);
    }

    // ---- 前景 ----
    const front = new THREE.Object3D();
    front.position.z = tile;
    root.add(front);
    const texts: TextObject[] = [];
    const makeText = (text: string, font: FontStyle | undefined, opts: { color?: string; shadow?: boolean; maxWidth?: number } = {}) => {
      const t = ctx.text.create({ text, size: g, color: opts.color ?? textColor, shadow: opts.shadow ?? true, align: 'center', ...(opts.maxWidth ? { maxWidth: opts.maxWidth } : {}), ...(font ? { font } : {}) });
      t.object.position.z = 3;
      front.add(t.object);
      texts.push(t);
      return t;
    };
    /** 界面坐标（左上角为原点）的矩形，颜色 #RRGGBB */
    const materials: InstanceType<typeof THREE.MeshBasicMaterial>[] = [];
    /** 个别材质的不透明度上限（例如基岩版加载框的 0.6），整体淡入淡出时乘上它 */
    const materialAlpha = new Map<InstanceType<typeof THREE.MeshBasicMaterial>, number>();
    const rect = (color: string, x0: number, y0: number, x1: number, y1: number, z: number) => {
      const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(color.slice(0, 7)), transparent: true, depthWrite: false });
      materials.push(mat);
      disposables.push(mat);
      const mesh = new THREE.Mesh(quad, mat);
      mesh.scale.set(Math.max(1e-3, (x1 - x0) * g), Math.max(1e-3, (y1 - y0) * g), 1);
      mesh.position.set(-W / 2 + ((x0 + x1) / 2) * g, H / 2 - ((y0 + y1) / 2) * g, z);
      front.add(mesh);
      return mesh;
    };
    /** 把文字放在界面坐标：x 是中线，y 是文字顶边 */
    const place = (t: TextObject, x: number, yTop: number) => {
      t.object.position.x = -W / 2 + x * g;
      t.object.position.y = H / 2 - yTop * g - t.height / 2;
    };

    let progressFn = (_p: number): void => undefined;
    /** javaSplash：进度条的不透明度单独控制 */
    const splashBar: InstanceType<typeof THREE.MeshBasicMaterial>[] = [];
    const splashLogo: { value: number }[] = [];
    let stackH: number;

    if (custom) {
      // 标题、副标题、进度条，竖直方向整体居中（规格没给这些尺寸，见 decisions.md M6a）
      const maxWidth = W * 0.9;
      const titleObj = makeText(title, titleFont, { maxWidth });
      const subtitleObj = subtitle.trim() !== '' ? makeText(subtitle, subtitleFont, { maxWidth }) : null;
      const u = g;
      const barW = Math.min(W * 0.7, 100 * u);
      const barH = BAR_HEIGHT * u;
      const barOuterH = barH + 2 * BAR_BORDER * u;
      stackH = titleObj.height + (subtitleObj ? GAP * u + subtitleObj.height : 0) + (showBar ? GAP * u + barOuterH : 0);
      let y = stackH / 2;
      titleObj.object.position.y = y - titleObj.height / 2;
      y -= titleObj.height;
      if (subtitleObj) {
        y -= GAP * u;
        subtitleObj.object.position.y = y - subtitleObj.height / 2;
        y -= subtitleObj.height;
      }
      if (showBar) {
        y -= GAP * u;
        const cy = y - barOuterH / 2;
        const box = (color: string, w: number, h: number, z: number) => {
          const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(color.slice(0, 7)), transparent: true, depthWrite: false });
          materials.push(mat);
          disposables.push(mat);
          const mesh = new THREE.Mesh(quad, mat);
          mesh.scale.set(w, h, 1);
          mesh.position.set(0, cy, z);
          front.add(mesh);
          return mesh;
        };
        box(textColor, barW + 2 * BAR_BORDER * u, barOuterH, 0);
        box('#000000', barW, barH, 1);
        const fill = box(barColor, barW, barH, 2);
        progressFn = (p) => {
          fill.visible = p > 0;
          fill.scale.x = barW * p;
          fill.position.x = (-barW + barW * p) / 2;
        };
      }
    } else if (style === 'javaClassic') {
      const cx = Math.floor(guiW / 2);
      const cy = Math.floor(guiH / 2);
      if (title.trim() !== '') place(makeText(title, titleFont), cx, cy - 4 - 16);
      if (subtitle.trim() !== '') place(makeText(subtitle, subtitleFont), cx, cy - 4 + 8);
      if (showBar) {
        const x0 = cx - 50;
        const y0 = cy + 16;
        rect('#808080', x0, y0, x0 + 100, y0 + 2, 0);
        const fill = rect('#80FF80', x0, y0, x0 + 100, y0 + 2, 1);
        progressFn = (p) => {
          const w = Math.floor(100 * p);
          fill.visible = w > 0;
          fill.scale.x = Math.max(1e-3, w * g);
          fill.position.x = -W / 2 + (x0 + w / 2) * g;
        };
      }
      stackH = 60 * g;
    } else if (style === 'javaChunks' || style === 'javaChunksModern') {
      const cx = Math.floor(guiW / 2);
      const cy = Math.floor(guiH / 2);
      const pct = Array.from({ length: 101 }, (_, i) => {
        const t = makeText(`${i}%`, titleFont);
        place(t, cx, cy - 4 - 30);
        t.object.visible = false;
        return t;
      });
      // 区块图：一张 MAP_SIDE × MAP_SIDE 的小贴图，最近邻放大，每帧按 t 重写像素（只改数据，不新建贴图）
      const data = new Uint8Array(MAP_SIDE * MAP_SIDE * 4);
      const mapTex = new THREE.DataTexture(data, MAP_SIDE, MAP_SIDE, THREE.RGBAFormat);
      mapTex.colorSpace = THREE.SRGBColorSpace;
      mapTex.magFilter = THREE.NearestFilter;
      mapTex.minFilter = THREE.NearestFilter;
      mapTex.generateMipmaps = false;
      mapTex.needsUpdate = true;
      disposables.push(mapTex);
      const mapMat = new THREE.MeshBasicMaterial({ map: mapTex, transparent: true, depthWrite: false });
      disposables.push(mapMat);
      materials.push(mapMat);
      const side = MAP_SIDE * MAP_CELL;
      const mx = cx - side / 2;
      const my = cy + 30 - side / 2;
      if (style === 'javaChunks') rect('#000000', mx - 1, my - 1, mx + side + 1, my + side + 1, 0);
      const mapMesh = new THREE.Mesh(quad, mapMat);
      mapMesh.scale.set(side * g, side * g, 1);
      mapMesh.position.set(-W / 2 + (mx + side / 2) * g, H / 2 - (my + side / 2) * g, 1);
      front.add(mapMesh);
      // 每个区块：离中心越远越晚开始、最终阶段越低（出生点半径以内到 FULL，外圈每圈低两个阶段）
      const rng = ctx.random('chunks');
      const c0 = (MAP_SIDE - 1) / 2;
      const start = new Float64Array(MAP_SIDE * MAP_SIDE);
      const target = new Uint8Array(MAP_SIDE * MAP_SIDE);
      for (let j = 0; j < MAP_SIDE; j++) {
        for (let i = 0; i < MAP_SIDE; i++) {
          const k = j * MAP_SIDE + i;
          const r = Math.max(Math.abs(i - c0), Math.abs(j - c0));
          start[k] = Math.min(0.6, (r / c0) * 0.45 + rng.next() * 0.15);
          target[k] = r <= MAP_FULL_RADIUS ? FULL : Math.max(1, FULL - Math.ceil((r - MAP_FULL_RADIUS) * 1.8));
        }
      }
      progressFn = (p) => {
        for (let k = 0; k < start.length; k++) {
          const local = p <= start[k]! ? 0 : Math.min(1, (p - start[k]!) / (1 - start[k]! * 0.6));
          const s = p >= 1 ? target[k]! : Math.min(target[k]!, Math.floor(local * (FULL + 1)));
          // 没开始的区块不画（游戏里状态为空时是透明的格子）
          const shown = local > 0 || p >= 1;
          const c = CHUNK_COLORS[s]!;
          const o = k * 4;
          data[o] = (c >> 16) & 255;
          data[o + 1] = (c >> 8) & 255;
          data[o + 2] = c & 255;
          data[o + 3] = shown ? 255 : 0;
        }
        mapTex.needsUpdate = true;
        const n = Math.min(100, Math.floor(p * 100));
        pct.forEach((t, i) => {
          t.object.visible = i === n;
        });
      };
      stackH = 120 * g;
    } else if (style === 'javaTerrain') {
      if (title.trim() !== '') place(makeText(title, titleFont), Math.floor(guiW / 2), Math.floor(guiH / 2) - 50);
      stackH = 110 * g;
    } else if (style === 'javaSplash') {
      // LoadingOverlay 的布局（整数截断照游戏）
      const k = Math.floor(guiW * 0.5);
      const p = Math.floor(guiH * 0.5);
      const d = Math.min(guiW * 0.75, guiH) * 0.25;
      const q = Math.floor(d * 0.5);
      const r = Math.floor(d * 4 * 0.5);
      const logoTex = await ctx.resources.texture('minecraft:gui/title/mojangstudios');
      const half = (x0: number, uv: [number, number, number, number]) => {
        const opacity = { value: 1 };
        splashLogo.push(opacity);
        const mat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: LOGO_FRAG, uniforms: { map: { value: logoTex }, uvRect: { value: new THREE.Vector4(...uv) }, opacity }, transparent: true, depthWrite: false });
        disposables.push(mat);
        const mesh = new THREE.Mesh(quad, mat);
        mesh.scale.set(r * g, Math.floor(d) * g, 1);
        mesh.position.set(-W / 2 + (x0 + r / 2) * g, H / 2 - (p - q + Math.floor(d) / 2) * g, 1);
        front.add(mesh);
      };
      // 贴图上半是标志的左半、下半是右半；u 各偏 ±0.0625 / 120
      half(k - r, [-0.0625 / 120, 0, 1 - 0.0625 / 120, 0.5]);
      half(k, [0.0625 / 120, 0.5, 1 + 0.0625 / 120, 1]);
      if (showBar) {
        const s = Math.floor(guiH * 0.8325);
        const minX = Math.floor(guiW / 2) - r;
        const maxX = Math.floor(guiW / 2) + r;
        const minY = s - 5;
        const maxY = s + 5;
        const white = '#FFFFFF';
        const parts = [
          rect(white, minX + 1, minY, maxX - 1, minY + 1, 2),
          rect(white, minX + 1, maxY - 1, maxX - 1, maxY, 2),
          rect(white, minX, minY, minX + 1, maxY, 2),
          rect(white, maxX - 1, minY, maxX, maxY, 2),
        ];
        const fill = rect(white, minX + 2, minY + 2, maxX - 2, maxY - 2, 2);
        splashBar.push(...parts.map((m) => m.material as InstanceType<typeof THREE.MeshBasicMaterial>), fill.material as InstanceType<typeof THREE.MeshBasicMaterial>);
        progressFn = (pr) => {
          const i = Math.ceil((maxX - minX - 2) * pr);
          const w = Math.max(0, i - 2);
          fill.visible = w > 0;
          fill.scale.x = Math.max(1e-3, w * g);
          fill.position.x = -W / 2 + (minX + 2 + w / 2) * g;
        };
      }
      stackH = guiH * g;
    } else {
      // bedrock（近似）：深色半透明框，框里标题；下面经验条样式的进度条（hud/experience_bar_*，182 × 5）和一行提示
      const cx = guiW / 2;
      const cy = guiH / 2;
      const boxW = 200;
      const boxH = 64;
      const box = rect('#000000', cx - boxW / 2, cy - boxH / 2, cx + boxW / 2, cy + boxH / 2, 0);
      materialAlpha.set(box.material as InstanceType<typeof THREE.MeshBasicMaterial>, 0.6);
      if (title.trim() !== '') place(makeText(title, titleFont), cx, cy - boxH / 2 + 12);
      const barW = 182;
      const barH = 5;
      const bx = cx - barW / 2;
      const by = cy + 6;
      const [bgTex, fgTex] = await Promise.all([ctx.resources.texture('minecraft:gui/sprites/hud/experience_bar_background'), ctx.resources.texture('minecraft:gui/sprites/hud/experience_bar_progress')]);
      const barMesh = (tex: unknown, z: number) => {
        const cut = { value: 1 };
        const mesh = new THREE.Mesh(quad, shader(BAR_FRAG, { map: { value: tex }, cut }));
        mesh.scale.set(barW * g, barH * g, 1);
        mesh.position.set(-W / 2 + (bx + barW / 2) * g, H / 2 - (by + barH / 2) * g, z);
        front.add(mesh);
        return cut;
      };
      barMesh(bgTex, 1);
      const cut = barMesh(fgTex, 2);
      progressFn = (p) => {
        cut.value = Math.round(barW * p) / barW;
      };
      if (subtitle.trim() !== '') place(makeText(subtitle, subtitleFont, { color: '#AAAAAA', maxWidth: (boxW + 120) * g }), cx, cy + boxH / 2 + 10);
      stackH = (boxH + 40) * g;
    }

    // 时间窗（同 T1，docs/decisions.md M3“T1 的时间余量”）：首尾各留一帧，剪辑点前后各一帧保持铺满。
    const pad = 1 / stage.fps;
    const inStart = Math.min(pad, inDuration / 2);
    const inEnd = Math.max(inStart + 1e-4, Math.min(inDuration, cutTime - pad));
    const outEnd = duration - Math.min(pad, outDuration / 2);
    const outStart = Math.min(Math.max(inDuration + hold, cutTime + pad), outEnd - 1e-4);
    const inLen = inEnd - inStart;
    const outLen = outEnd - outStart;

    // slideUp 的位移：整屏（含超出画面的文字）完全移出画面
    const slide = H + tile + stackH;
    const slideIn = ctx.ease.cubicOut;
    const slideOut = ctx.ease.cubicIn;

    const m = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scl = new THREE.Vector3(tile, tile, tile);
    const clamp01 = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x);

    return {
      duration,
      cutTime,
      update(t: number) {
        const entering = t <= cutTime;
        // 阶段进度：进入时 0 → 1 为出现，退出时 0 → 1 为消失
        const phase = entering ? clamp01((t - inStart) / inLen) : clamp01((t - outStart) / outLen);
        const st = style === 'javaSplash' ? 'fade' : entering ? inStyle : outStyle;
        const shown = entering ? phase : 1 - phase;
        let offset = 0;
        let opacity = 1;
        if (st === 'slideUp') {
          if (entering) offset = phase >= 1 ? 0 : -slide * (1 - slideIn(phase));
          else offset = phase <= 0 ? 0 : slide * slideOut(phase);
        } else opacity = shown;

        // javaSplash 的退出：前一半淡出进度条，后一半淡出背景和标志（游戏里各 1 秒）
        let barOpacity = opacity;
        if (style === 'javaSplash' && !entering) {
          const f = phase * 2;
          barOpacity = 1 - clamp01(f);
          opacity = f >= 1 ? 1 - clamp01(f - 1) : 1;
          if (phase >= 1) opacity = 0;
        }

        if (tiles) {
          for (let k = 0; k < count; k++) {
            let a = opacity;
            if (st === 'dissolve') {
              const h = thresholds[k] ?? 0;
              a = entering ? (h < phase * (1 + EPS) ? 1 : 0) : h < phase * (1 + EPS) ? 0 : 1;
            }
            tiles.setOpacity(k, a);
            pos.set(tx[k]!, ty[k]! + offset, 0);
            m.compose(pos, quat, scl);
            tiles.setMatrix(k, m);
          }
          tiles.commit();
        }
        for (const f of fades) f(opacity);
        root.position.y = tiles ? 0 : offset;
        front.position.y = tiles ? offset : 0;
        for (const text of texts) text.setOpacity(opacity);
        for (const mat of materials) mat.opacity = opacity * (materialAlpha.get(mat) ?? 1);
        for (const mat of splashBar) mat.opacity = barOpacity;
        for (const u of splashLogo) u.value = opacity;
        // 全景图每游戏刻转 0.1°；末地传送门的 GameTime 是“游戏刻 / 24000”
        if (spinUniform) spinUniform.value = (t * 20 * 0.1) % 360;
        if (endTime) endTime.value = (t * 20) / 24000;
        // 进度在停留阶段从 0 走到 100%
        progressFn(clamp01((t - inDuration) / hold));
      },
      dispose() {
        for (const d of disposables) d.dispose();
      },
    };
  },
};

export default template;
