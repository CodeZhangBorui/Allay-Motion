// 043 状态栏 allay.builtin.hud-status（docs/templates/hud-status.md）。叠加层：生命、护甲、饥饿、空气几排图标，生命值在停留阶段变一次。
// 只用公开的模板接口；布局按界面像素（一个界面像素 = guiScale 个设计单位），数值在 layout.ts。
import type { SetupContext, TemplateInstance, TemplateModule } from '@allay/template-sdk';
import { anchorTopLeft, type Anchor } from '../../_lib/src/gui';
import { overlayWindows, progress } from '../../_lib/src/timing';
import { bool, createGui, num, str, type Quads, type Region } from '../../_lib/src/gui-kit';
import {
  airBubbles,
  airTop,
  armorTop,
  armorX,
  ATLAS,
  atlasHeartRegion,
  BAR_WIDTH,
  blinkOn,
  blockHeight,
  BOTTOM_OFFSET,
  foodShakes,
  gameFrame,
  healthAt,
  heartCounts,
  heartPos,
  heartPrefix,
  heartRows,
  heartsShake,
  heartState,
  ICON,
  JITTER_TICKS,
  MAX_AIR,
  MAX_HEARTS,
  PER_ROW,
  PLAIN,
  pointState,
  regenIndex,
  rightX,
  rowGap,
  TICK,
  type HeartKind,
} from './layout';

const SPRITES = 'minecraft:gui/sprites/hud/';
const OLD_ATLAS = 'minecraft:gui/icons';
const ANCHORS: readonly Anchor[] = ['topLeft', 'top', 'topRight', 'left', 'center', 'right', 'bottomLeft', 'bottom', 'bottomRight'];
const KINDS: readonly HeartKind[] = ['normal', 'poisoned', 'withered', 'frozen'];

/** 一种图标：新路径的贴图名、旧图集里的位置、都没有时的纯色块（相对图标左上角的 x、y、宽、高） */
interface IconDef {
  sprite: string;
  atlas: Region | null;
  plain: { color: string; box: Region } | null;
  /** 0 底（容器、空位）、1 闪白的心、2 心和其余图标 */
  layer: 0 | 1 | 2;
}

interface Batch {
  quads: Quads;
  used: number;
  high: number;
}

/** 解析好的图标：画在哪个批次里，用贴图的哪一块，或者是什么颜色的块 */
interface Source {
  batch: Batch;
  region: Region | null;
  plain: { color: string; box: Region } | null;
}

const FULL_BOX: Region = [0, 0, ICON, ICON];
const INNER_BOX: Region = [1, 1, ICON - 2, ICON - 2];
const HALF_BOX: Region = [1, 1, 4, ICON - 2];

