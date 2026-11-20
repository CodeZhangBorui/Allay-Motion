// 内置模板共用的源码 packages/templates/_lib（docs/04-templates.md 4.9、docs/template-catalog.md P1）：
// 时间余量、界面像素布局、闭式粒子的函数本身，以及构建脚本对 _lib 的处理（能并进产物、别处的相对导入被拒绝）。
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { anchorTopLeft, fitScale, guiLayout } from '../../packages/templates/_lib/src/gui';
import { ageAt, ballistic, dragFromTickFriction, dragged, frameAt } from '../../packages/templates/_lib/src/particles';
import { eased, overlayWindows, progress, transitionWindows } from '../../packages/templates/_lib/src/timing';
import { bundleTemplate, templateDirs, TEMPLATES_LIB, TEMPLATES_SRC } from '../../scripts/build-templates';

const ROOT = resolve(import.meta.dirname, '../..');

describe('T-TPL-LIB-1 时间余量', () => {
  it('转场：首尾各让出一帧，剪辑点前后一帧内进入已完、退出未开始', () => {
    const w = transitionWindows(60, 0.5, 0.1, 0.5);
    const pad = 1 / 60;
    expect(w.duration).toBeCloseTo(1.1);
    expect(w.cutTime).toBeCloseTo(0.55);
    // 和 block-wipe 里内联的公式逐项相同
    expect(w.in.start).toBeCloseTo(pad);
    expect(w.in.end).toBeCloseTo(0.5);
    expect(w.out.start).toBeCloseTo(0.6);
    expect(w.out.end).toBeCloseTo(1.1 - pad);
    for (const t of [0, pad / 2, pad]) expect(progress(t, w.in)).toBe(0);
    for (const t of [w.cutTime - pad, w.cutTime, w.cutTime + pad]) {
      expect(progress(t, w.in)).toBe(1);
      expect(progress(t, w.out)).toBe(0);
    }
    for (const t of [w.duration - pad, w.duration]) expect(progress(t, w.out)).toBe(1);
  });

  it('停留为 0、剪辑点在停留两端时仍然留得出余量', () => {
    const pad = 1 / 30;
    for (const cutAt of [0, 0.5, 1]) {
      const w = transitionWindows(30, 0.3, 0, 0.3, cutAt);
      expect(w.in.end).toBeLessThanOrEqual(w.cutTime - pad + 1e-9);
      expect(w.out.start).toBeGreaterThanOrEqual(w.cutTime + pad - 1e-9);
      expect(w.in.end).toBeGreaterThan(w.in.start);
      expect(w.out.end).toBeGreaterThan(w.out.start);
    }
  });

  it('帧率极低：余量退回各阶段的一半，时间窗不倒置', () => {
    const w = transitionWindows(2, 0.2, 0, 0.2);
    expect(w.in.start).toBeCloseTo(0.1);
    expect(w.in.end).toBeGreaterThan(w.in.start);
    expect(w.out.end).toBeCloseTo(0.3);
    expect(w.out.start).toBeLessThan(w.out.end);
  });

  it('叠加层：进入从一帧后开始，退出在末尾一帧前结束', () => {
    const w = overlayWindows(60, 0.6, 4.4, 0.6);
    expect(w.duration).toBeCloseTo(5.6);
    expect(progress(1 / 60, w.in)).toBe(0);
    expect(progress(0.6, w.in)).toBe(1);
    expect(progress(5.0, w.out)).toBe(0);
    expect(progress(5.6 - 1 / 60, w.out)).toBe(1);
  });

  it('带缓动的进度在端点精确是 0 和 1，即使缓动函数在端点不精确', () => {
    const sloppy = (x: number) => x * 0.999 + 0.0005;
    const window = { start: 1, end: 2 };
    expect(eased(1, window, sloppy)).toBe(0);
    expect(eased(2, window, sloppy)).toBe(1);
    expect(eased(1.5, window, sloppy)).toBeCloseTo(0.5, 2);
  });
});

describe('T-TPL-LIB-2 界面像素布局', () => {
  const stage = { width: 1920, height: 1080 };

  it('界面坐标（左上角原点、y 向下）换算到舞台坐标（中心原点、y 向上）', () => {
    const g = guiLayout(stage, 4);
    expect([g.width, g.height]).toEqual([480, 270]);
    expect([g.x(0), g.y(0)]).toEqual([-960, 540]);
    expect([g.x(480), g.y(270)]).toEqual([960, -540]);
    // 进度提示框：160 × 32，贴着右上角
    expect(g.rect(320, 0, 160, 32)).toEqual({ x: 640, y: 476, width: 640, height: 128 });
  });

  it('九个停靠位置', () => {
    const g = guiLayout(stage, 4);
    expect(anchorTopLeft(g, 'topLeft', 160, 32)).toEqual({ x: 0, y: 0 });
    expect(anchorTopLeft(g, 'topRight', 160, 32, 2)).toEqual({ x: 318, y: 2 });
    expect(anchorTopLeft(g, 'bottom', 182, 22)).toEqual({ x: 149, y: 248 });
    expect(anchorTopLeft(g, 'center', 100, 50)).toEqual({ x: 190, y: 110 });
    expect(anchorTopLeft(g, 'left', 100, 50, 5)).toEqual({ x: 5, y: 110 });
  });

  it('面板放不下时按比例缩小', () => {
    expect(fitScale(stage, 4, 160, 32)).toBe(4);
    // 竖屏、缩放 10：160 × 10 超出 1080 宽
    expect(fitScale({ width: 1080, height: 1920 }, 10, 160, 32)).toBeCloseTo(6.75);
    expect(fitScale({ width: 1080, height: 1920 }, 10, 160, 32, 40)).toBeCloseTo(6.25);
  });
});

