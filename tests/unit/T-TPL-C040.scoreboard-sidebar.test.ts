// 040 记分板 allay.builtin.scoreboard-sidebar 的验收测试（docs/template-catalog.md 第 2 节、docs/templates/scoreboard-sidebar.md）。
// 画面本身（首末帧透明、同一时刻两次渲染一致、三种画幅）由 test:engine 的 T-TPL-3、4、5 检查；这里测 manifest 和纯函数。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { overlayWindows, progress } from '../../packages/templates/_lib/src/timing';
import {
  BODY_ALPHA,
  changeProgress,
  contentWidth,
  fitFactor,
  HEADER_ALPHA,
  LINE_H,
  MAX_ROWS,
  parseRows,
  pieceAt,
  planChange,
  rowTop,
  SCORE_COLOR,
  sidebarLayout,
  SLIDE_FADE_SECONDS,
  SLIDE_SECONDS,
  slidingRows,
  titleLeft,
} from '../../packages/templates/scoreboard-sidebar/src/layout';
import { applyPreset, defaultParams, localizePresetParams, parseManifest, sameValue, sanitizeParams } from '../../packages/template-sdk/src/index';

const manifest = (() => {
  const r = parseManifest(JSON.parse(readFileSync(join(import.meta.dirname, '../../packages/templates/scoreboard-sidebar/manifest.json'), 'utf8')));
  if (!r.ok) throw new Error(`manifest invalid: ${JSON.stringify(r)}`);
  return r.manifest;
})();
const defs = manifest.params ?? [];

