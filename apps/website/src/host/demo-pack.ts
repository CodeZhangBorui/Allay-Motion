// 网页演示用的“资源包”：浏览器里拿不到用户本机的游戏，仓库里也没有、不能有任何原版贴图（AGENTS.md 硬性规则 1）。
// 所以官网的仿真器用一层在页面里现场生成的纯色色块：按贴图 ID 里的词挑一个大致的颜色，加一点确定性的明暗噪点，
// 不读任何图片、不往仓库里放任何二进制文件。和测试夹具的“纯色假原版层”是同一个思路（tests/engine/harness/fake-resources.ts）。
// 桌面版的画面来自用户本机的游戏和资源包，这一层只存在于官网。
import { GUI_TEXTURES } from '@allay/assets';
import blocksJson from '../../../../packages/assets/data/blocks.json';
// 直接取色板文件，不经 @allay/ui/editor 的入口（那会把整套编辑器控件带进落地页的首屏代码）
import { DYE_PALETTE } from '../../../../packages/ui/src/editor/palettes';

type Rgb = [number, number, number];

function hex(h: string): Rgb {
  const n = Number.parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** 词 → 颜色（先匹配到的优先）。只是让演示画面好认，不追求像游戏 */
const WORD_COLORS: [RegExp, string][] = [
  [/diamond/, '#52D6DC'],
  [/emerald/, '#3FBF6F'],
  [/gold/, '#F2C94C'],
  [/iron/, '#D9D9DC'],
  [/copper/, '#C8734A'],
  [/redstone/, '#C2362F'],
  [/lapis/, '#2F5DB8'],
  [/amethyst/, '#9B85E8'],
  [/netherite|blackstone/, '#3B3739'],
  [/obsidian/, '#22183A'],
  [/glowstone|shroomlight/, '#F3C969'],
  [/sea_lantern|prismarine/, '#7FC8BE'],
  [/water/, '#3F76E4'],
  [/lava|magma/, '#E8762E'],
  [/snow|powder/, '#F2F4F6'],
  [/ice/, '#9CC3F5'],
  [/sandstone|sand/, '#DDCF97'],
  [/gravel/, '#8E8682'],
  [/clay/, '#A3A8B6'],
  [/mud|dirt|podzol|farmland|path/, '#8A5A3B'],
  [/netherrack|crimson|nether_wart/, '#8E3434'],
  [/warped/, '#2E8C84'],
  [/end_stone|purpur/, '#D9D59C'],
  [/spruce|dark_oak/, '#6B4F2F'],
  [/birch/, '#D8C88D'],
  [/jungle|acacia/, '#B5784A'],
  [/cherry/, '#E7B4B9'],
  [/mangrove|bamboo/, '#9E5A3C'],
  [/oak|log|wood|planks|crafting|bookshelf|barrel|chest/, '#A9824F'],
  [/pumpkin|melon/, '#D98A2B'],
  [/hay/, '#C9A834'],
  [/tnt/, '#C8463C'],
  [/brick/, '#9A5745'],
  [/deepslate|basalt|tuff/, '#4A4A50'],
  [/cobble|andesite|stone|furnace|smooth/, '#8A8A8E'],
  [/diorite|quartz|calcite|bone/, '#E2E0DA'],
  [/granite/, '#9A6A58'],
  [/glass/, '#BFE6F2'],
  [/sword|pickaxe|axe|shovel|hoe/, '#52D6DC'],
];

/** 染料色前缀（羊毛、混凝土、陶瓦、玻璃……）用染料色 */
function dyeColor(name: string): Rgb | null {
  // 长名字先匹配（light_blue 先于 blue）
  const dyes = [...DYE_PALETTE].sort((a, b) => b.key.length - a.key.length);
  for (const d of dyes) if (name.startsWith(`${d.key}_`) || name.includes(`/${d.key}_`)) return hex(d.hex);
  return null;
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** 中性的兜底色（灰阶里带一点点冷色，和界面的中性灰协调） */
const FALLBACK: Rgb[] = ['#8A8A8E', '#6F7A86', '#9B9488', '#7C8A7A'].map(hex);

/** 要被引擎着色（tints.json）的贴图：做成浅灰，颜色交给着色 */
const TINTED = (() => {
  const set = new Set<string>();
  const blocks = blocksJson as Record<string, { tex?: Record<string, string>; tint?: Record<string, string> }>;
  for (const def of Object.values(blocks)) {
    if (!def.tint || !def.tex) continue;
    for (const face of Object.keys(def.tint)) {
      const tex = def.tex[face];
      if (tex) set.add(tex);
    }
  }
  return set;
})();

function colorFor(path: string): Rgb {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dye = dyeColor(name);
  if (dye) return dye;
  for (const [re, c] of WORD_COLORS) if (re.test(name)) return hex(c);
  return FALLBACK[hash(path) % FALLBACK.length]!;
}

function clamp(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}

/** 贴图 ID（minecraft:block/stone、block/stone）→ 去掉命名空间的路径 */
function texturePath(id: string): string {
  const i = id.indexOf(':');
  return i >= 0 ? id.slice(i + 1) : id;
}

interface Rgba {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

function blockTexture(path: string): Rgba {
  const size = 16;
  const data = new Uint8ClampedArray(size * size * 4);
  const tinted = TINTED.has(path);
  const [r, g, b] = tinted ? ([206, 206, 206] as Rgb) : colorFor(path);
  const seed = hash(path);
  const glass = /glass/.test(path);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      // 2×2 像素一格的确定性明暗噪点，再加一圈很淡的边，让方块之间分得开
      const n = ((hash(`${seed}:${x >> 1}:${y >> 1}`) & 255) / 255 - 0.5) * 0.14;
      const edge = x === 0 || y === 0 ? 0.08 : x === size - 1 || y === size - 1 ? -0.12 : 0;
      const k = 1 + n + edge;
      const i = (y * size + x) * 4;
      data[i] = clamp(r * k);
      data[i + 1] = clamp(g * k);
      data[i + 2] = clamp(b * k);
      data[i + 3] = glass && x > 0 && y > 0 && x < size - 1 && y < size - 1 ? 90 : 255;
    }
  return { width: size, height: size, data };
}

/** 物品：一个菱形的剪影（引擎按 alpha 挤出厚度） */
function itemTexture(path: string): Rgba {
  const size = 16;
  const data = new Uint8ClampedArray(size * size * 4);
  const [r, g, b] = colorFor(path);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const d = Math.abs(x - 7.5) + Math.abs(y - 7.5);
      if (d > 7) continue;
      const k = d > 5.5 ? 0.72 : x + y < 14 ? 1.12 : 0.94;
      const i = (y * size + x) * 4;
      data[i] = clamp(r * k);
      data[i + 1] = clamp(g * k);
      data[i + 2] = clamp(b * k);
      data[i + 3] = 255;
    }
  return { width: size, height: size, data };
}

/** 界面贴图（提示框、进度条）：按 GUI_TEXTURES 的原版尺寸，深色底加 2 像素的浅边，九宫格用那里的缺省 */
function guiTexture(id: string): Rgba | null {
  const def = GUI_TEXTURES.find((g) => g.id === id || g.id === `minecraft:${texturePath(id)}`);
  if (!def) return null;
  const { width, height } = def;
  const data = new Uint8ClampedArray(width * height * 4);
  const progress = /progress/.test(id);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const border = x < 2 || y < 2 || x >= width - 2 || y >= height - 2;
      const c: Rgb = progress ? [60, 183, 244] : border ? [92, 92, 98] : [32, 32, 34];
      const i = (y * width + x) * 4;
      data.set([...c, 255], i);
    }
  return { width, height, data };
}

async function encode(img: Rgba): Promise<Uint8Array> {
  const canvas = new OffscreenCanvas(img.width, img.height);
  const g = canvas.getContext('2d');
  if (!g) throw new Error('2d context unavailable');
  g.putImageData(new ImageData(img.data as Uint8ClampedArray<ArrayBuffer>, img.width, img.height), 0, 0);
  const blob = await canvas.convertToBlob({ type: 'image/png' });
  return new Uint8Array(await blob.arrayBuffer());
}

const cache = new Map<string, Promise<Uint8Array | null>>();

/** 贴图 ID 对应的 PNG；认不出的类别（实体、粒子等）返回 null，引擎用占位图 */
export function demoTexture(id: string): Promise<Uint8Array | null> {
  let p = cache.get(id);
  if (!p) {
    const path = texturePath(id);
    const img = path.startsWith('gui/') ? guiTexture(id) : path.startsWith('item/') ? itemTexture(path) : path.startsWith('block/') ? blockTexture(path) : null;
    p = img ? encode(img) : Promise.resolve(null);
    cache.set(id, p);
  }
  // 调用方会把缓冲转移给 Worker，每次给一份新的
  return p.then((b) => (b ? b.slice() : null));
}
