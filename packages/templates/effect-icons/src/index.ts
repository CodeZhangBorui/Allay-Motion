// 052 状态效果 allay.builtin.effect-icons（docs/templates/effect-icons.md）。叠加层：右上角的状态效果图标一个个出现，快结束的那个闪烁后消失。
// 只用公开的模板接口；布局按界面像素（一个界面像素 = guiScale 个设计单位），数值在 layout.ts。
import type { SetupContext, TemplateInstance, TemplateModule } from '@allay/template-sdk';
import { overlayWindows } from '../../_lib/src/timing';
import { fadeInOut } from '../../_lib/src/fade';
import { bool, createGui, firstTexture, num, str, type Quads, type Region } from '../../_lib/src/gui-kit';
import { arrange, blinkAlpha, EFFECTS, FRAME, ICON, ICON_INSET, remainingTicks, ROW_TOP_OTHER, rowWidth, SLOTS, type Slot } from './layout';

/** 框：1.20.2 起是单独的贴图；更早在物品栏界面的图集里 */
const FRAME_SPRITE = 'minecraft:gui/sprites/hud/effect_background';
const OLD_ATLAS = 'minecraft:gui/container/inventory';
const OLD_FRAME: Region = [141, 166, FRAME, FRAME];
const OLD_FRAME_AMBIENT: Region = [165, 166, FRAME, FRAME];
/** 没有框的贴图时的纯色块 */
const PLAIN_FRAME = '#2B2B2B';
const PLAIN_FRAME_AMBIENT = '#2A4A6B';
const WHITE = '#FFFFFF';

const template: TemplateModule = {
  async setup(ctx: SetupContext): Promise<TemplateInstance> {
    const { stage, params } = ctx;
    const G = Math.max(1, num(params.guiScale, 6));
    const inDuration = num(params.inDuration, 0.25);
    const hold = num(params.hold, 6);
    const outDuration = num(params.outDuration, 0.25);
    const win = overlayWindows(stage.fps, inDuration, hold, outDuration);
    const ambient = bool(params.ambient, false);
    const mirrored = str(params.anchor, 'topRight') === 'topLeft';
    const interval = Math.max(0, num(params.interval, 0.4));
    const remaining = Math.max(0.05, num(params.remaining, 8));
    const expiring = Number.parseInt(str(params.expiring, 'none'), 10);

    // 选了效果的栏位按顺序出现：第一个从开头就在（跟着整体淡入），之后每隔 interval 一个
    const slots: Slot[] = [];
    let expiringSlot = -1;
    for (let n = 1; n <= SLOTS; n++) {
      const effect = str(params[`effect${n}`], 'none');
      if (effect === 'none' || effect === '') continue;
      const appearAt = slots.length * interval;
      // 信标给的效果不会到期
      const expires = n === expiring && !ambient;
      if (expires) expiringSlot = slots.length;
      slots.push({ effect, appearAt, expireAt: expires ? appearAt + remaining : Number.POSITIVE_INFINITY });
    }

    // 一排最多有几个决定要多宽；放不下时整体缩小
    const good = slots.filter((s) => EFFECTS[s.effect]?.beneficial === true).length;
    const widest = Math.max(1, good, slots.length - good);
    const unit = Math.min(G, stage.width / rowWidth(widest), stage.height / (ROW_TOP_OTHER + FRAME + 1));
    const guiW = stage.width / unit;
    const gui = createGui(ctx, unit);
    gui.root.position.set(-stage.width / 2, stage.height / 2, 0);

    const all: Quads[] = [];
    const count = Math.max(1, slots.length);

    // 框：新路径 → 旧图集的一块 → 纯色块
    const frameTex = slots.length > 0 ? await firstTexture(ctx, [ambient ? `${FRAME_SPRITE}_ambient` : FRAME_SPRITE, OLD_ATLAS]) : null;
    const frames = gui.quads(count, frameTex?.texture ?? null, 0);
    all.push(frames);
    for (let i = 0; i < count; i++) {
      frames.hide(i);
      if (frameTex?.index === 1) frames.region(i, ambient ? OLD_FRAME_AMBIENT : OLD_FRAME);
      if (!frameTex) frames.color(i, ambient ? PLAIN_FRAME_AMBIENT : PLAIN_FRAME, 1);
    }

    // 图标：每种效果一张贴图、一个批次；没有贴图的合在一个纯色批次里
    const byEffect = new Map<string, Quads | null>();
    for (const s of slots) {
      if (byEffect.has(s.effect)) continue;
      const texture = await ctx.resources.texture(`minecraft:mob_effect/${s.effect}`, { optional: true });
      const q = texture ? gui.quads(count, texture, 1) : null;
      if (q) all.push(q);
      byEffect.set(s.effect, q);
    }
    const shared: { plain: Quads | null } = { plain: null };
    const plainBatch = (): Quads => {
      if (!shared.plain) {
        shared.plain = gui.quads(count, null, 1);
        all.push(shared.plain);
      }
      return shared.plain;
    };
    const icons = slots.map((s, i) => {
      const own = byEffect.get(s.effect) ?? null;
      const quads = own ?? plainBatch();
      quads.hide(i);
      return { quads, color: own ? WHITE : (EFFECTS[s.effect]?.color ?? '#808080') };
    });

    if (typeof params.sound === 'string') {
      for (const s of slots) if (s.appearAt < win.duration) ctx.audio.cue(params.sound, s.appearAt, { gain: num(params.volume, 0.8) });
    }

    return {
      duration: win.duration,
      cutTime: null,
      update(t: number) {
        const placed = arrange(slots, t, guiW, mirrored);
        for (let i = 0; i < count; i++) {
          frames.hide(i);
          icons[i]?.quads.hide(i);
        }
        placed.forEach((p, n) => {
          frames.rect(n, p.x, p.y, FRAME, FRAME);
          const icon = icons[p.index];
          const slot = slots[p.index];
          if (!icon || !slot) return;
          icon.quads.rect(p.index, p.x + ICON_INSET, p.y + ICON_INSET, ICON, ICON);
          // 快结束的那个：图标按剩余刻数变淡、闪烁，框不变
          const alpha = p.index === expiringSlot ? blinkAlpha(remainingTicks(remaining, t - slot.appearAt)) : 1;
          icon.quads.color(p.index, icon.color, alpha);
        });
        // 整体淡入淡出（_lib 的时间窗首尾各让出一帧）
        const a = fadeInOut(t, win);
        for (const q of all) {
          q.commit();
          q.setOpacity(a);
        }
      },
      dispose() {
        for (const q of all) q.dispose();
      },
    };
  },
};

export default template;
