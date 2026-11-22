// 055 声音字幕 allay.builtin.sound-subtitles（docs/templates/sound-subtitles.md）。叠加层：右下角的字幕框，一条声音一行，带方向箭头。
// 只用公开的模板接口；布局按界面像素，数值和时间公式在 layout.ts。
import type { SetupContext, TemplateInstance, TemplateModule, TextObject } from '@allay/template-sdk';
import { overlayWindows } from '../../_lib/src/timing';
import { fadeInOut } from '../../_lib/src/fade';
import { createGui, fontOf, linesOf, num } from '../../_lib/src/gui-kit';
import { fitUnit, GRAY_STEPS, grayHex, halfWidth, MAX_LINES, parseCaption, ROW_PITCH, rowRect, sampleCues, stepAt, stepGray, visibleAt } from './layout';

interface Row {
  /** 各级灰度的文字 */
  texts: TextObject[];
  /** 各级灰度的箭头；声源在正面时为空 */
  arrows: TextObject[];
  arrowLeft: boolean;
  /** 界面像素 */
  width: number;
}

const template: TemplateModule = {
  setup(ctx: SetupContext): TemplateInstance {
    const { stage, params } = ctx;
    const G = Math.max(1, num(params.guiScale, 5));
    const inDuration = num(params.inDuration, 0.2);
    const hold = num(params.hold, 5);
    const outDuration = num(params.outDuration, 0.2);
    const win = overlayWindows(stage.fps, inDuration, hold, outDuration);
    const interval = Math.max(0, num(params.interval, 0.8));
    const lifetime = Math.max(0.1, num(params.lifetime, 3));
    const bgOpacity = num(params.bgOpacity, 0.8);
    const side = params.side === 'left' ? 'left' : 'right';
    const font = fontOf(params.font);

    // 文字先按 guiScale 建好，量出以界面像素计的宽高（和字号成正比）；放不下时再整体缩小
    const make = (text: string, gray: number, align: 'left' | 'center') => ctx.text.create({ text, size: G, color: grayHex(gray), align, font });
    const captions = linesOf(params.lines, MAX_LINES)
      .map(parseCaption)
      .filter((c) => c.text !== '');
    const grays = Array.from({ length: GRAY_STEPS }, (_, s) => stepGray(s));
    const rows: Row[] = captions.map((c) => {
      const texts = grays.map((g) => make(c.text, g, 'center'));
      const arrows = c.direction === 'front' ? [] : grays.map((g) => make(c.direction === 'left' ? '<' : '>', g, 'left'));
      return { texts, arrows, arrowLeft: c.direction === 'left', width: texts[0]!.width / G };
    });
    const lt = make('<', 255, 'left');
    const gt = make('>', 255, 'left');
    const ltW = lt.width / G;
    const gtW = gt.width / G;
    // 单行高度：原版字体是 8（一条高 10）；更高的字体时一条跟着变高
    const oneLine = lt.height / G;
    const pitch = Math.max(ROW_PITCH, Math.ceil(oneLine - 1e-6) + 2);
    // 字在一条里竖直居中（原版字体：上边在这一条上边下方 1）
    const textDy = (pitch - oneLine) / 2;

    const widest = rows.reduce((m, r) => Math.max(m, r.width), 0);
    const unit = fitUnit(stage.width, stage.height, G, halfWidth(widest, ltW, gtW), rows.length, pitch);
    const k = unit / G;
    const gw = stage.width / unit;
    const gh = stage.height / unit;
    const gui = createGui(ctx, unit);
    gui.root.position.set(-stage.width / 2, stage.height / 2, 0);
    for (const r of rows) {
      for (const t of [...r.texts, ...r.arrows]) {
        t.object.scale.setScalar(k);
        t.object.visible = false;
        gui.put(t.object, 0, 0, 2);
      }
    }
    const textH = oneLine * unit;

    const plates = gui.quads(Math.max(1, rows.length), null, 0);
    for (let i = 0; i < rows.length; i++) plates.hide(i);

    if (typeof params.sound === 'string') {
      const gain = num(params.volume, 0.8);
      const times = rows.map((_, i) => i * interval).filter((at) => at < win.duration);
      for (const at of sampleCues(times)) ctx.audio.cue(params.sound, at, { gain });
    }

    return {
      duration: win.duration,
      cutTime: null,
      update(t: number) {
        // 整体的淡入淡出（游戏里字幕是直接出现的）；首尾各让出一帧
        const g = fadeInOut(t, win);
        for (const r of rows) {
          for (const o of r.texts) o.object.visible = false;
          for (const o of r.arrows) o.object.visible = false;
        }
        const slots = g > 0 ? visibleAt(t, rows.length, interval, lifetime) : [];
        // 框的宽度按此刻还在显示的字幕里最宽的一条算（游戏里每帧重算）
        let maxW = 0;
        for (const s of slots) maxW = Math.max(maxW, rows[s.index]!.width);
        const half = halfWidth(maxW, ltW, gtW);
        let q = 0;
        for (const s of slots) {
          const r = rows[s.index]!;
          const rect = rowRect(gw, gh, half, s.row, gtW, side, pitch);
          const step = stepAt(s.fraction);
          const y = -(rect.y + textDy) * unit - textH / 2;
          const text = r.texts[step]!;
          text.object.visible = true;
          text.object.position.set(rect.cx * unit, y, 2);
          text.setOpacity(g);
          const arrow = r.arrows[step];
          if (arrow) {
            arrow.object.visible = true;
            arrow.object.position.set((r.arrowLeft ? rect.ltX : rect.gtX) * unit, y, 2);
            arrow.setOpacity(g);
          }
          plates.rect(q, rect.x, rect.y, rect.w, rect.h);
          plates.color(q, '#000000', bgOpacity * g);
          q++;
        }
        for (; q < rows.length; q++) plates.hide(q);
        plates.commit();
      },
      dispose() {
        plates.dispose();
      },
    };
  },
};

export default template;
