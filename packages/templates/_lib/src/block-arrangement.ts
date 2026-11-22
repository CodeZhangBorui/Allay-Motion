// 方块排列：哪个格子放哪种方块（docs/decisions.md“2026-11 反馈：方块排列顺序”）。
// 与“进入顺序”（动画的先后）无关。结果只取决于参数和格子坐标，不读时间、不依赖调用顺序（硬性规则 2）。
//
// 第 3 批加入（docs/templates/batch-3.md）：逻辑和 block-wipe、block-fall 各自目录里的 arrangement.ts 相同，
// 新模板从这里导入。那两份没有改成用这一份（改了会变它们的构建产物）；T-TPL-LIB-B1 逐格核对三份结果一致，改的时候三份一起改。

export type Arrangement = 'random' | 'columns' | 'rows' | 'diagonal' | 'checker' | 'rings';

export const ARRANGEMENTS: readonly Arrangement[] = ['random', 'columns', 'rows', 'diagonal', 'checker', 'rings'];

export interface WeightedEntry {
  weight: number;
}

/** 只有 random 用到的随机数源（ctx.random('blocks')） */
export interface ArrangementRandom {
  next(): number;
}

/**
 * 每个格子（按行从左上到右下，i = r × cols + c）放方块列表里的第几项。
 *
 * - random：按权重随机，逐个格子各取一次随机数。
 * - columns / rows / diagonal / rings：方块列表按顺序排成条带，循环铺开；权重是条带的宽度
 *   （占几列、几行、几条斜线、几圈）。diagonal 的条带是 c + r 相同的格子（从右上到左下的斜线），
 *   rings 是到网格中心的距离（以格子边长计）向下取整。
 * - checker：忽略权重，第 r 行比上一行错开 ⌊n/2⌋ 项（n 是列表项数），上下左右相邻的格子总是不同；
 *   两种方块时就是棋盘。
 */
export function arrangeCells(arrangement: Arrangement, entries: readonly WeightedEntry[], cols: number, rows: number, rng: ArrangementRandom): Uint16Array {
  const count = cols * rows;
  const out = new Uint16Array(count);
  const n = entries.length;
  if (arrangement === 'random') {
    const total = entries.reduce((a, e) => a + e.weight, 0);
    for (let i = 0; i < count; i++) {
      let x = rng.next() * total;
      let k = n - 1;
      for (let j = 0; j < n; j++) {
        x -= entries[j]!.weight;
        if (x < 0) {
          k = j;
          break;
        }
      }
      out[i] = Math.max(0, k);
    }
    return out;
  }
  if (n <= 1) return out;
  if (arrangement === 'checker') {
    const shift = Math.floor(n / 2);
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) out[r * cols + c] = (c + r * shift) % n;
    return out;
  }
  const cc = (cols - 1) / 2;
  const rc = (rows - 1) / 2;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      let band: number;
      if (arrangement === 'columns') band = c;
      else if (arrangement === 'rows') band = r;
      else if (arrangement === 'diagonal') band = c + r;
      else band = Math.floor(Math.hypot(c - cc, r - rc) + 1e-9);
      out[r * cols + c] = bandEntry(entries, band);
    }
  }
  return out;
}

/** 第 band 条条带（从 0 起）落在哪一项：条带中点在循环里的位置，按累计权重查 */
export function bandEntry(entries: readonly WeightedEntry[], band: number): number {
  const n = entries.length;
  const total = entries.reduce((a, e) => a + e.weight, 0);
  if (!(total > 0)) return 0;
  let x = (band + 0.5) % total;
  for (let j = 0; j < n; j++) {
    x -= entries[j]!.weight;
    if (x < 0) return j;
  }
  return n - 1;
}

export function toArrangement(v: unknown): Arrangement {
  return typeof v === 'string' && (ARRANGEMENTS as readonly string[]).includes(v) ? (v as Arrangement) : 'random';
}
