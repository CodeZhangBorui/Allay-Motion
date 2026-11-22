// 039 Boss 栏 allay.builtin.boss-bar（docs/templates/boss-bar.md）。叠加层：屏幕顶部中央的 Boss 栏，名字在栏的上方。
// 只用公开的模板接口；布局按界面像素（一个界面像素 = guiScale 个设计单位），数值在 layout.ts。
import type { SetupContext, TemplateInstance, TemplateModule } from '@allay/template-sdk';
import { overlayWindows } from '../../_lib/src/timing';
import { fadeInOut } from '../../_lib/src/fade';
import { createGui, fontOf, linesOf, num, rgbOf, str, type Gui } from '../../_lib/src/gui-kit';
import {
  atlasColorRegion,
  atlasNotchRegion,
  BAR_H,
  BAR_W,
  barLayout,
  barStyles,
  filledWidth,
  fitUnit,
  MAX_BARS,
  PLAIN_COLORS,
  progressAt,
  SAME,
  SIDE_MARGIN,
  visibleBars,
  type BarColor,
  type BarStyle,
} from './layout';

type Texture = InstanceType<SetupContext['THREE']['Texture']>;

/** 把一条栏画到某个位置；三种画法（单张贴图、旧图集、纯色）各实现一份 */
interface Painter {
  /** 第 bar 条：上边 top，进度露出 px 个界面像素 */
  draw(bar: number, top: number, px: number): void;
  commit(): void;
  setOpacity(a: number): void;
  dispose(): void;
}

/** 1.20.2 起：每种颜色、每种刻度各是一张 182 × 5 的贴图。一张贴图一个批次，从下往上：底、底上的刻度、进度、进度上的刻度 */
function spritePainter(gui: Gui, x: number, count: number, bg: Texture, fg: Texture, notchBg: Texture | null, notchFg: Texture | null): Painter {
  const layers = [
    { quads: gui.quads(count, bg, 0), cropped: false },
    ...(notchBg ? [{ quads: gui.quads(count, notchBg, 0.4), cropped: false }] : []),
    { quads: gui.quads(count, fg, 0.8), cropped: true },
    ...(notchFg ? [{ quads: gui.quads(count, notchFg, 1.2), cropped: true }] : []),
  ];
  return {
    draw(bar, top, px) {
      for (const { quads, cropped } of layers) {
        const w = cropped ? px : BAR_W;
        if (w <= 0) {
          quads.hide(bar);
          continue;
        }
        quads.rect(bar, x, top, w, BAR_H);
        // 裁切而不是压扁：只取贴图左边的 w 个像素
        quads.uv(bar, 0, 0, w / BAR_W, 1);
      }
    },
    commit: () => layers.forEach((l) => l.quads.commit()),
    setOpacity: (a) => layers.forEach((l) => l.quads.setOpacity(a)),
    dispose: () => layers.forEach((l) => l.quads.dispose()),
  };
}

/** 1.20.2 之前：所有颜色和刻度都在图集 gui/bars 里。一个批次，每条栏四个矩形，按画的先后排 */
function atlasPainter(gui: Gui, x: number, count: number, atlas: Texture, color: BarColor, notches: number): Painter {
  const quads = gui.quads(count * 4, atlas, 0);
  return {
    draw(bar, top, px) {
      const parts = [
        { region: atlasColorRegion(color, 'background'), w: BAR_W },
        { region: atlasNotchRegion(notches, 'background'), w: BAR_W },
        { region: atlasColorRegion(color, 'progress', px), w: px },
        { region: atlasNotchRegion(notches, 'progress', px), w: px },
      ];
      parts.forEach(({ region, w }, k) => {
        const i = bar * 4 + k;
        if (!region || w <= 0) {
          quads.hide(i);
          return;
        }
        quads.rect(i, x, top, w, BAR_H);
        quads.region(i, region);
      });
    },
    commit: () => quads.commit(),
    setOpacity: (a) => quads.setOpacity(a),
    dispose: () => quads.dispose(),
  };
}

/** 没有贴图：深色的底和栏颜色的进度，两个纯色矩形；不画刻度 */
function plainPainter(gui: Gui, x: number, count: number, color: BarColor): Painter {
  const quads = gui.quads(count * 2, null, 0);
  const { fill, track } = PLAIN_COLORS[color];
  for (let bar = 0; bar < count; bar++) {
    quads.color(bar * 2, track);
    quads.color(bar * 2 + 1, fill);
  }
  return {
    draw(bar, top, px) {
      quads.rect(bar * 2, x, top, BAR_W, BAR_H);
      if (px > 0) quads.rect(bar * 2 + 1, x, top, px, BAR_H);
      else quads.hide(bar * 2 + 1);
    },
    commit: () => quads.commit(),
    setOpacity: (a) => quads.setOpacity(a),
    dispose: () => quads.dispose(),
  };
}

