// 方块类转场共用的小工具（第 3 批加入，docs/templates/batch-3.md）：方块列表参数、铺满舞台的方块网格、
// 顺序图案、按方块种类分组的实例、音效 cue 的抽样和声源位置。
// 只用 ctx 给的东西；纯函数部分不依赖 ctx，验收测试直接导入（tests/unit/T-TPL-LIB.block.test.ts）。
import type { BlockInstances, ParamValue, SetupContext } from '@allay/template-sdk';
import { MAX_CUES, sampleIndices } from './cues';

type Object3D = InstanceType<SetupContext['THREE']['Object3D']>;

export interface BlockEntry {
  id: string;
  weight: number;
}

/** blockList 参数 → 非空的方块列表（权重大于 0 的项）；都不合法时用 fallback */
export function blockList(v: ParamValue | undefined, fallback: readonly BlockEntry[]): BlockEntry[] {
  const out: BlockEntry[] = [];
  if (Array.isArray(v)) {
    for (const e of v) {
      if (e && typeof e === 'object' && !Array.isArray(e) && typeof e.id === 'string' && typeof e.weight === 'number' && e.weight > 0) out.push({ id: e.id, weight: e.weight });
    }
  }
  return out.length > 0 ? out : fallback.map((e) => ({ ...e }));
}

/** 铺满舞台的方块网格（同 block-wipe）：格子边长 size = width / cols，行数 ceil(height / size) + 1，垂直居中 */
export interface WallGrid {
  cols: number;
  rows: number;
  size: number;
  count: number;
  /** 格子中心的设计坐标（原点在舞台中心，+y 向上）；i = r × cols + c，r = 0 是最上一行 */
  px: Float64Array;
  py: Float64Array;
}

export function wallGrid(width: number, height: number, cols: number): WallGrid {
  const c = Math.max(1, Math.round(cols));
  const size = width / c;
  const rows = Math.ceil(height / size) + 1;
  const count = c * rows;
  const px = new Float64Array(count);
  const py = new Float64Array(count);
  for (let r = 0; r < rows; r++) {
    for (let k = 0; k < c; k++) {
      const i = r * c + k;
      px[i] = -width / 2 + (k + 0.5) * size;
      py[i] = ((rows - 1) / 2 - r) * size;
    }
  }
  return { cols: c, rows, size, count, px, py };
}

/** 方块出现、消失的先后图案（同 block-wipe 的进入顺序） */
export type OrderPattern = 'leftToRight' | 'rightToLeft' | 'topToBottom' | 'bottomToTop' | 'centerOut' | 'edgesIn' | 'diagonal' | 'random' | 'noise';

export const ORDER_PATTERNS: readonly OrderPattern[] = ['leftToRight', 'rightToLeft', 'topToBottom', 'bottomToTop', 'centerOut', 'edgesIn', 'diagonal', 'random', 'noise'];

export function toOrderPattern(v: unknown, fallback: OrderPattern): OrderPattern {
  return typeof v === 'string' && (ORDER_PATTERNS as readonly string[]).includes(v) ? (v as OrderPattern) : fallback;
}

/** 把数组线性归一化到 [0, 1]（全部相同时都是 0） */
export function normalize(a: Float64Array): Float64Array {
  let lo = Infinity;
  let hi = -Infinity;
  for (const x of a) {
    if (x < lo) lo = x;
    if (x > hi) hi = x;
  }
  for (let i = 0; i < a.length; i++) a[i] = hi > lo ? (a[i]! - lo) / (hi - lo) : 0;
  return a;
}

/**
 * 每个点的顺序值 u ∈ [0, 1]（0 最先），归一化过。px、py 是设计坐标（原点在舞台中心，+y 向上）。
 * random 逐点取一次 random()；noise 用 noise(x, y)（调用方传 ctx.noise2D 的包装，坐标已经除过 420，同 block-wipe）。
 */
export function orderValues(pattern: OrderPattern, px: ArrayLike<number>, py: ArrayLike<number>, width: number, height: number, random: () => number, noise: (x: number, y: number) => number): Float64Array {
  const n = px.length;
  const raw = new Float64Array(n);
  const radius = Math.hypot(width / 2, height / 2);
  for (let i = 0; i < n; i++) {
    const x = px[i]!;
    const y = py[i]!;
    const fx = (x + width / 2) / width;
    const fy = (height / 2 - y) / height;
    const d = Math.hypot(x, y) / radius;
    switch (pattern) {
      case 'leftToRight': raw[i] = fx; break;
      case 'rightToLeft': raw[i] = 1 - fx; break;
      case 'topToBottom': raw[i] = fy; break;
      case 'bottomToTop': raw[i] = 1 - fy; break;
      case 'centerOut': raw[i] = d; break;
      case 'edgesIn': raw[i] = 1 - d; break;
      case 'diagonal': raw[i] = fx + fy; break;
      case 'random': raw[i] = random(); break;
      case 'noise': raw[i] = noise(x / 420, y / 420); break;
    }
  }
  return normalize(raw);
}

