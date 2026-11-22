// 038 标题命令 allay.builtin.title-command（docs/templates/title-command.md）。叠加层：/title 的标题、副标题和动作栏文字。
// 只用公开的模板接口；布局按界面像素（一个界面像素 = guiScale 个设计单位），数值在 layout.ts。
import type { SetupContext, TemplateInstance, TemplateModule } from '@allay/template-sdk';
import { overlayWindows } from '../../_lib/src/timing';
import { fadeInOut } from '../../_lib/src/fade';
import { bool, createGui, fontOf, num, rgbOf, str } from '../../_lib/src/gui-kit';
import { ACTIONBAR_FADE_TICKS, actionbarAlpha, BACKDROP_PAD, LINE_H, SUBTITLE_SCALE, TICK, TITLE_SCALE, titleLayout } from './layout';

const template: TemplateModule = {
  setup(ctx: SetupContext): TemplateInstance {
    const { stage, params } = ctx;
    const G = Math.max(1, num(params.guiScale, 4));
    const inDuration = num(params.inDuration, 0.5);
    const hold = num(params.hold, 3.5);
    const outDuration = num(params.outDuration, 1);
    const win = overlayWindows(stage.fps, inDuration, hold, outDuration);
    const backdrop = bool(params.textBackground, false);
    const backdropAlpha = num(params.backgroundOpacity, 0.5);
    // 两侧至少留 4 个界面像素；放不下的那一行自己缩小（游戏里不缩，会出画）
    const maxWidth = stage.width - 8 * G;

    const gui = createGui(ctx, G);
    gui.root.position.set(-stage.width / 2, stage.height / 2, 0);
    const layout = titleLayout(stage.width / G, stage.height / G);
    const plates = gui.quads(3, null, 0);
    for (let i = 0; i < 3; i++) plates.hide(i);

    interface Row {
      setOpacity(a: number): void;
    }
    /** 一行居中的文字：scale 是相对界面像素的倍数，top 是文字上边的界面坐标 */
    const row = (index: number, text: string, scale: number, top: number, color: string, fontKey: string): Row | null => {
      if (text.trim() === '') return null;
      const t = ctx.text.create({ text, size: G * scale, color, align: 'center', font: fontOf(params[fontKey]) });
      const k = Math.min(1, maxWidth / Math.max(1, t.width));
      t.object.scale.setScalar(k);
      // 缩小时保持这一行的竖直中线不动
      const lineH = (LINE_H - 1) * scale;
      const mid = top + lineH / 2;
      gui.put(t.object, layout.centerX, mid, 2);
      if (backdrop) {
        const halfW = (t.width * k) / G / 2 + BACKDROP_PAD * scale * k;
        const halfH = (lineH / 2 + BACKDROP_PAD * scale) * k;
        plates.rect(index, layout.centerX - halfW, mid - halfH, halfW * 2, halfH * 2);
      }
      return {
        setOpacity(a) {
          t.setOpacity(a);
          if (backdrop) plates.color(index, '#000000', a * backdropAlpha);
        },
      };
    };

    const title = row(0, str(params.title, ''), TITLE_SCALE, layout.titleTop, rgbOf(params.titleColor, '#FFFFFF'), 'titleFont');
    const subtitle = row(1, str(params.subtitle, ''), SUBTITLE_SCALE, layout.subtitleTop, rgbOf(params.subtitleColor, '#FFFFFF'), 'subtitleFont');
    const actionbar = row(2, str(params.actionbar, ''), 1, layout.actionbarTop, rgbOf(params.actionbarColor, '#FFFFFF'), 'actionbarFont');

    // 动作栏有自己的寿命（游戏里固定 60 刻，最后 20 刻淡出），不跟标题的三段时间走；不超过模板的时长
    const barStart = win.in.start;
    const barLife = Math.min(num(params.actionbarDuration, 3), win.out.end - barStart);
    const barFade = ACTIONBAR_FADE_TICKS * TICK;

    if (typeof params.sound === 'string') ctx.audio.cue(params.sound, 0, { gain: num(params.volume, 0.8) });

    return {
      duration: win.duration,
      cutTime: null,
      update(t: number) {
        // 淡入、停留、淡出都是线性的（_lib 的时间窗首尾各让出一帧）
        const a = fadeInOut(t, win);
        title?.setOpacity(a);
        subtitle?.setOpacity(a);
        actionbar?.setOpacity(t <= barStart ? 0 : actionbarAlpha(t - barStart, barLife, barFade));
        plates.commit();
      },
      dispose() {
        plates.dispose();
      },
    };
  },
};

export default template;