const template: TemplateModule = {
  async setup(ctx: SetupContext): Promise<TemplateInstance> {
    const { stage, params } = ctx;
    const G = Math.max(1, num(params.guiScale, 6));
    const inDuration = num(params.inDuration, 0.25);
    const hold = num(params.hold, 3.5);
    const outDuration = num(params.outDuration, 0.25);
    const win = overlayWindows(stage.fps, inDuration, hold, outDuration);

    const maxHealth = Math.min(40, Math.max(2, Math.round(num(params.maxHealth, 20))));
    const healthFrom = Math.min(maxHealth, Math.max(0, Math.round(num(params.healthFrom, 20))));
    const healthTo = Math.min(maxHealth, Math.max(0, Math.round(num(params.healthTo, 7))));
    const absorption = Math.min(20, Math.max(0, Math.round(num(params.absorption, 0))));
    const armor = Math.min(20, Math.max(0, Math.round(num(params.armor, 0))));
    const food = Math.min(20, Math.max(0, Math.round(num(params.food, 20))));
    const air = Math.min(MAX_AIR, Math.max(0, Math.round(num(params.air, MAX_AIR))));
    const kindParam = str(params.heartStyle, 'normal');
    const kind: HeartKind = KINDS.find((k) => k === kindParam) ?? 'normal';
    const hardcore = bool(params.hardcore, false);
    const regeneration = bool(params.regeneration, false);
    const hunger = bool(params.hunger, false);
    const starving = bool(params.starving, false);
    const anchorParam = str(params.anchor, 'game');
    const anchor = ANCHORS.find((a) => a === anchorParam) ?? null;
    const margin = Math.max(0, num(params.margin, 4));

    const counts = heartCounts(maxHealth, absorption);
    const rows = heartRows(counts.total);
    const gap = rowGap(rows);
    const hasArmor = armor > 0;
    const hasAir = air < MAX_AIR;
    const boxH = blockHeight(rows, gap, hasArmor, hasAir);

    // 放不下时整体缩小：竖屏里界面宽度不到 182
    const unit = anchor
      ? Math.min(G, stage.width / (BAR_WIDTH + 2 * margin), stage.height / (boxH + 2 * margin))
      : Math.min(G, stage.width / (BAR_WIDTH + 2), stage.height / (boxH - ICON + BOTTOM_OFFSET + 1));
    const guiW = stage.width / unit;
    const guiH = stage.height / unit;
    const gui = createGui(ctx, unit);
    gui.root.position.set(-stage.width / 2, stage.height / 2, 0);

    let frame = gameFrame(guiW, guiH);
    if (anchor) {
      const p = anchorTopLeft({ width: guiW, height: guiH }, anchor, BAR_WIDTH, boxH, margin);
      const left = Math.round(p.x);
      frame = { left, right: left + BAR_WIDTH, baseY: Math.round(p.y) + boxH - ICON };
    }

    // ---- 贴图：新路径一种图标一张 → 旧图集的一块 → 纯色块 ----
    const batches: Batch[] = [];
    type Tex = Parameters<typeof gui.quads>[1];
    const makeBatch = (texture: Tex, layer: number, capacity: number): Batch => {
      const b: Batch = { quads: gui.quads(capacity, texture, layer), used: 0, high: 0 };
      batches.push(b);
      return b;
    };
    // 旧图集和纯色块：每层一个批次，各层里所有图标共用
    const SHARED = MAX_HEARTS + 3 * PER_ROW;
    const layerBatches: { atlasTexture: Tex | undefined; atlas: (Batch | undefined)[]; plain: (Batch | undefined)[] } = { atlasTexture: undefined, atlas: [], plain: [] };
    const resolve = async (def: IconDef): Promise<Source | null> => {
      const own = await ctx.resources.texture(SPRITES + def.sprite, { optional: true });
      if (own) return { batch: makeBatch(own, def.layer, MAX_HEARTS), region: null, plain: null };
      if (def.atlas) {
        if (layerBatches.atlasTexture === undefined) layerBatches.atlasTexture = await ctx.resources.texture(OLD_ATLAS, { optional: true });
        const atlas = layerBatches.atlasTexture;
        if (atlas) return { batch: (layerBatches.atlas[def.layer] ??= makeBatch(atlas, def.layer, SHARED)), region: def.atlas, plain: null };
      }
      if (!def.plain) return null;
      return { batch: (layerBatches.plain[def.layer] ??= makeBatch(null, def.layer, SHARED)), region: null, plain: def.plain };
    };

    type HeartSet = { full: Source | null; half: Source | null };
    const heartSet = async (k: HeartKind | 'absorbing', blinking: boolean): Promise<HeartSet> => {
      const prefix = `heart/${heartPrefix(k, hardcore)}`;
      const color = blinking ? PLAIN.blinking : PLAIN[k];
      const one = (half: boolean) =>
        resolve({
          sprite: `${prefix}${half ? 'half' : 'full'}${blinking ? '_blinking' : ''}`,
          atlas: atlasHeartRegion(k, half, blinking, hardcore),
          plain: { color, box: half ? HALF_BOX : INNER_BOX },
          layer: blinking ? 1 : 2,
        });
      return { full: await one(false), half: await one(true) };
    };
    const simple = (sprite: string, color: string | null, layer: 0 | 2, box: Region = FULL_BOX) =>
      resolve({ sprite, atlas: ATLAS[sprite.replace('heart/', '').replace('_hardcore', '')] ?? null, plain: color ? { color, box } : null, layer });

    const changes = healthFrom !== healthTo;
    const container = await simple(hardcore ? 'heart/container_hardcore' : 'heart/container', PLAIN.container, 0);
    const containerBlinking = changes ? await simple(hardcore ? 'heart/container_hardcore_blinking' : 'heart/container_blinking', PLAIN.containerBlinking, 0) : null;
    const hearts = await heartSet(kind, false);
    const heartsBlinking = changes ? await heartSet(kind, true) : null;
    // 凋零时吸收的心也是凋零的样子，其余种类下吸收的心是黄色
    const absorbing = absorption > 0 ? await heartSet(kind === 'withered' ? 'withered' : 'absorbing', false) : null;
    const armorIcons = hasArmor
      ? { empty: await simple('armor_empty', PLAIN.container, 0), half: await simple('armor_half', PLAIN.armor, 2, HALF_BOX), full: await simple('armor_full', PLAIN.armor, 2, INNER_BOX) }
      : null;
    const suffix = hunger ? '_hunger' : '';
    const foodColor = hunger ? PLAIN.hunger : PLAIN.food;
    const foodIcons = {
      empty: await simple(`food_empty${suffix}`, PLAIN.container, 0),
      half: await simple(`food_half${suffix}`, foodColor, 2, HALF_BOX),
      full: await simple(`food_full${suffix}`, foodColor, 2, INNER_BOX),
    };
    const airIcons = hasAir
      ? {
          full: await simple('air', PLAIN.air, 2, INNER_BOX),
          bursting: await simple('air_bursting', PLAIN.airBursting, 2, INNER_BOX),
          // 只有 1.21.2 起有空位的贴图；没有时空位不画
          empty: await simple('air_empty', null, 0),
        }
      : null;

    // ---- 随机量：每刻每个图标的抖动，预先算成表 ----
    const heartJitter = new Uint8Array(JITTER_TICKS * MAX_HEARTS);
    const heartRng = ctx.random('heart-jitter');
    for (let i = 0; i < heartJitter.length; i++) heartJitter[i] = heartRng.int(0, 1);
    const foodJitter = new Int8Array(JITTER_TICKS * PER_ROW);
    const foodRng = ctx.random('food-jitter');
    for (let i = 0; i < foodJitter.length; i++) foodJitter[i] = foodRng.int(-1, 1);

    // 生命值在停留阶段的 changeAt 秒变化
    const changeTime = inDuration + Math.min(Math.max(0, num(params.changeAt, 1)), hold);
    if (healthTo < healthFrom && typeof params.hurtSound === 'string') ctx.audio.cue(params.hurtSound, changeTime, { gain: num(params.volume, 0.8) });

    const draw = (src: Source | null, x: number, y: number) => {
      if (!src) return;
      const b = src.batch;
      const i = b.used++;
      if (src.plain) {
        const [dx, dy, w, h] = src.plain.box;
        b.quads.rect(i, x + dx, y + dy, w, h);
        b.quads.color(i, src.plain.color, 1);
      } else {
        b.quads.rect(i, x, y, ICON, ICON);
        if (src.region) b.quads.region(i, src.region);
      }
    };

    return {
      duration: win.duration,
      cutTime: null,
      update(t: number) {
        const tick = Math.floor(t / TICK + 1e-6);
        const sinceChange = changes ? Math.floor((t - changeTime) / TICK + 1e-6) : -1;
        const { health, display } = healthAt(sinceChange, healthFrom, healthTo);
        const blink = changes && blinkOn(sinceChange, healthTo < healthFrom);
        const shake = heartsShake(health, absorption);
        const lifted = regeneration ? regenIndex(tick, maxHealth) : -1;
        const row = tick % JITTER_TICKS;

        for (let i = 0; i < counts.total; i++) {
          const p = heartPos(i, frame.left, frame.baseY, gap);
          let y = p.y;
          if (shake) y += heartJitter[row * MAX_HEARTS + i] ?? 0;
          if (i < counts.normal && i === lifted) y -= 2;
          draw(blink ? containerBlinking : container, p.x, y);
          if (i >= counts.normal) {
            const a = (i - counts.normal) * 2;
            if (absorbing && a < absorption) draw(a + 1 === absorption ? absorbing.half : absorbing.full, p.x, y);
            continue;
          }
          if (blink && heartsBlinking) {
            const s = heartState(i, display);
            if (s !== 'empty') draw(heartsBlinking[s], p.x, y);
          }
          const s = heartState(i, health);
          if (s !== 'empty') draw(hearts[s], p.x, y);
        }

        if (armorIcons) {
          const y = armorTop(frame.baseY, rows, gap);
          for (let i = 0; i < PER_ROW; i++) draw(armorIcons[pointState(i, armor)], armorX(i, frame.left), y);
        }

        const foodShake = starving && foodShakes(tick, food);
        for (let i = 0; i < PER_ROW; i++) {
          const x = rightX(i, frame.right);
          const y = frame.baseY + (foodShake ? (foodJitter[row * PER_ROW + i] ?? 0) : 0);
          draw(foodIcons.empty, x, y);
          const s = pointState(i, food);
          if (s !== 'empty') draw(foodIcons[s], x, y);
        }

        if (airIcons) {
          const y = airTop(frame.baseY);
          const { full, bursting } = airBubbles(air);
          for (let i = 0; i < PER_ROW; i++) draw(i < full ? airIcons.full : i < full + bursting ? airIcons.bursting : airIcons.empty, rightX(i, frame.right), y);
        }

        // 整体淡入淡出（_lib 的时间窗首尾各让出一帧）
        const a = progress(t, win.in) * (1 - progress(t, win.out));
        for (const b of batches) {
          for (let i = b.used; i < b.high; i++) b.quads.hide(i);
          b.high = b.used;
          b.used = 0;
          b.quads.commit();
          b.quads.setOpacity(a);
        }
      },
      dispose() {
        for (const b of batches) b.quads.dispose();
      },
    };
  },
};

export default template;