describe('T-TPL-LIB-3 闭式粒子', () => {
  it('年龄：出生前和死后是 −1', () => {
    expect(ageAt(0.4, 0.5, 1)).toBe(-1);
    expect(ageAt(0.75, 0.5, 1)).toBeCloseTo(0.25);
    expect(ageAt(1.6, 0.5, 1)).toBe(-1);
  });

  it('匀加速位移与逐步积分一致', () => {
    let y = 0;
    let v = 3;
    const dt = 1e-4;
    for (let i = 0; i < 10000; i++) {
      v += -9.8 * dt;
      y += v * dt;
    }
    expect(ballistic(1, 3, -9.8)).toBeCloseTo(y, 2);
  });

  it('阻力：按刻乘 0.98 的衰减换算后，20 刻的位移与逐刻累加接近；阻力为 0 时退化为匀速', () => {
    const drag = dragFromTickFriction(0.98);
    let x = 0;
    let v = 1 / 20;
    for (let tick = 0; tick < 20; tick++) {
      x += v;
      v *= 0.98;
    }
    // 连续衰减和按刻衰减差不到 2%
    expect(Math.abs(dragged(1, 1, drag) - x) / x).toBeLessThan(0.02);
    expect(dragged(2, 3, 0)).toBe(6);
  });

  it('动画帧：寿命内从第一帧走到最后一帧', () => {
    expect(frameAt(0, 1, 16)).toBe(0);
    expect(frameAt(0.5, 1, 16)).toBe(8);
    expect(frameAt(1, 1, 16)).toBe(15);
    expect(frameAt(0.3, 1, 1)).toBe(0);
  });
});

describe('T-TPL-LIB-4 构建脚本：_lib 并进模板的产物，模板之间不能互相导入', () => {
  // 夹具放在仓库里被忽略的 node_modules/.cache 下：要用相对路径够到 _lib，必须和仓库在同一个盘
  const cache = join(ROOT, 'node_modules/.cache');
  mkdirSync(cache, { recursive: true });
  const base = mkdtempSync(join(cache, 'allay-tpl-lib-'));
  afterAll(() => rmSync(base, { recursive: true, force: true }));

  function fixture(name: string, code: string): string {
    const dir = join(base, name);
    mkdirSync(join(dir, 'src'), { recursive: true });
    writeFileSync(join(dir, 'src/index.ts'), code);
    return dir;
  }
  const rel = (from: string, to: string) => relative(from, to).split('\\').join('/');

  it('_lib 不是模板：templateDirs() 不列它，也不列 _ 开头的目录', () => {
    const dirs = templateDirs();
    expect(dirs.length).toBeGreaterThanOrEqual(6);
    expect(dirs.some((d) => d === TEMPLATES_LIB || relative(TEMPLATES_SRC, d).startsWith('_'))).toBe(false);
  });

  it('导入 _lib 的模板：打出来的单文件里有 _lib 的代码，没有任何 import', async () => {
    const dir = fixture('uses-lib', '');
    const lib = rel(join(dir, 'src'), join(TEMPLATES_LIB, 'src/timing'));
    writeFileSync(
      join(dir, 'src/index.ts'),
      `import { transitionWindows, progress } from '${lib}';\nexport default { setup(ctx: { stage: { fps: number } }) { const w = transitionWindows(ctx.stage.fps, 0.4, 0.2, 0.4); return { duration: w.duration, cutTime: w.cutTime, update(t: number) { progress(t, w.in); } }; } };\n`,
    );
    const code = await bundleTemplate(dir);
    expect(code).toContain('function transitionWindows');
    expect(code).not.toMatch(/^\s*import\s/m);
    // 没用到的函数不进产物
    expect(code).not.toContain('function overlayWindows');
  });

  it('够到别的模板目录的相对导入：构建失败，并指出是哪个导入', async () => {
    const dir = fixture('reaches-out', '');
    const other = rel(join(dir, 'src'), join(TEMPLATES_SRC, 'block-wipe/src/arrangement'));
    writeFileSync(join(dir, 'src/index.ts'), `import { arrangeCells } from '${other}';\nexport default { setup() { arrangeCells; return { duration: 1, update() {} }; } };\n`);
    await expect(bundleTemplate(dir)).rejects.toThrow(/leaves the template directory/);
  });
});
