// 内置模板共用的源码 packages/templates/_lib（docs/04-templates.md 4.9、docs/template-catalog.md P1）：
// 时间余量、界面像素布局、闭式粒子、界面类模板的小工具（gui-kit）、整体淡入淡出、进度条、音效抽样的函数本身，
// 以及构建脚本对 _lib 的处理（能并进产物、别处的相对导入被拒绝）。gui-kit 要 THREE 的部分用真实的 three（不碰 WebGL）和一个假的 ctx。
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import type { FontStyle, SetupContext, TextOptions } from '../../packages/template-sdk/src/index';
import { filledWidth, fitUnit } from '../../packages/templates/_lib/src/bar';
import { MAX_CUES, sampleCues, sampleIndices } from '../../packages/templates/_lib/src/cues';
import { fadeInOut } from '../../packages/templates/_lib/src/fade';
import { anchorTopLeft, fitScale, guiLayout } from '../../packages/templates/_lib/src/gui';
import { alphaOf, bool, CHAT_COLORS, createGui, firstTexture, fontOf, linesOf, num, parseFormatted, plainText, rgbOf, richText, str, type Quads } from '../../packages/templates/_lib/src/gui-kit';
import { ageAt, ballistic, dragFromTickFriction, dragged, frameAt } from '../../packages/templates/_lib/src/particles';
import { eased, overlayWindows, progress, transitionWindows } from '../../packages/templates/_lib/src/timing';
import { bundleTemplate, templateDirs, TEMPLATES_LIB, TEMPLATES_SRC } from '../../scripts/build-templates';

const ROOT = resolve(import.meta.dirname, '../..');
// three 是引擎的依赖（根目录没有）：从引擎包解析
const THREE = (await import(pathToFileURL(createRequire(new URL('../../packages/engine/package.json', import.meta.url)).resolve('three')).href)) as SetupContext['THREE'];
type Three = SetupContext['THREE'];
type Mesh = InstanceType<Three['Mesh']>;
type MeshBasicMaterial = InstanceType<Three['MeshBasicMaterial']>;
type BufferAttribute = InstanceType<Three['BufferAttribute']>;

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

/** 假字体的文字对象：每个字 6 个字体像素宽、9 高；宽度不含行尾空格（和引擎的文字对象一样） */
interface FakeText {
  opts: TextOptions;
  object: InstanceType<Three['Object3D']>;
  width: number;
  height: number;
  opacity: number;
  setOpacity(a: number): void;
}

/** gui-kit 用到的那部分 ctx：场景、可选贴图（have 里列出的才有）、文字 */
function fakeCtx(have: readonly string[] = []) {
  const scene = new THREE.Scene();
  const requested: { id: string; optional: boolean }[] = [];
  const texts: FakeText[] = [];
  const ctx = {
    THREE,
    scene,
    resources: {
      texture: async (id: string, opts?: { optional?: boolean }) => {
        requested.push({ id, optional: opts?.optional === true });
        return have.includes(id) ? new THREE.Texture() : null;
      },
    },
    text: {
      create: (opts: TextOptions): FakeText => {
        const t: FakeText = {
          opts,
          object: new THREE.Object3D(),
          width: opts.text.replace(/ +$/, '').length * 6 * opts.size,
          height: 9 * opts.size,
          opacity: 1,
          setOpacity: (a) => void (t.opacity = a),
        };
        texts.push(t);
        return t;
      },
    },
  };
  return { ctx: ctx as unknown as SetupContext, scene, requested, texts };
}

const PLAIN = { color: '#FFFFFF', bold: false, italic: false, underline: false, strikethrough: false };
const DEFAULT_FONT: FontStyle = { family: 'minecraft:default' };

