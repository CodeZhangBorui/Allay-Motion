// 053 正在播放 allay.builtin.now-playing（docs/templates/now-playing.md）。叠加层：唱片机的“正在播放：……”。
// 两种样式：快捷栏上方的动作栏文字（可彩虹变色），或 1.21.6 起的音乐提示框。
// 只用公开的模板接口；布局按界面像素（一个界面像素 = guiScale 个设计单位），数值在 layout.ts。
import type { SetupContext, TemplateInstance, TemplateModule, TextObject } from '@allay/template-sdk';
import { overlayWindows, progress } from '../../_lib/src/timing';
import { fadeInOut } from '../../_lib/src/fade';
import { bool, createGui, firstTexture, fontOf, num, rgbOf, str, type Quads } from '../../_lib/src/gui-kit';
import {
  actionbarLayout,
  fitRow,
  rainbowColor,
  rainbowIndex,
  rainbowSteps,
  TEXT_H,
  TOAST_BORDER,
  TOAST_ICON_SIZE,
  TOAST_ICON_X,
  TOAST_ICON_Y,
  toastLayout,
  toastShown,
  toastX,
} from './layout';

/** 没有提示框贴图时面板的颜色（纯色块，不是原版的样子） */
const FALLBACK_PANEL = '#212121';

const template: TemplateModule = {
  async setup(ctx: SetupContext): Promise<TemplateInstance> {
    const { THREE, stage, params } = ctx;
    const G = Math.max(1, num(params.guiScale, 5));
    const win = overlayWindows(stage.fps, num(params.inDuration, 0.1), num(params.hold, 1.9), num(params.outDuration, 1));
    const track = str(params.track, '');
    const gui = createGui(ctx, G);
    gui.root.position.set(-stage.width / 2, stage.height / 2, 0);

    if (typeof params.sound === 'string') ctx.audio.cue(params.sound, 0, { gain: num(params.volume, 0.8) });

    if (params.style === 'toast') {
      // ---- 音乐提示框：只显示曲名 ----
      const anchor = params.anchor === 'topRight' ? 'topRight' : 'topLeft';
      const text: TextObject | null =
        track.trim() === '' ? null : ctx.text.create({ text: track, size: G, color: rgbOf(params.toastColor, '#FFFFFF'), align: 'left', font: fontOf(params.toastFont) });
      const layout = toastLayout(text ? text.width / G : 0);
      // 提示框比画面还宽时整体缩小，界面宽度相应变大
      const k = Math.min(1, stage.width / (layout.width * G));
      gui.root.scale.setScalar(k);
      const guiWidth = stage.width / (G * k);

      const toast = new THREE.Object3D();
      gui.put(toast, 0, 0);
      // 子物体的坐标以提示框左上角为原点
      const at = (obj: InstanceType<typeof THREE.Object3D>, gx: number, gy: number, z: number) => {
        obj.position.set(gx * G, -gy * G, z);
        toast.add(obj);
      };
      let plain: Quads | null = null;
      const panelTexture = await ctx.resources.texture('minecraft:gui/sprites/toast/now_playing', { optional: true });
      if (panelTexture) {
        // 测试用的假贴图没有 .mcmeta，九宫格的边在这里写明
        const panel = ctx.sprite.create(panelTexture, { nineSlice: [TOAST_BORDER, TOAST_BORDER, TOAST_BORDER, TOAST_BORDER], pixelSize: G });
        panel.setSize(layout.width * G, layout.height * G);
        at(panel.object, layout.width / 2, layout.height / 2, 0);
      } else {
        plain = gui.quads(1, null, 0);
        plain.rect(0, 0, 0, layout.width, layout.height);
        plain.color(0, FALLBACK_PANEL, 1);
        plain.commit();
        toast.add(plain.object);
      }
      const iconX = TOAST_ICON_X + TOAST_ICON_SIZE / 2;
      const iconY = TOAST_ICON_Y + TOAST_ICON_SIZE / 2;
      if (params.icon === 'disc') {
        const disc = (await ctx.resources.item(str(params.disc, 'minecraft:music_disc_cat'))).single();
        disc.scale.setScalar(TOAST_ICON_SIZE * G);
        at(disc, iconX, iconY, 2);
      } else {
        // 跳动的音符：贴图自带 8 帧动画，引擎按 t 播放。没有这张贴图时不画图标
        const notes = await firstTexture(ctx, ['minecraft:gui/sprites/icon/music_notes']);
        if (notes) {
          const icon = ctx.sprite.create(notes.texture, { pixelSize: G });
          icon.setSize(TOAST_ICON_SIZE * G, TOAST_ICON_SIZE * G);
          at(icon.object, iconX, iconY, 2);
        }
      }
      if (text) at(text.object, layout.textX, layout.textTop + TEXT_H / 2, 3);

      return {
        duration: win.duration,
        cutTime: null,
        update(t: number) {
          // 首末帧提示框整个在画外
          const shown = toastShown(progress(t, win.in), progress(t, win.out));
          toast.position.x = toastX(anchor, guiWidth, layout.width, shown) * G;
        },
        dispose() {
          plain?.dispose();
        },
      };
    }

    // ---- 动作栏文字：前缀 + 曲名 ----
    const line = str(params.prefix, '') + track;
    const { centerX, top } = actionbarLayout(stage.width / G, stage.height / G);
    const font = fontOf(params.font);
    const make = (color: string): TextObject => {
      const t = ctx.text.create({ text: line, size: G, color, align: 'center', font });
      // 放不下时这一行自己缩小，竖直中线不动（游戏里不缩，会出画）
      t.object.scale.setScalar(fitRow(t.width / G, stage.width / G));
      gui.put(t.object, centerX, top + TEXT_H / 2, 1);
      return t;
    };
    const steps = rainbowSteps(win.duration);
    // 一个文字对象只有一种颜色：彩虹的每一步各建一个，每一帧只显示当前那一个
    const texts: TextObject[] = [];
    if (line.trim() !== '') {
      if (bool(params.rainbow, true)) for (let i = 0; i < steps.count; i++) texts.push(make(rainbowColor(i, steps)));
      else texts.push(make(rgbOf(params.color, '#FFFFFF')));
    }

    return {
      duration: win.duration,
      cutTime: null,
      update(t: number) {
        const a = fadeInOut(t, win);
        const current = texts.length > 1 ? rainbowIndex(t, steps) : 0;
        for (let i = 0; i < texts.length; i++) {
          const on = i === current;
          texts[i]!.object.visible = on;
          texts[i]!.setOpacity(on ? a : 0);
        }
      },
    };
  },
};

export default template;