/** 顺序值加 jitter × 随机数后再归一化（返回新数组） */
export function jittered(u: Float64Array, jitter: number, random: () => number): Float64Array {
  const out = new Float64Array(u.length);
  for (let i = 0; i < u.length; i++) out[i] = u[i]! + jitter * random();
  return normalize(out);
}

/**
 * 一种声音最多放 max 个 cue（docs/template-catalog.md 第 2 节“声音”），返回被选中的序号。
 * 方块的 cue 是按格子的序号排的、不是按时刻，所以先按时刻排序，再照 cues.ts 的 sampleIndices 均匀抽样。
 */
export function sampleCueIndices(times: ArrayLike<number>, max = MAX_CUES): number[] {
  const order = Array.from({ length: times.length }, (_, i) => i).sort((a, b) => times[a]! - times[b]! || a - b);
  return sampleIndices(order.length, max).map((j) => order[j]!);
}

/**
 * 声源位置（空间音效，宿主开关，template-sdk 的 AudioCueOptions.position）：舞台半宽当作 8 格，听者站在画面正前方 6 格，
 * 同 block-wipe。x、y 是设计坐标；depth 是离画面的设计单位（朝相机为正）。
 */
export function cuePosition(x: number, y: number, stageWidth: number, depth = 0): { x: number; y: number; z: number } {
  const k = 8 / (stageWidth / 2);
  return { x: x * k, y: y * k, z: -6 + depth * k };
}

/** 每个格子用第几种方块（kinds 是去重后的方块 ID）、在那一组实例里的序号、每组的实例数 */
export interface KindGroups {
  kinds: string[];
  cellKind: Uint8Array;
  cellIndex: Uint32Array;
  kindCount: number[];
}

/** arranged[i] 是方块列表里的项号（block-arrangement 的结果）；同一个 ID 在列表里出现几次也只算一种 */
export function groupByKind(entries: readonly BlockEntry[], arranged: ArrayLike<number>): KindGroups {
  const kinds = [...new Set(entries.map((e) => e.id))];
  const entryKind = entries.map((e) => kinds.indexOf(e.id));
  const n = arranged.length;
  const cellKind = new Uint8Array(n);
  const cellIndex = new Uint32Array(n);
  const kindCount = new Array<number>(kinds.length).fill(0);
  for (let i = 0; i < n; i++) {
    const k = entryKind[arranged[i]!] ?? 0;
    cellKind[i] = k;
    cellIndex[i] = kindCount[k]!;
    kindCount[k] = kindCount[k]! + 1;
  }
  return { kinds, cellKind, cellIndex, kindCount };
}

/** 每种方块一组实例（没有格子用到的种类是 null），都加到 parent 里 */
export async function kindInstances(ctx: SetupContext, groups: KindGroups, shading: boolean, parent?: Object3D): Promise<(BlockInstances | null)[]> {
  const into = parent ?? ctx.scene;
  const out: (BlockInstances | null)[] = [];
  for (let k = 0; k < groups.kinds.length; k++) {
    if (groups.kindCount[k] === 0) {
      out.push(null);
      continue;
    }
    const handle = await ctx.resources.block(groups.kinds[k]!, { shading });
    const inst = handle.instanced(groups.kindCount[k]!);
    into.add(inst.object);
    out.push(inst);
  }
  return out;
}

/**
 * 透视下把 z = from 处的东西挪到 z = to 处、在画面上位置和大小都不变要乘的系数（相机在 z = cameraZ、看向 −z，
 * 舞台中心在相机的轴上，同 ctx.createStageCamera）：x、y 和尺寸都乘它。垫底放在方块或树叶后面时用，
 * 不然透视下垫底比前面的小一圈，画面边上透过镂空处看得到垫底外面（剪辑点不是整帧不透明）。
 */
export function depthScale(cameraZ: number, from: number, to: number): number {
  return (cameraZ - to) / (cameraZ - from);
}

/** 0–1 钳制 */
export const clamp01 = (x: number): number => (x <= 0 ? 0 : x >= 1 ? 1 : x);

/** sRGB 分量 → 线性（顶点色、着色器里的颜色在线性空间里乘） */
export function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** 方块六个面的明暗（同引擎 blocks.ts，sRGB 空间的系数）：顶 1.0、底 0.5、南北 0.8、东西 0.6 */
export const FACE_SHADE = { up: 1.0, down: 0.5, north: 0.8, south: 0.8, east: 0.6, west: 0.6 } as const;