describe('T-TPL-LIB-5 界面小工具：参数读取', () => {
  it('数、字符串、开关：类型不对（数还要是有限数）时取默认值', () => {
    expect(num(3, 1)).toBe(3);
    expect(num(-0.5, 1)).toBe(-0.5);
    expect(num(Number.NaN, 1)).toBe(1);
    expect(num(Number.POSITIVE_INFINITY, 1)).toBe(1);
    expect(num('3', 1)).toBe(1);
    expect(num(undefined, 2)).toBe(2);
    expect(str('a', 'b')).toBe('a');
    expect(str('', 'b')).toBe('');
    expect(str(1, 'b')).toBe('b');
    expect(str(null, 'b')).toBe('b');
    expect(bool(false, true)).toBe(false);
    expect(bool('true', false)).toBe(false);
    expect(bool(undefined, true)).toBe(true);
  });

  it('字体：带 family 的对象原样取用（样式、描边都在里面），别的一律退回 minecraft:default', () => {
    const font = { family: 'embedded:default', bold: true, shadow: false, outline: null };
    expect(fontOf(font)).toBe(font);
    expect(fontOf({ bold: true })).toEqual(DEFAULT_FONT);
    expect(fontOf({ family: 3 })).toEqual(DEFAULT_FONT);
    expect(fontOf([{ family: 'minecraft:default' }])).toEqual(DEFAULT_FONT);
    expect(fontOf('embedded:default')).toEqual(DEFAULT_FONT);
    expect(fontOf(null)).toEqual(DEFAULT_FONT);
    expect(fontOf(undefined)).toEqual(DEFAULT_FONT);
  });

  it('颜色：rgbOf 取 #RRGGBB（有 alpha 位时丢掉），alphaOf 取 #RRGGBBAA 的 alpha，没有 alpha 位时是 1', () => {
    expect(rgbOf('#12abEF', '#000000')).toBe('#12abEF');
    expect(rgbOf('#FF000080', '#000000')).toBe('#FF0000');
    expect(rgbOf('#FFF', '#000000')).toBe('#000000');
    expect(rgbOf('red', '#000000')).toBe('#000000');
    expect(rgbOf(0xff0000, '#123456')).toBe('#123456');
    expect(alphaOf('#FF000080')).toBeCloseTo(128 / 255, 10);
    expect(alphaOf('#ff0000FF')).toBe(1);
    expect(alphaOf('#FF000000')).toBe(0);
    expect(alphaOf('#FF0000')).toBe(1);
    expect(alphaOf('#FF0000800')).toBe(1);
    expect(alphaOf(undefined)).toBe(1);
  });

  it('多行文字：去掉行尾空白（含 \\r）和空行，行首空白保留，最多取 max 行', () => {
    expect(linesOf('a  \n\n  b\r\n \t \nc', 10)).toEqual(['a', '  b', 'c']);
    expect(linesOf('a\nb\nc', 2)).toEqual(['a', 'b']);
    expect(linesOf('', 3)).toEqual([]);
    expect(linesOf(42, 3)).toEqual([]);
  });
});

describe('T-TPL-LIB-6 界面小工具：可选贴图的先后', () => {
  it('按给的顺序一个个试（都是可选贴图），返回第一个有的和它的序号，后面的不再取', async () => {
    const both = fakeCtx(['minecraft:old', 'minecraft:new']);
    const r = await firstTexture(both.ctx, ['minecraft:new', 'minecraft:old']);
    expect(r?.index).toBe(0);
    expect(r?.texture.isTexture).toBe(true);
    expect(both.requested).toEqual([{ id: 'minecraft:new', optional: true }]);

    const old = fakeCtx(['minecraft:old']);
    expect((await firstTexture(old.ctx, ['minecraft:new', 'minecraft:old', 'minecraft:older']))?.index).toBe(1);
    expect(old.requested.map((q) => q.id)).toEqual(['minecraft:new', 'minecraft:old']);
  });

  it('都没有时是 null（每个都试过）；空列表也是 null', async () => {
    const none = fakeCtx();
    expect(await firstTexture(none.ctx, ['minecraft:a', 'minecraft:b'])).toBeNull();
    expect(none.requested).toEqual([
      { id: 'minecraft:a', optional: true },
      { id: 'minecraft:b', optional: true },
    ]);
    expect(await firstTexture(none.ctx, [])).toBeNull();
  });
});

