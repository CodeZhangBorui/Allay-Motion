// 045 物品提示框 allay.builtin.item-tooltip（docs/templates/item-tooltip.md）。叠加层：鼠标停在物品上时的深色提示框。
// 只用公开的模板接口；布局按界面像素（一个界面像素 = guiScale 个设计单位），数值在 layout.ts。
import type { SetupContext, TemplateInstance, TemplateModule } from '@allay/template-sdk';
import { anchorTopLeft, type Anchor } from '../../_lib/src/gui';
import { overlayWindows } from '../../_lib/src/timing';
import { fadeInOut } from '../../_lib/src/fade';
import { bool, createGui, fontOf, num, parseFormatted, richText, str, type Quads, type RichText, type Segment } from '../../_lib/src/gui-kit';
import {
  CLASSIC_BACKGROUND,
  CLASSIC_BACKGROUND_ALPHA,
  CLASSIC_BORDER_ALPHA,
  CLASSIC_BORDER_BOTTOM,
  CLASSIC_BORDER_TOP,
  classicBackground,
  classicBorder,
  driftOffset,
  followOffset,
  followStops,
  gradientSlice,
  groupLayout,
  ITEM_SIZE,
  lineTop,
  LORE_COLOR,
  loreLines,
  PLAIN_COLOR,
  RARITY_COLORS,
  SPRITE_BACKGROUND_BORDER,
  SPRITE_FRAME_BORDER,
  spriteBox,
  textHeight,
} from './layout';


const ANCHORS: readonly Anchor[] = ['topLeft', 'top', 'topRight', 'left', 'center', 'right', 'bottomLeft', 'bottom', 'bottomRight'];
const BACKGROUND_SPRITE = 'minecraft:gui/sprites/tooltip/background';
const FRAME_SPRITE = 'minecraft:gui/sprites/tooltip/frame';
/** 原版字体里空格的宽度：行首的空格不建文字对象，直接把这一行往右挪 */
const SPACE_W = 4;

