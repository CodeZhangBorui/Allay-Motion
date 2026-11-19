// T-ARR：方块排列（docs/decisions.md“2026-11 反馈：方块排列顺序”）。
// 格子到方块的映射是纯函数（只取决于参数和格子坐标）；默认仍是按权重随机，旧工程的画面不变；模板自带的预设能正确载入。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { arrangeCells, bandEntry, type Arrangement } from '../../packages/templates/block-wipe/src/arrangement';
import { applyPreset, parseManifest, sanitizeParams, type TemplateManifest } from '../../packages/template-sdk/src/index';
import { moveEntry } from '../../packages/ui/src/editor/listOrder';

const TEMPLATES = join(import.meta.dirname, '../../packages/templates');

function manifest(name: string): TemplateManifest {
  const r = parseManifest(JSON.parse(readFileSync(join(TEMPLATES, name, 'manifest.json'), 'utf8')));
  if (!r.ok) throw new Error(`${name}: ${JSON.stringify(r.issues)}`);
  return r.manifest;
}

/** 测试用的确定随机数（mulberry32） */
function rng(seed: number) {
  let a = seed >>> 0;
  return {
    calls: 0,
    next() {
      this.calls++;
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
  };
}

const noRandom = { next: () => { throw new Error('非随机排列不该取随机数'); } };
const ones = (n: number) => Array.from({ length: n }, () => ({ weight: 1 }));
const grid = (a: Uint16Array, cols: number) => Array.from({ length: a.length / cols }, (_, r) => Array.from(a.subarray(r * cols, (r + 1) * cols)));

describe('T-ARR-1 按列依次', () => {
  it('七种方块、权重 1：每列一种，列之间循环', () => {
    const a = arrangeCells('columns', ones(7), 14, 3, noRandom);
    for (const row of grid(a, 14)) expect(row).toEqual([0, 1, 2, 3, 4, 5, 6, 0, 1, 2, 3, 4, 5, 6]);
  });
  it('权重是条带宽度：权重 2 占两列', () => {
    const a = arrangeCells('columns', [{ weight: 2 }, { weight: 1 }, { weight: 2 }], 10, 2, noRandom);
    expect(grid(a, 10)[0]).toEqual([0, 0, 1, 2, 2, 0, 0, 1, 2, 2]);
  });
  it('小数权重按累计宽度取条带中点', () => {
    expect([0, 1, 2, 3, 4].map((b) => bandEntry([{ weight: 1.5 }, { weight: 1 }], b))).toEqual([0, 1, 0, 0, 1]);
  });
});

describe('T-ARR-2 按行依次', () => {
  it('从最上一行起，每行一种', () => {
    const a = arrangeCells('rows', ones(3), 4, 5, noRandom);
    expect(grid(a, 4)).toEqual([[0, 0, 0, 0], [1, 1, 1, 1], [2, 2, 2, 2], [0, 0, 0, 0], [1, 1, 1, 1]]);
  });
});

describe('T-ARR-3 斜向依次', () => {
  it('c + r 相同的格子同一种', () => {
    const a = arrangeCells('diagonal', ones(4), 5, 3, noRandom);
    expect(grid(a, 5)).toEqual([[0, 1, 2, 3, 0], [1, 2, 3, 0, 1], [2, 3, 0, 1, 2]]);
  });
});

describe('T-ARR-4 棋盘交替', () => {
  it('两种方块是棋盘', () => {
    const a = arrangeCells('checker', [{ weight: 5 }, { weight: 1 }], 4, 3, noRandom);
    expect(grid(a, 4)).toEqual([[0, 1, 0, 1], [1, 0, 1, 0], [0, 1, 0, 1]]);
  });
  it('任意种数：上下左右相邻的格子不同，权重不影响', () => {
    for (let n = 2; n <= 16; n++) {
      const g = grid(arrangeCells('checker', Array.from({ length: n }, (_, i) => ({ weight: i + 1 })), 12, 8, noRandom), 12);
      for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 12; c++) {
          if (c + 1 < 12) expect(g[r]![c]).not.toBe(g[r]![c + 1]);
          if (r + 1 < 8) expect(g[r]![c]).not.toBe(g[r + 1]![c]);
        }
      }
    }
  });
});

describe('T-ARR-5 同心环', () => {
  it('到网格中心的距离向下取整是第几圈，按列表循环', () => {
    const a = arrangeCells('rings', ones(3), 5, 5, noRandom);
    expect(grid(a, 5)).toEqual([
      [2, 2, 2, 2, 2],
      [2, 1, 1, 1, 2],
      [2, 1, 0, 1, 2],
      [2, 1, 1, 1, 2],
      [2, 2, 2, 2, 2],
    ]);
  });
  it('左右、上下对称', () => {
    const cols = 12;
    const rows = 8;
    const g = grid(arrangeCells('rings', ones(5), cols, rows, noRandom), cols);
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      expect(g[r]![c]).toBe(g[r]![cols - 1 - c]);
      expect(g[r]![c]).toBe(g[rows - 1 - r]![c]);
    }
  });
});