describe('T-TPL-LIB-7 界面小工具：格式码', () => {
  it('没有格式码：一段，样式就是 base；空串没有段', () => {
    expect(parseFormatted('Hello', PLAIN)).toEqual([{ ...PLAIN, text: 'Hello' }]);
    expect(parseFormatted('', PLAIN)).toEqual([]);
  });

  it('颜色码换颜色并清掉样式；l、o、n、m 叠加样式；r 回到 base；k（乱码字）不支持，忽略', () => {
    expect(parseFormatted('§cRed§lBold§aGreen§r end', PLAIN)).toEqual([
      { ...PLAIN, text: 'Red', color: '#FF5555' },
      { ...PLAIN, text: 'Bold', color: '#FF5555', bold: true },
      { ...PLAIN, text: 'Green', color: '#55FF55' },
      { ...PLAIN, text: ' end' },
    ]);
    expect(parseFormatted('§l§o§n§mx', PLAIN)).toEqual([{ ...PLAIN, text: 'x', bold: true, italic: true, underline: true, strikethrough: true }]);
    expect(parseFormatted('§kab', PLAIN)).toEqual([{ ...PLAIN, text: 'ab' }]);
  });

  it('样式连续叠加时前面的段不受后面的影响，base 本身不被改动', () => {
    const base = { ...PLAIN };
    expect(parseFormatted('§lA§oB', base)).toEqual([
      { ...PLAIN, text: 'A', bold: true },
      { ...PLAIN, text: 'B', bold: true, italic: true },
    ]);
    expect(base).toEqual(PLAIN);
  });

  it('§r 回到 base 自己的颜色和样式；颜色码不管 base 是什么，样式一律清掉', () => {
    const base = { ...PLAIN, color: '#FFFF55', bold: true };
    expect(parseFormatted('a§cb§rc', base)).toEqual([
      { ...base, text: 'a' },
      { ...PLAIN, text: 'b', color: '#FF5555' },
      { ...base, text: 'c' },
    ]);
  });

  it('& 也是格式码，但后面要跟合法的码，否则当普通字符；码不分大小写；行尾单独一个 § 丢掉', () => {
    expect(parseFormatted('&6Gold & Co&z', PLAIN)).toEqual([{ ...PLAIN, text: 'Gold & Co&z', color: '#FFAA00' }]);
    expect(parseFormatted('§AGreen&E!', PLAIN)).toEqual([
      { ...PLAIN, text: 'Green', color: '#55FF55' },
      { ...PLAIN, text: '!', color: '#FFFF55' },
    ]);
    expect(parseFormatted('end§', PLAIN)).toEqual([{ ...PLAIN, text: 'end' }]);
  });

  it('16 种颜色（§0–§f）', () => {
    expect(Object.keys(CHAT_COLORS).sort().join('')).toBe('0123456789abcdef');
    expect([CHAT_COLORS['0'], CHAT_COLORS['6'], CHAT_COLORS['9'], CHAT_COLORS.f]).toEqual(['#000000', '#FFAA00', '#5555FF', '#FFFFFF']);
  });

  it('plainText：去掉格式码后的纯文字', () => {
    expect(plainText('§6[§eServer§6] &aHi')).toBe('[Server] Hi');
    expect(plainText('a & b')).toBe('a & b');
  });
});