describe('T-TPL-C040 记分板', () => {
  it('T-TPL-C040-1 manifest 合法，默认参数清洗后不变，默认值照游戏（红色分数、不带阴影、右侧）', () => {
    expect(manifest.id).toBe('allay.builtin.scoreboard-sidebar');
    expect(manifest.category).toBe('overlay');
    expect(manifest.tags?.[0]).toBe('ui');
    for (const locale of ['zh-CN', 'en'] as const) {
      const d = defaultParams(defs, { locale });
      expect(sanitizeParams(defs, d)).toEqual(d);
    }
    const d = defaultParams(defs, { locale: 'zh-CN' });
    expect(manifest.timeline?.segments.map((s) => s.param)).toEqual(['inDuration', 'hold', 'outDuration']);
    expect(d.scoreColor).toBe(SCORE_COLOR);
    expect(d.side).toBe('right');
    expect(d.reorder).toBe('instant');
    expect(d.sound).toBeNull();
    for (const key of ['titleFont', 'rowFont']) expect((d[key] as { shadow: boolean }).shadow).toBe(false);
    // 默认的两组行都能解析，变化时刻落在停留阶段里，而且确实换了位
    const before = parseRows(d.rows as string);
    const after = parseRows(d.rowsAfter as string);
    expect(before.length).toBeGreaterThanOrEqual(4);
    expect(after.map((r) => r.key).sort()).toEqual(before.map((r) => r.key).sort());
    expect(after[0]!.key).not.toBe(before[0]!.key);
    expect(d.changeAt as number).toBeGreaterThan(d.inDuration as number);
    expect(d.changeAt as number).toBeLessThan((d.inDuration as number) + (d.hold as number));
  });

  it('T-TPL-C040-2 每个自带预设都能载入：值经过清洗后不变，各行能解析', () => {
    expect(manifest.presets?.length).toBeGreaterThanOrEqual(3);
    for (const [preset, locale] of (manifest.presets ?? []).flatMap((p) => (['zh-CN', 'en'] as const).map((l) => [p, l] as const))) {
      // 预设里的文字分中英文：按界面语言取成普通文字再套用（和应用一样）；英文下不该剩中文
      const applied = applyPreset(defs, preset, { locale });
      for (const [k, v] of Object.entries(localizePresetParams(defs, preset.params, locale))) {
        expect(sameValue(applied[k], v), `${preset.key}.${k} (${locale})`).toBe(true);
        if (locale === 'en' && typeof v === 'string') expect(v, `${preset.key}.${k}`).not.toMatch(/[\u3400-\u9fff]/);
      }
      const total = (applied.inDuration as number) + (applied.hold as number) + (applied.outDuration as number);
      expect(total).toBeGreaterThanOrEqual(0.1);
      expect(total).toBeLessThanOrEqual(30);
      expect(parseRows(applied.rows as string).length, preset.key).toBeGreaterThan(0);
      // 有变化的预设：变化后的行都能和变化前的按名字配上
      const after = parseRows(applied.rowsAfter as string);
      const keys = new Set(parseRows(applied.rows as string).map((r) => r.key));
      for (const r of after) expect(keys.has(r.key), `${preset.key}: ${r.key}`).toBe(true);
    }
  });

  it('T-TPL-C040-3 各行的解析和排序：分数从高到低，同分按名字，最多 15 行', () => {
    expect(parseRows('Steve 12\nAlex 9')).toEqual([
      { key: 'Steve', name: 'Steve', score: 12 },
      { key: 'Alex', name: 'Alex', score: 9 },
    ]);
    // 排序；同分按名字（不分大小写）
    expect(parseRows('b 1\nAlex 5\na 1\nZed 5').map((r) => r.key)).toEqual(['Alex', 'Zed', 'a', 'b']);
    // 最后一个词不是整数：整行是名字，分数 0；负数可以；名字里可以有空格
    expect(parseRows('找到 村庄\nKai -3\nNoor x2')).toEqual([
      { key: 'Noor x2', name: 'Noor x2', score: 0 },
      { key: '找到 村庄', name: '找到 村庄', score: 0 },
      { key: 'Kai', name: 'Kai', score: -3 },
    ]);
    // 只有一个数字的行是名字
    expect(parseRows('42')).toEqual([{ key: '42', name: '42', score: 0 }]);
    // 格式码不算进配对用的名字；重名只留第一条；空行跳过
    expect(parseRows('§a§m挖到钻石§r 3\n\n&c挖到钻石 9')).toEqual([{ key: '挖到钻石', name: '§a§m挖到钻石§r', score: 3 }]);
    // 超过 15 条只留分数最高的 15 条
    const many = parseRows(Array.from({ length: 20 }, (_, i) => `p${i} ${i}`).join('\n'));
    expect(many).toHaveLength(MAX_ROWS);
    expect(many[0]!.score).toBe(19);
    expect(many[14]!.score).toBe(5);
  });

  it('T-TPL-C040-4 版式：1080p、界面缩放 4（480 × 270）、5 行、内容宽 60 时的位置', () => {
    expect(LINE_H).toBe(9);
    expect([BODY_ALPHA, HEADER_ALPHA]).toEqual([0.3, 0.4]);
    expect(SCORE_COLOR).toBe('#FF5555');
    const l = sidebarLayout(480, 270, 5, 60);
    // 底边 = ⌊270 / 2⌋ + ⌊45 / 3⌋ = 150；最上一行的上边 = 150 − 45
    expect(l.bottom).toBe(150);
    expect(l.top).toBe(105);
    // 名字左边 = 480 − 60 − 3；黑底从它左边 2 到 480 − 1
    expect(l.left).toBe(417);
    expect(l.backLeft).toBe(415);
    expect(l.right).toBe(479);
    // 标题：黑底从 top − 10 到 top − 1，文字在 top − 9
    expect(l.headerTop).toBe(95);
    expect(l.titleTop).toBe(96);
    // 各行自上而下，每行 9
    expect([0, 1, 4].map((i) => rowTop(l, i))).toEqual([105, 114, 141]);
    expect(rowTop(l, 4) + LINE_H).toBe(l.bottom);
    // 标题在内容宽度里居中，两个除法都取整
    expect(titleLeft(l, 60, 31)).toBe(417 + 30 - 15);
    // 高度是奇数时中心按整数除法；行高不是 3 的倍数时也取整
    expect(sidebarLayout(480, 271, 4, 60).bottom).toBe(135 + 12);
    // 左侧是镜像：离左边缘同样 1 个界面像素，宽度不变
    const m = sidebarLayout(480, 270, 5, 60, 'left');
    expect([m.backLeft, m.left, m.right]).toEqual([1, 3, 65]);
    expect(m.right - m.backLeft).toBe(l.right - l.backLeft);
    expect(m.top).toBe(l.top);
  });

  it('T-TPL-C040-5 内容宽度：标题和“名字 + 冒号空格 + 分数”里最宽的；不显示数字时只看名字', () => {
    const rows = [
      { nameW: 29, scoreW: 12 },
      { nameW: 40, scoreW: 6 },
    ];
    expect(contentWidth(20, rows, 6, true)).toBe(52);
    expect(contentWidth(20, rows, 6, false)).toBe(40);
    expect(contentWidth(80, rows, 6, true)).toBe(80);
    expect(contentWidth(0, [], 6, true)).toBe(0);
    // 系统字体量出来的宽度不是整数时向上取整
    expect(contentWidth(10.2, [], 6, true)).toBe(11);
  });

  it('T-TPL-C040-6 放不下时缩小：缩小后标题和最下一行都在界面里，面板不超出两侧', () => {
    // 放得下时不缩
    expect(fitFactor(480, 270, 5, 60)).toBe(1);
    expect(fitFactor(216, 384, 15, 80)).toBe(1);
    for (const [w, h, n, cw] of [
      [135, 135, 15, 60],
      [240, 135, 15, 300],
      [135, 240, 3, 400],
      [1080, 1080, 15, 2000],
    ] as const) {
      const k = fitFactor(w, h, n, cw);
      expect(k).toBeLessThan(1);
      for (const side of ['right', 'left'] as const) {
        const l = sidebarLayout(w / k, h / k, n, cw, side);
        expect(l.headerTop).toBeGreaterThanOrEqual(0);
        expect(l.bottom).toBeLessThanOrEqual(h / k);
        expect(l.backLeft).toBeGreaterThanOrEqual(0);
        expect(l.right).toBeLessThanOrEqual(w / k);
      }
    }
  });

  it('T-TPL-C040-7 变化的进度：instant 在变化时刻跳变，slide 用 0.3 秒走完', () => {
    expect(SLIDE_SECONDS).toBe(0.3);
    expect(changeProgress(1.99, 2, 'instant')).toBe(0);
    expect(changeProgress(2, 2, 'instant')).toBe(1);
    expect(changeProgress(1.99, 2, 'slide')).toBe(0);
    expect(changeProgress(2, 2, 'slide')).toBe(0);
    expect(changeProgress(2.15, 2, 'slide')).toBeCloseTo(0.5);
    expect(changeProgress(2.3, 2, 'slide')).toBe(1);
    expect(changeProgress(9, 2, 'slide')).toBe(1);
    // 单调
    let last = 0;
    for (let t = 2; t <= 2.3; t += 0.01) {
      const p = changeProgress(t, 2, 'slide');
      expect(p).toBeGreaterThanOrEqual(last);
      last = p;
    }
    // 没有变化时（变化时刻是无穷大）一直是 0
    expect(changeProgress(30, Number.POSITIVE_INFINITY, 'slide')).toBe(0);
  });

  it('T-TPL-C040-8 整体的不透明度：首末各一帧为 0，停留阶段为 1', () => {
    const d = defaultParams(defs);
    const w = overlayWindows(60, d.inDuration as number, d.hold as number, d.outDuration as number);
    const a = (t: number) => progress(t, w.in) * (1 - progress(t, w.out));
    expect(w.duration).toBeCloseTo(4.5);
    expect(a(0)).toBe(0);
    expect(a(1 / 60)).toBe(0);
    expect(a(w.duration)).toBe(0);
    expect(a(w.duration - 1 / 60)).toBe(0);
    expect(a(0.25)).toBe(1);
    expect(a(2)).toBe(1);
    expect(a(0.125)).toBeGreaterThan(0);
    expect(a(0.125)).toBeLessThan(1);
  });

  it('T-TPL-C040-9 滑动换位时哪些行滑：相对顺序不变的最多的一组，一样多时选往上走的', () => {
    const sorted = (set: Set<number>) => [...set].sort((a, b) => a - b);
    // 两行互换：往上走的那行（超过别人的）滑，另一行淡出淡入
    expect(sorted(slidingRows([[0, 1], [1, 0]]))).toEqual([1]);
    // 击杀榜：Alex 从第二到第一，Steve 退到第二，其余不动
    expect(sorted(slidingRows([[0, 1], [1, 0], [2, 2], [3, 3], [4, 4]]))).toEqual([1, 2, 3, 4]);
    // 一行连超两行：被超过的两行一起往下滑（行多），超过的那行淡出淡入
    expect(sorted(slidingRows([[0, 1], [1, 2], [2, 0], [3, 3]]))).toEqual([0, 1, 3]);
    // 顺序没变时全部滑；没有行时是空的
    expect(slidingRows([[0, 0], [1, 2], [2, 3]]).size).toBe(3);
    expect(slidingRows([]).size).toBe(0);
  });

  it('T-TPL-C040-10 滑动换位逐帧：显示着的任意两行间距不小于一行（不叠字），前后两段文字不同时显示，变化前后各行在自己的位置', () => {
    let seed = 20261122;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const cases: [string, string][] = [];
    // 预设里两个滑动的例子，两种语言各一份（排序、换位的行不一样）
    for (const preset of manifest.presets ?? []) {
      if (preset.params.reorder !== 'slide') continue;
      for (const locale of ['zh-CN', 'en']) {
        const p = localizePresetParams(defs, preset.params, locale);
        cases.push([String(p.rows), String(p.rowsAfter)]);
      }
    }
    expect(cases.length).toBeGreaterThanOrEqual(4);
    // 随机的两组行：分数随机，有的行消失、有的行新增、有的行换位
    const names = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];
    const board = () =>
      names
        .filter(() => rnd() < 0.6)
        .map((k) => `${k} ${Math.floor(rnd() * 10)}`)
        .join('\n');
    for (let i = 0; i < 300; i++) cases.push([board(), board()]);
    const changeAt = 1;
    for (const [beforeText, afterText] of cases) {
      const before = parseRows(beforeText);
      const after = parseRows(afterText);
      const plan = planChange(before, after, changeAt, 'slide');
      expect(plan.inEnd - changeAt).toBeLessThanOrEqual(SLIDE_FADE_SECONDS * 2 + SLIDE_SECONDS + 1e-9);
      const lb = sidebarLayout(480, 270, before.length, 60);
      const la = sidebarLayout(480, 270, after.length, 60);
      const ys = (m: { from: number | null; to: number | null }) => {
        const yb = m.from !== null ? rowTop(lb, m.from) : rowTop(la, m.to!);
        return [yb, m.to !== null ? rowTop(la, m.to) : yb] as const;
      };
      for (let frame = 0; frame <= Math.ceil((plan.inEnd + 0.2) * 60); frame++) {
        const t = frame / 60;
        const shown: number[] = [];
        for (const m of plan.motions.values()) {
          const [yb, ya] = ys(m);
          // 一行的文字前后不同时是两段（只在变化前显示的、只在变化后显示的），同一时刻至多一段显示
          const old = pieceAt(t, plan, m, yb, ya, true, false);
          const neu = pieceAt(t, plan, m, yb, ya, false, true);
          expect(old.fade > 0 && neu.fade > 0, `${beforeText} → ${afterText} @${frame}`).toBe(false);
          const one = pieceAt(t, plan, m, yb, ya, m.from !== null, m.to !== null);
          if (one.fade > 0) shown.push(one.y);
          if (t < changeAt && m.from !== null) expect([one.y, one.fade]).toEqual([yb, 1]);
          if (t >= plan.inEnd && m.to !== null) expect([one.y, one.fade]).toEqual([ya, 1]);
          if (t >= plan.inEnd && m.to === null) expect(one.fade).toBe(0);
        }
        shown.sort((a, b) => a - b);
        for (let i = 1; i < shown.length; i++) expect(shown[i]! - shown[i - 1]!, `${beforeText} → ${afterText} @${frame}`).toBeGreaterThanOrEqual(LINE_H - 1e-9);
      }
    }
    // 击杀榜：Alex 滑上去，Steve 先淡出、Alex 滑完后在第二行淡入；整段在停留阶段里做完
    const kill = localizePresetParams(defs, manifest.presets!.find((p) => p.key === 'kill-board')!.params, 'en');
    const plan = planChange(parseRows(String(kill.rows)), parseRows(String(kill.rowsAfter)), Number(kill.changeAt), 'slide');
    expect(plan.motions.get('Alex')?.slide).toBe(true);
    expect(plan.motions.get('Steve')?.slide).toBe(false);
    expect(plan.inEnd).toBeCloseTo(Number(kill.changeAt) + 0.6);
    expect(plan.inEnd).toBeLessThan(Number(defaultParams(defs).inDuration) + Number(defaultParams(defs).hold));
    // instant：所有行都在变化时刻跳到新位置
    const instant = planChange(parseRows(String(kill.rows)), parseRows(String(kill.rowsAfter)), 2, 'instant');
    expect([...instant.motions.values()].every((m) => m.slide)).toBe(true);
    expect(pieceAt(1.99, instant, instant.motions.get('Alex')!, 10, 1, true, true)).toEqual({ y: 10, fade: 1 });
    expect(pieceAt(2, instant, instant.motions.get('Alex')!, 10, 1, true, true)).toEqual({ y: 1, fade: 1 });
  });
});