const template: TemplateModule = {
  async setup(ctx: SetupContext): Promise<TemplateInstance> {
    const { stage, params } = ctx;
    const inDuration = num(params.inDuration, 0.25);
    const hold = num(params.hold, 4);
    const outDuration = num(params.outDuration, 0.25);
    const win = overlayWindows(stage.fps, inDuration, hold, outDuration);

    // 界面宽度放不下一条栏时整体缩小（界面像素变小，版式不变）
    const G = fitUnit(stage.width, Math.max(1, num(params.guiScale, 5)));
    const guiW = stage.width / G;
    const guiH = stage.height / G;
    const gui = createGui(ctx, G);
    gui.root.position.set(-stage.width / 2, stage.height / 2, 0);

    // 一行名字一条栏；一行都没有时仍画一条没有名字的栏
    const names = linesOf(params.names, MAX_BARS);
    const count = visibleBars(guiH, Math.max(1, names.length));
    const layout = barLayout(guiW, count);

    // 每一条栏各有颜色和分段：第二条起的写 same（旧工程没有这几个参数时也是）就跟第一条一样
    const others = [2, 3, 4].map((k) => ({ color: str(params[`color${k}`], SAME), notches: str(params[`notches${k}`], SAME) }));
    const styles = barStyles(count, str(params.color, 'pink'), str(params.notches, 'none'), others);

    // 贴图：1.20.2 起的单张贴图 → 旧图集 → 纯色
    const sprite = (name: string) => ctx.resources.texture(`minecraft:gui/sprites/boss_bar/${name}`, { optional: true });
    let atlas: Texture | null | undefined;
    const painterFor = async ({ color, notches }: BarStyle, n: number): Promise<Painter> => {
      const bg = await sprite(`${color}_background`);
      const fg = bg ? await sprite(`${color}_progress`) : null;
      if (bg && fg) {
        const notchBg = notches > 0 ? await sprite(`notched_${notches}_background`) : null;
        const notchFg = notchBg ? await sprite(`notched_${notches}_progress`) : null;
        return spritePainter(gui, layout.x, n, bg, fg, notchFg ? notchBg : null, notchFg);
      }
      if (atlas === undefined) atlas = await ctx.resources.texture('minecraft:gui/bars', { optional: true });
      return atlas ? atlasPainter(gui, layout.x, n, atlas, color, notches) : plainPainter(gui, layout.x, n, color);
    };
    // 样子相同的栏共用一个画法（一个批次画几条），slots[i] 是第 i 条栏在哪个画法的第几格
    const byStyle = new Map<string, { style: BarStyle; bars: number[] }>();
    styles.forEach((style, bar) => {
      const key = `${style.color}|${style.notches}`;
      const group = byStyle.get(key) ?? { style, bars: [] };
      group.bars.push(bar);
      byStyle.set(key, group);
    });
    const painters: Painter[] = [];
    const slots: { painter: Painter; slot: number }[] = [];
    for (const { style, bars } of byStyle.values()) {
      const painter = await painterFor(style, bars.length);
      painters.push(painter);
      bars.forEach((bar, slot) => (slots[bar] = { painter, slot }));
    }

    // 名字：居中在栏的上方；比界面还宽时这一行自己缩小（游戏里不缩）
    const nameColor = rgbOf(params.nameColor, '#FFFFFF');
    const maxNameWidth = (guiW - 2 * SIDE_MARGIN) * G;
    const labels = names.slice(0, count).map((text, i) => {
      const t = ctx.text.create({ text, size: G, color: nameColor, align: 'center', font: fontOf(params.nameFont) });
      const k = Math.min(1, maxNameWidth / Math.max(1, t.width));
      t.object.scale.setScalar(k);
      // 缩小时保持这一行的下边不动（贴着栏）
      gui.put(t.object, layout.centerX, layout.nameTops[i]! + (t.height / G) * (1 - k / 2), 2);
      return t;
    });

    const from = num(params.from, 1);
    const to = num(params.to, 0.35);
    const changeAt = num(params.changeAt, 1);
    const changeDuration = num(params.changeDuration, 1);
    const holdStart = win.in.end;
    // 其余的栏进度不变，只摆一次
    const otherPx = filledWidth(num(params.otherProgress, 1));
    for (let i = 1; i < count; i++) slots[i]!.painter.draw(slots[i]!.slot, layout.barTops[i]!, otherPx);
    for (const p of painters) p.commit();
    const first = slots[0]!;

    if (typeof params.sound === 'string') ctx.audio.cue(params.sound, 0, { gain: num(params.volume, 0.8) });

    return {
      duration: win.duration,
      cutTime: null,
      update(t: number) {
        // 游戏里 Boss 栏是直接出现的；这里整体线性淡入淡出（时间窗首尾各让出一帧）
        const a = fadeInOut(t, win);
        first.painter.draw(first.slot, layout.barTops[0]!, filledWidth(progressAt(t - holdStart, from, to, changeAt, changeDuration)));
        first.painter.commit();
        for (const p of painters) p.setOpacity(a);
        for (const l of labels) l.setOpacity(a);
      },
      dispose() {
        for (const p of painters) p.dispose();
      },
    };
  },
};

export default template;