describe('T-TPL-LIB-8 界面小工具：多色文字的分段', () => {
  it('每段一个左对齐的文字对象，从左往右按宽度拼；宽是总宽，高取最高的一段', () => {
    const f = fakeCtx();
    const r = richText(f.ctx, parseFormatted('§cAB§aCDE', PLAIN), 2, DEFAULT_FONT, true);
    expect(f.texts.map((t) => [t.opts.text, t.opts.color, t.opts.align, t.opts.size])).toEqual([
      ['AB', '#FF5555', 'left', 2],
      ['CDE', '#55FF55', 'left', 2],
    ]);
    expect(f.texts.map((t) => t.object.position.x)).toEqual([0, 24]);
    expect(f.texts.every((t) => t.object.parent === r.object)).toBe(true);
    expect([r.width, r.height]).toEqual([60, 18]);
  });

  it('行尾空格按每个 4 个字体像素补上；只有空格的一段不算文字对象的宽度', () => {
    const f = fakeCtx();
    const r = richText(f.ctx, parseFormatted('A  §c  §aB', PLAIN), 1, DEFAULT_FONT, false);
    // 'A  '：6 + 2 × 4；'  '：0 + 2 × 4；'B'：6
    expect(f.texts.map((t) => t.object.position.x)).toEqual([0, 14, 22]);
    expect(r.width).toBe(28);
  });

  it('粗体段的行尾空格每个 5 个字体像素（粗体的每个字多前进 1，和引擎排一整行粗体字时一样）', () => {
    const f = fakeCtx();
    richText(f.ctx, parseFormatted('§lA §rB', PLAIN), 1, DEFAULT_FONT, false);
    expect(f.texts.map((t) => t.object.position.x)).toEqual([0, 11]);
    // 字体参数是粗体时整行都按粗体
    const g = fakeCtx();
    const r = richText(g.ctx, parseFormatted('A  §c  §aB', PLAIN), 1, { family: 'minecraft:default', bold: true }, false);
    expect(g.texts.map((t) => t.object.position.x)).toEqual([0, 16, 26]);
    expect(r.width).toBe(32);
  });

  it('字体参数里打开的样式优先，格式码只能再加；阴影按字体参数，它没写时才用 shadow 参数', () => {
    const f = fakeCtx();
    richText(f.ctx, parseFormatted('a§lb', PLAIN), 1, { family: 'embedded:default', italic: true, outline: '#000000' }, true);
    const common = { family: 'embedded:default', italic: true, outline: '#000000', underline: false, strikethrough: false, shadow: true };
    expect(f.texts.map((t) => t.opts.font)).toEqual([
      { ...common, bold: false },
      { ...common, bold: true },
    ]);
    const g = fakeCtx();
    richText(g.ctx, parseFormatted('x', PLAIN), 1, { family: 'minecraft:default', bold: false, shadow: false }, true);
    expect(g.texts[0]!.opts.font).toMatchObject({ bold: false, shadow: false });
  });

  it('setOpacity 作用到每一段；没有段时宽高为 0', () => {
    const f = fakeCtx();
    const r = richText(f.ctx, parseFormatted('§ca§bb', PLAIN), 1, DEFAULT_FONT, true);
    r.setOpacity(0.25);
    expect(f.texts.map((t) => t.opacity)).toEqual([0.25, 0.25]);
    const empty = richText(fakeCtx().ctx, [], 1, DEFAULT_FONT, true);
    expect([empty.width, empty.height, empty.object.children.length]).toEqual([0, 0, 0]);
  });
});