describe('T-ARR-6 随机仍是默认，旧工程画面不变', () => {
  /** 2026-11 之前模板里内联的分配代码（照原样搬来） */
  function legacy(entries: { id: string; weight: number }[], count: number, pick: { next(): number }): number[] {
    const totalWeight = entries.reduce((a, e) => a + e.weight, 0);
    const kinds = [...new Set(entries.map((e) => e.id))];
    const out: number[] = [];
    for (let i = 0; i < count; i++) {
      let x = pick.next() * totalWeight;
      let id = entries[entries.length - 1]!.id;
      for (const e of entries) {
        x -= e.weight;
        if (x < 0) {
          id = e.id;
          break;
        }
      }
      out.push(kinds.indexOf(id));
    }
    return out;
  }
  const entries = [
    { id: 'minecraft:stone', weight: 3 },
    { id: 'minecraft:cobblestone', weight: 1 },
    { id: 'minecraft:stone', weight: 0.5 },
    { id: 'minecraft:andesite', weight: 2 },
  ];
  it('random 与旧代码逐格相同，取随机数的次数也相同', () => {
    const kinds = [...new Set(entries.map((e) => e.id))];
    const entryKind = entries.map((e) => kinds.indexOf(e.id));
    for (const seed of [1, 7, 12345]) {
      const a = rng(seed);
      const b = rng(seed);
      const now = Array.from(arrangeCells('random', entries, 12, 8, a), (k) => entryKind[k]!);
      expect(now).toEqual(legacy(entries, 96, b));
      expect(a.calls).toBe(b.calls);
    }
  });
  it('只有一种方块时也照旧逐格取随机数（后面的随机流不受影响）', () => {
    const a = rng(3);
    expect(Array.from(arrangeCells('random', [{ weight: 1 }], 4, 2, a))).toEqual(Array(8).fill(0));
    expect(a.calls).toBe(8);
  });
  it('两个方块模板的默认值是 random；没有这个参数的旧工程清洗后也是 random', () => {
    for (const name of ['block-wipe', 'block-fall']) {
      const defs = manifest(name).params!;
      const def = defs.find((p) => p.key === 'arrangement');
      expect(def?.type === 'enum' && def.default).toBe('random');
      expect(sanitizeParams(defs, { cols: 16 }).arrangement).toBe('random');
    }
  });
  it('排列是纯函数：同样的输入两次结果相同，非随机排列不取随机数', () => {
    for (const mode of ['columns', 'rows', 'diagonal', 'checker', 'rings'] as Arrangement[]) {
      expect(arrangeCells(mode, ones(7), 13, 9, noRandom)).toEqual(arrangeCells(mode, ones(7), 13, 9, noRandom));
    }
  });
});

describe('T-ARR-7 两个模板用同一份排列代码', () => {
  it('block-wipe 和 block-fall 的 arrangement.ts 逐字节相同', () => {
    const a = readFileSync(join(TEMPLATES, 'block-wipe/src/arrangement.ts'), 'utf8').replace(/\r\n/g, '\n');
    const b = readFileSync(join(TEMPLATES, 'block-fall/src/arrangement.ts'), 'utf8').replace(/\r\n/g, '\n');
    expect(b).toBe(a);
  });
  it('两个 manifest 的“方块排列”参数一致，选项覆盖排列代码的全部模式，方块列表最多 16 项', () => {
    const wipe = manifest('block-wipe').params!;
    const fall = manifest('block-fall').params!;
    const pick = (defs: typeof wipe) => defs.find((p) => p.key === 'arrangement');
    expect(pick(fall)).toEqual(pick(wipe));
    const def = pick(wipe);
    expect(def?.type === 'enum' && def.ui).toBe('pattern');
    expect(def?.type === 'enum' && def.options.map((o) => o.value)).toEqual(['random', 'columns', 'rows', 'diagonal', 'checker', 'rings']);
    for (const defs of [wipe, fall]) {
      const blocks = defs.find((p) => p.key === 'blocks');
      expect(blocks?.type === 'blockList' && blocks.max).toBe(16);
    }
  });
});

describe('T-ARR-8 模板自带的预设', () => {
  it('七色混凝土按列：载入后方块按彩虹顺序、按列排列', () => {
    const m = manifest('block-wipe');
    const preset = m.presets?.find((p) => p.key === 'rainbow-concrete-columns');
    expect(preset).toBeDefined();
    const values = applyPreset(m.params!, preset!);
    expect(values.arrangement).toBe('columns');
    expect((values.blocks as { id: string }[]).map((b) => b.id)).toEqual(
      ['red', 'orange', 'yellow', 'lime', 'light_blue', 'blue', 'purple'].map((c) => `minecraft:${c}_concrete`),
    );
    // 预设里没写的参数回到默认值
    expect(values.seed).toBe(1);
  });
  it('每个预设套用后，写到的参数都原样保留（没有被清洗掉）', () => {
    for (const name of ['block-wipe', 'block-fall']) {
      const m = manifest(name);
      expect(m.presets?.length).toBeGreaterThanOrEqual(3);
      for (const p of m.presets!) {
        const values = applyPreset(m.params!, p);
        for (const [k, v] of Object.entries(p.params)) expect(values[k], `${name} ${p.key} ${k}`).toEqual(v);
      }
    }
  });
  it('manifest 校验：预设引用未知参数、key 重复都拒绝', () => {
    const raw = JSON.parse(readFileSync(join(TEMPLATES, 'block-wipe/manifest.json'), 'utf8'));
    raw.presets = [{ key: 'a', name: 'A', params: { nope: 1 } }, { key: 'a', name: 'B', params: {} }];
    const r = parseManifest(raw);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues.map((i) => i.path).sort()).toEqual(['presets.0.params.nope', 'presets.1.key']);
  });
});

describe('T-ARR-9 方块列表排序', () => {
  it('moveEntry 把一项挪到新位置，其余相对顺序不变', () => {
    expect(moveEntry(['a', 'b', 'c', 'd'], 0, 2)).toEqual(['b', 'c', 'a', 'd']);
    expect(moveEntry(['a', 'b', 'c', 'd'], 3, 1)).toEqual(['a', 'd', 'b', 'c']);
    expect(moveEntry(['a', 'b'], 0, 5)).toEqual(['a', 'b']);
  });
});