const template: TemplateModule = {
  async setup(ctx: SetupContext): Promise<TemplateInstance> {
    const { stage, params } = ctx;
    const G = Math.max(1, num(params.guiScale, 5));
    const inDuration = num(params.inDuration, 0.2);
    const hold = num(params.hold, 3);
    const outDuration = num(params.outDuration, 0.2);
    const win = overlayWindows(stage.fps, inDuration, hold, outDuration);
    const anchor: Anchor = ANCHORS.find((a) => a === params.anchor) ?? 'center';
    const motion = params.motion === 'drift' || params.motion === 'follow' ? params.motion : 'static';

    const gui = createGui(ctx, G);

    // 各行文字：第一行是名字（稀有度的颜色），后面是说明。空行只占位置，不建文字对象
    const plain = { bold: false, italic: false, underline: false, strikethrough: false };
    const nameBase: Omit<Segment, 'text'> = { ...plain, color: RARITY_COLORS[str(params.rarity, 'common')] ?? RARITY_COLORS.common! };
    const loreBase: Omit<Segment, 'text'> = params.loreStyle === 'plain' ? { ...plain, color: PLAIN_COLOR } : { ...plain, color: LORE_COLOR, italic: true };
    const nameFont = fontOf(params.nameFont);
    const loreFont = fontOf(params.loreFont);
    const sources = [str(params.name, '').replace(/\s+$/, ''), ...loreLines(str(params.lore, ''))];
    const lines: { text: RichText; indent: number; index: number }[] = [];
    let tw = 0;
    sources.forEach((source, index) => {
      const body = source.replace(/^ +/, '');
      const segments = parseFormatted(body, index === 0 ? nameBase : loreBase);
      if (!segments.some((s) => s.text.trim() !== '')) return;
      const indent = (source.length - body.length) * SPACE_W;
      const text = richText(ctx, segments, G, index === 0 ? nameFont : loreFont, true);
      lines.push({ text, indent, index });
      tw = Math.max(tw, indent + text.width / G);
    });
    tw = Math.ceil(tw);
    const hasTip = lines.length > 0;
    const th = textHeight(sources.length);

    // 物品图标：鼠标在它正中；提示框的文字原点在鼠标右上 (12, −12)
    const showItem = bool(params.showItem, true);
    const group = groupLayout(tw, th, showItem);
    const groupW = hasTip ? group.width : ITEM_SIZE;
    const groupH = hasTip ? group.height : ITEM_SIZE;
    const cursorX = hasTip ? group.cursorX : ITEM_SIZE / 2;
    const cursorY = hasTip ? group.cursorY : ITEM_SIZE / 2;

    // 放不下时整体缩小：界面像素变小，界面的宽高相应变大。边距不超过界面短边的四分之一
    const w0 = stage.width / G;
    const h0 = stage.height / G;
    const margin0 = Math.min(Math.max(0, num(params.margin, 10)), Math.min(w0, h0) / 4);
    const k = Math.max(0.05, Math.min(1, (w0 - 2 * margin0) / groupW, (h0 - 2 * margin0) / groupH));
    gui.root.scale.setScalar(k);
    const guiW = w0 / k;
    const guiH = h0 / k;
    const rest = anchorTopLeft({ width: guiW, height: guiH }, anchor, groupW, groupH, margin0 / k);
    const restX = Math.round(rest.x);
    const restY = Math.round(rest.y);

    // 底和边框
    let quads: Quads | null = null;
    const sprites: { setOpacity(a: number): void }[] = [];
    if (hasTip) {
      const ox = group.textX;
      const oy = group.textY;
      const wantSprite = params.style !== 'javaClassic';
      const background = wantSprite ? await ctx.resources.texture(BACKGROUND_SPRITE, { optional: true }) : null;
      const frame = background ? await ctx.resources.texture(FRAME_SPRITE, { optional: true }) : null;
      if (background && frame) {
        // 1.21.2 起：两张九宫格贴图盖在同一个矩形上，先底后框
        const [bx, by, bw, bh] = spriteBox(tw, th);
        const layer = (texture: typeof background, border: number, z: number) => {
          const sprite = ctx.sprite.create(texture, { nineSlice: [border, border, border, border], pixelSize: G });
          sprite.setSize(bw * G, bh * G);
          gui.put(sprite.object, ox + bx + bw / 2, oy + by + bh / 2, z);
          sprites.push(sprite);
        };
        layer(background, SPRITE_BACKGROUND_BORDER, 0);
        layer(frame, SPRITE_FRAME_BORDER, 0.5);
      } else {
        // 1.21.1 及更早：代码画的底和渐变边框。竖线的渐变切成 1 个界面像素高的小条
        const back = classicBackground(tw, th);
        const border = classicBorder(tw, th);
        const slices = border.left[3];
        const q = gui.quads(back.length + 2 + slices * 2, null, 0);
        let n = 0;
        const add = (x: number, y: number, rw: number, rh: number, color: string, alpha: number) => {
          q.rect(n, ox + x, oy + y, rw, rh);
          q.color(n, color, alpha);
          n++;
        };
        for (const [x, y, rw, rh] of back) add(x, y, rw, rh, CLASSIC_BACKGROUND, CLASSIC_BACKGROUND_ALPHA);
        for (let i = 0; i < slices; i++) {
          const color = gradientSlice(i, slices);
          add(border.left[0], border.left[1] + i, 1, 1, color, CLASSIC_BORDER_ALPHA);
          add(border.right[0], border.right[1] + i, 1, 1, color, CLASSIC_BORDER_ALPHA);
        }
        add(...border.top, CLASSIC_BORDER_TOP, CLASSIC_BORDER_ALPHA);
        add(...border.bottom, CLASSIC_BORDER_BOTTOM, CLASSIC_BORDER_ALPHA);
        q.commit();
        quads = q;
      }
      for (const line of lines) gui.putText(line.text, ox + line.indent, oy + lineTop(line.index), 2);
    }

    // 物品：16 × 16 个界面像素，是有厚度的模型，放在提示框后面
    // 物品的材质是引擎给的，模板不去改它的不透明度：淡入淡出时物品跟着从小放大、缩小到没有
    const item = showItem ? (await ctx.resources.item(str(params.item, 'minecraft:diamond_sword'))).single() : null;
    if (item) gui.put(item, cursorX, cursorY, -2 * G);

    // 移动：static 不动；drift 小幅摆动；follow 像鼠标在物品栏的格子之间移动
    const rng = ctx.random('follow');
    const picks = [rng.next(), rng.next(), rng.next(), rng.next()];
    const inward = (edgeStart: boolean, edgeEnd: boolean, pick: number) => (edgeStart ? 1 : edgeEnd ? -1 : pick < 0.5 ? -1 : 1);
    const dirX = inward(anchor.endsWith('Left') || anchor === 'left', anchor.endsWith('Right') || anchor === 'right', picks[0]!);
    const dirY = inward(anchor.startsWith('top'), anchor.startsWith('bottom'), picks[1]!);
    const stops = followStops(2 + (picks[2]! < 0.5 ? 0 : 1), dirX, dirY, [picks[3]!, picks[0]!]);
    const maxX = Math.max(0, guiW - groupW);
    const maxY = Math.max(0, guiH - groupH);
    const clamp = (v: number, hi: number) => Math.min(hi, Math.max(0, v));

    if (typeof params.sound === 'string') ctx.audio.cue(params.sound, 0, { gain: num(params.volume, 0.8) });

    return {
      duration: win.duration,
      cutTime: null,
      update(t: number) {
        // 整体淡入淡出（游戏里提示框是直接出现的）；_lib 的时间窗首尾各让出一帧
        const a = fadeInOut(t, win);
        const off = motion === 'drift' ? driftOffset(t) : motion === 'follow' ? followOffset(t, stops, win.in.start, win.out.end) : { x: 0, y: 0 };
        // 不出画；位置取整到设计单位，停住时文字落在整像素上
        const gx = clamp(restX + off.x, maxX);
        const gy = clamp(restY + off.y, maxY);
        gui.root.position.set(-stage.width / 2 + Math.round(gx * G * k), stage.height / 2 - Math.round(gy * G * k), 0);

        gui.root.visible = a > 0;
        quads?.setOpacity(a);
        for (const s of sprites) s.setOpacity(a);
        for (const line of lines) line.text.setOpacity(a);
        item?.scale.setScalar(ITEM_SIZE * G * Math.max(1e-4, ctx.ease.cubicOut(a)));
      },
      dispose() {
        quads?.dispose();
      },
    };
  },
};

export default template;