describe('T-TPL-LIB-9 界面小工具：界面坐标与成批的矩形', () => {
  const geometryOf = (q: Quads) => (q.object as Mesh).geometry;
  const attr = (q: Quads, name: 'position' | 'color' | 'uv') => geometryOf(q).getAttribute(name) as BufferAttribute;
  const values = (q: Quads, name: 'position' | 'color' | 'uv', from = 0, to?: number) => Array.from(attr(q, name).array.slice(from, to));

  it('root 挂在场景上；put 按界面像素摆（原点在左上角、y 向下）；putText 让文字的上边对到 gy', () => {
    const f = fakeCtx();
    const gui = createGui(f.ctx, 4);
    expect(gui.root.parent).toBe(f.scene);
    expect(gui.unit).toBe(4);
    const o = new THREE.Object3D();
    gui.put(o, 10, 5, 2);
    expect(o.parent).toBe(gui.root);
    expect(o.position.toArray()).toEqual([40, -20, 2]);
    // 文字对象的原点在中线：上边在 gy 时，中线再往下半个字高（36 / 2）
    const t = f.ctx.text.create({ text: 'Hi', size: 4 });
    gui.putText(t, 10, 5);
    expect(t.object.parent).toBe(gui.root);
    expect(t.object.position.toArray()).toEqual([40, -38, 0]);
  });

  it('一批是一个 Mesh：开始时全部隐藏、白色不透明、取整张贴图；两个三角形一个矩形；至少一个矩形', () => {
    const f = fakeCtx();
    const gui = createGui(f.ctx, 2);
    const texture = new THREE.Texture();
    const q = gui.quads(3, texture, 1.5);
    const mesh = q.object as Mesh;
    expect(mesh.parent).toBe(gui.root);
    expect(mesh.position.z).toBe(1.5);
    expect(mesh.frustumCulled).toBe(false);
    const material = mesh.material as MeshBasicMaterial;
    expect(material.map).toBe(texture);
    expect([material.vertexColors, material.transparent, material.depthWrite]).toEqual([true, true, false]);
    expect([attr(q, 'position').itemSize, attr(q, 'color').itemSize, attr(q, 'uv').itemSize]).toEqual([3, 4, 2]);
    expect(values(q, 'position')).toEqual(Array<number>(36).fill(0));
    expect(values(q, 'color')).toEqual(Array<number>(48).fill(1));
    expect(values(q, 'uv')).toEqual(Array.from({ length: 3 }, () => [0, 1, 0, 0, 1, 0, 1, 1]).flat());
    expect(Array.from(geometryOf(q).getIndex()!.array)).toEqual([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7, 8, 9, 10, 8, 10, 11]);

    const plain = gui.quads(0, null);
    expect(attr(plain, 'position').count).toBe(4);
    expect(((plain.object as Mesh).material as MeshBasicMaterial).map).toBeNull();
  });

  it('rect：左上角 (gx, gy)、宽高 (gw, gh) 换成设计单位，顶点依次是左上、左下、右下、右上；hide 压成一个点；commit 才标记上传', () => {
    const q = createGui(fakeCtx().ctx, 2).quads(2, null);
    const version = attr(q, 'position').version;
    q.rect(1, 10, 5, 3, 2);
    expect(attr(q, 'position').version).toBe(version);
    q.commit();
    expect(attr(q, 'position').version).toBe(version + 1);
    expect(values(q, 'position', 12, 24)).toEqual([20, -10, 0, 20, -14, 0, 26, -14, 0, 26, -10, 0]);
    expect(values(q, 'position', 0, 12)).toEqual(Array<number>(12).fill(0));
    q.hide(1);
    expect(values(q, 'position', 12, 24)).toEqual(Array<number>(12).fill(0));
  });

  it('color：四个顶点同一个颜色（照 three 的 Color 换算）和不透明度，不透明度默认 1', () => {
    const q = createGui(fakeCtx().ctx, 1).quads(3, null);
    const version = attr(q, 'color').version;
    q.color(0, '#FF0000', 0.5);
    q.color(1, '#808080');
    q.commit();
    expect(attr(q, 'color').version).toBe(version + 1);
    expect(values(q, 'color', 0, 16)).toEqual([1, 0, 0, 0.5, 1, 0, 0, 0.5, 1, 0, 0, 0.5, 1, 0, 0, 0.5]);
    const gray = new THREE.Color('#808080');
    expect(values(q, 'color', 16, 32)).toEqual(Array.from({ length: 4 }, () => [gray.r, gray.g, gray.b, 1].map(Math.fround)).flat());
    expect(values(q, 'color', 32, 48)).toEqual(Array<number>(16).fill(1));
  });

  it('region：图集里的一块（图集像素，图集边长默认 256）换成贴图坐标；uv 直接给 0–1；两者都立刻标记上传', () => {
    const q = createGui(fakeCtx().ctx, 1).quads(2, new THREE.Texture());
    const version = attr(q, 'uv').version;
    // gui/icons 里经验条的底；顶点依次是左上、左下、右下、右上，three 的 v 向上
    q.region(0, [0, 64, 182, 5]);
    expect(attr(q, 'uv').version).toBe(version + 1);
    expect(values(q, 'uv', 0, 8)).toEqual([0, 1 - 64 / 256, 0, 1 - 69 / 256, 182 / 256, 1 - 69 / 256, 182 / 256, 1 - 64 / 256]);
    // 64 × 64 的经验球贴图里第 2 格
    q.region(1, [16, 0, 16, 16], 64);
    expect(values(q, 'uv', 8, 16)).toEqual([0.25, 1, 0.25, 0.75, 0.5, 0.75, 0.5, 1]);
    q.uv(1, 0, 0, 0.5, 1);
    expect(attr(q, 'uv').version).toBe(version + 3);
    expect(values(q, 'uv', 8, 16)).toEqual([0, 1, 0, 0, 0.5, 0, 0.5, 1]);
  });

  it('setOpacity 截到 0–1（不是有限数时为 0）；dispose 释放几何体和材质', () => {
    const q = createGui(fakeCtx().ctx, 1).quads(1, null);
    const material = (q.object as Mesh).material as MeshBasicMaterial;
    q.setOpacity(0.3);
    expect(material.opacity).toBeCloseTo(0.3, 10);
    q.setOpacity(2);
    expect(material.opacity).toBe(1);
    q.setOpacity(-1);
    expect(material.opacity).toBe(0);
    q.setOpacity(Number.NaN);
    expect(material.opacity).toBe(0);
    const disposed: string[] = [];
    geometryOf(q).addEventListener('dispose', () => disposed.push('geometry'));
    material.addEventListener('dispose', () => disposed.push('material'));
    q.dispose();
    expect(disposed.sort()).toEqual(['geometry', 'material']);
  });
});

