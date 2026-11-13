import { describe, expect, it } from 'vitest';
import { animationFrameAt, frameRect, layoutAnimation, parseAnimationMeta, parseGuiNineSlice, parsePackMeta, readPngHeader } from '../../packages/assets/src/index';
import { solidPng } from './helpers/resource-fixtures';

// T-AST-4：带 .mcmeta 的 4 帧动画贴图，frametime = 2，t = 0, 0.1, 0.2, 0.3, 0.4 时帧序号为 0, 1, 2, 3, 0。

describe('T-AST-4 动画贴图', () => {
  it('4 帧、frametime 2', () => {
    const png = solidPng('#123456', 64);
    const header = readPngHeader(png);
    expect(header).toMatchObject({ width: 16, height: 64 });
    const meta = parseAnimationMeta(JSON.stringify({ animation: { frametime: 2 } }));
    expect(meta).not.toBeNull();
    const layout = layoutAnimation(meta!, header!.width, header!.height);
    expect(layout).toMatchObject({ frameWidth: 16, frameHeight: 16, frameCount: 4 });
    expect([0, 0.1, 0.2, 0.3, 0.4].map((t) => animationFrameAt(layout!, t))).toEqual([0, 1, 2, 3, 0]);
    expect(frameRect(layout!, 16, 3)).toEqual({ x: 0, y: 48, width: 16, height: 16 });
  });

  it('frames 数组：序号与带 time 的对象混用，越界的帧去掉', () => {
    const meta = parseAnimationMeta(JSON.stringify({ animation: { frametime: 1, frames: [3, { index: 0, time: 4 }, 9, { index: 1 }] } }));
    const layout = layoutAnimation(meta!, 16, 64)!;
    expect(layout.sequence).toEqual([
      { index: 3, time: 1 },
      { index: 0, time: 4 },
      { index: 1, time: 1 },
    ]);
    // 刻：0→3；1–4→0；5→1；6→3
    expect([0, 0.05, 0.2, 0.25, 0.3].map((t) => animationFrameAt(layout, t))).toEqual([3, 0, 0, 1, 3]);
  });

  it('宽高、默认值与坏数据', () => {
    expect(layoutAnimation(parseAnimationMeta('{"animation":{"width":8,"height":8}}')!, 16, 32)).toMatchObject({ frameCount: 8 });
    expect(layoutAnimation(parseAnimationMeta('{"animation":{}}')!, 16, 48)).toMatchObject({ frameCount: 3, cycleTicks: 3 });
    expect(layoutAnimation(parseAnimationMeta('{"animation":{}}')!, 16, 40)).toBeNull();
    expect(parseAnimationMeta('{"animation":{"frametime":-1,"interpolate":"x"}}')).toMatchObject({ frametime: 1, interpolate: false });
    expect(parseAnimationMeta('{}')).toBeNull();
    expect(parseAnimationMeta('not json')).toBeNull();
    const layout = layoutAnimation(parseAnimationMeta('{"animation":{"frametime":2}}')!, 16, 64)!;
    expect(animationFrameAt(layout, -0.1)).toBe(3);
    expect(animationFrameAt(layout, Number.NaN)).toBe(0);
  });

  it('pack.mcmeta 与九宫格', () => {
    expect(parsePackMeta('{"pack":{"pack_format":15,"description":{"text":"Hi ","extra":[{"text":"§lthere"}]}}}')).toEqual({ packFormat: 15, description: 'Hi there' });
    expect(parsePackMeta('{"pack":{"min_format":70}}')).toEqual({ packFormat: 70 });
    expect(parsePackMeta('garbage')).toEqual({});
    expect(parseGuiNineSlice('{"gui":{"scaling":{"type":"nine_slice","width":160,"height":32,"border":4}}}')).toEqual({
      width: 160,
      height: 32,
      border: { left: 4, top: 4, right: 4, bottom: 4 },
    });
    expect(parseGuiNineSlice('{"gui":{"scaling":{"type":"stretch"}}}')).toBeNull();
  });
});