describe('T-TPL-LIB-10 整体淡入淡出', () => {
  it('进入阶段从 0 线性升到 1、退出阶段降回 0；首末帧和各自让出的一帧里精确是 0，停留阶段精确是 1', () => {
    const w = overlayWindows(60, 0.25, 4, 0.25);
    for (const t of [0, 1 / 120, 1 / 60, w.duration - 1 / 60, w.duration - 1 / 120, w.duration]) expect(fadeInOut(t, w)).toBe(0);
    for (const t of [w.in.end, 2, w.out.start]) expect(fadeInOut(t, w)).toBe(1);
    expect(fadeInOut((w.in.start + w.in.end) / 2, w)).toBeCloseTo(0.5, 10);
    expect(fadeInOut((w.out.start + w.out.end) / 2, w)).toBeCloseTo(0.5, 10);
  });

  it('就是“进入进度 × (1 − 退出进度)”：与模板里原来内联的写法逐值相同；转场的时间窗也能用', () => {
    const w = overlayWindows(30, 0.2, 1, 0.3);
    for (let i = 0; i <= 900; i++) {
      const t = (i / 900) * w.duration;
      expect(fadeInOut(t, w)).toBe(progress(t, w.in) * (1 - progress(t, w.out)));
    }
    const tw = transitionWindows(30, 0.5, 0.2, 0.5);
    expect(fadeInOut(tw.cutTime, tw)).toBe(1);
    expect(fadeInOut(0, tw)).toBe(0);
  });
});

describe('T-TPL-LIB-11 进度条按像素裁切', () => {
  it('atLeastOne（Boss 栏）：0 不画，大于 0 至少 1 像素，满是 width；中间单调、每次最多涨 1', () => {
    expect(filledWidth(0, 182, 'atLeastOne')).toBe(0);
    expect(filledWidth(1e-9, 182, 'atLeastOne')).toBe(1);
    expect(filledWidth(0.5, 182, 'atLeastOne')).toBe(91);
    expect(filledWidth(1, 182, 'atLeastOne')).toBe(182);
    expect(filledWidth(10, 10, 'atLeastOne')).toBe(10);
    let prev = 0;
    for (let i = 0; i <= 2000; i++) {
      const px = filledWidth(i / 2000, 182, 'atLeastOne');
      expect(px - prev).toBeGreaterThanOrEqual(0);
      expect(px - prev).toBeLessThanOrEqual(1);
      prev = px;
    }
  });

  it('floor（经验条）：⌊进度 × (width + 1)⌋，不超过 width', () => {
    expect(filledWidth(0.005, 182, 'floor')).toBe(0);
    expect(filledWidth(1.5 / 183, 182, 'floor')).toBe(1);
    expect(filledWidth(0.5, 182, 'floor')).toBe(91);
    expect(filledWidth(0.99, 182, 'floor')).toBe(181);
    expect(filledWidth(1, 182, 'floor')).toBe(182);
    expect(filledWidth(0.5, 9, 'floor')).toBe(5);
  });

  it('进度超出 0–1 时截到两端，不是有限数时当 0', () => {
    for (const rounding of ['atLeastOne', 'floor'] as const) {
      expect(filledWidth(-1, 182, rounding)).toBe(0);
      expect(filledWidth(3, 182, rounding)).toBe(182);
      expect(filledWidth(Number.NaN, 182, rounding)).toBe(0);
      expect(filledWidth(Number.POSITIVE_INFINITY, 182, rounding)).toBe(0);
    }
  });

  it('fitUnit：放得下（宽度加两侧边距）时不缩，放不下时缩到正好放下，只看宽度，不小于 0.1', () => {
    // 宽 1080 的竖屏、界面缩放 5：216 个界面像素放得下 182 + 2 × 4
    expect(fitUnit(1080, 5, 182, 4)).toBe(5);
    // 界面缩放 8：135 放不下，缩到 190 个界面像素正好铺满
    expect(fitUnit(1080, 8, 182, 4)).toBeCloseTo(1080 / 190, 12);
    expect(1080 / fitUnit(1080, 8, 182, 4)).toBeCloseTo(190, 9);
    expect(fitUnit(1080, 8, 182)).toBeCloseTo(1080 / 182, 12);
    expect(fitUnit(10, 5, 182, 4)).toBe(0.1);
  });
});

describe('T-TPL-LIB-12 音效抽样：同一种声音最多 12 个 cue', () => {
  it('不超过 12 个时全取；多了均匀抽 12 个：含首尾、从小到大、不重复', () => {
    expect(MAX_CUES).toBe(12);
    expect(sampleIndices(0)).toEqual([]);
    expect(sampleIndices(5)).toEqual([0, 1, 2, 3, 4]);
    expect(sampleIndices(12)).toEqual(Array.from({ length: 12 }, (_, i) => i));
    expect(sampleIndices(23)).toEqual([0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22]);
    for (const n of [13, 40, 1000]) {
      const s = sampleIndices(n);
      expect(s).toHaveLength(12);
      expect([s[0], s[11]]).toEqual([0, n - 1]);
      for (let i = 1; i < s.length; i++) expect(s[i]!).toBeGreaterThan(s[i - 1]!);
    }
  });

  it('上限可以改；只取 1 个时取第一个，上限为 0 时一个都不取', () => {
    expect(sampleIndices(10, 4)).toEqual([0, 3, 6, 9]);
    expect(sampleIndices(10, 1)).toEqual([0]);
    expect(sampleIndices(1, 1)).toEqual([0]);
    expect(sampleIndices(10, 0)).toEqual([]);
  });

  it('sampleCues 取的是时刻本身，抽法同 sampleIndices；返回新数组，不改原数组', () => {
    const times = Array.from({ length: 30 }, (_, i) => i * 0.5);
    expect(sampleCues(times)).toEqual(sampleIndices(30).map((i) => i * 0.5));
    expect(sampleCues([1, 2, 3], 2)).toEqual([1, 3]);
    const few = [0.2, 0.4];
    const copy = sampleCues(few);
    expect(copy).toEqual(few);
    expect(copy).not.toBe(few);
    expect(sampleCues([])).toEqual([]);
  });
});
