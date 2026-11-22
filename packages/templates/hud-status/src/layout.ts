// 状态栏的版式和时间公式（纯函数，T-TPL-C043 直接测）。坐标是界面像素、y 向下；依据见 docs/templates/hud-status.md。

/** 一刻的秒数 */
export const TICK = 1 / 20;
/** 图标的边长和相邻图标的间距 */
export const ICON = 9;
export const STEP = 8;
/** 整块的宽度：快捷栏的宽度，左右两排图标各贴一边 */
export const BAR_WIDTH = 182;
/** 最下面一排图标的上边离界面底边 */
export const BOTTOM_OFFSET = 39;
/** 一排的图标数 */
export const PER_ROW = 10;
/** 掉血后闪 20 刻，回血后闪 10 刻；变化前的生命值保留 20 刻（1 秒） */
export const BLINK_TICKS_DAMAGE = 20;
export const BLINK_TICKS_HEAL = 10;
export const DISPLAY_HOLD_TICKS = 20;
/** 生命值（含吸收）不超过这个数时心会抖 */
export const LOW_HEALTH = 4;
/** 空气值的满值；低于它才显示空气泡 */
export const MAX_AIR = 300;
/** 预先算好的抖动表的长度（刻），到头回绕 */
export const JITTER_TICKS = 600;
/** 心最多 30 颗（40 点生命 + 20 点吸收） */
export const MAX_HEARTS = 30;

export type HeartKind = 'normal' | 'poisoned' | 'withered' | 'frozen';
export type IconState = 'empty' | 'half' | 'full';

/** 心的总数：生命的心在前，吸收的心接在后面 */
export function heartCounts(maxHealth: number, absorption: number): { normal: number; total: number } {
  const normal = Math.ceil(maxHealth / 2);
  return { normal, total: normal + Math.ceil(absorption / 2) };
}

export const heartRows = (total: number): number => Math.ceil(total / PER_ROW);
/** 排与排的间距：两排以内是 10，再多就挤一点，最少 3 */
export const rowGap = (rows: number): number => Math.max(10 - (rows - 2), 3);

/** 整块在游戏里的位置：左边、右边、最下面一排的上边 */
export function gameFrame(width: number, height: number): { left: number; right: number; baseY: number } {
  const c = Math.floor(width / 2);
  return { left: c - BAR_WIDTH / 2, right: c + BAR_WIDTH / 2, baseY: Math.floor(height) - BOTTOM_OFFSET };
}

/** 第 i 颗心（从 0 起，最下面一排在前，从左到右）的左上角，不含抖动 */
export function heartPos(i: number, left: number, baseY: number, gap: number): { x: number; y: number } {
  return { x: left + (i % PER_ROW) * STEP, y: baseY - Math.floor(i / PER_ROW) * gap };
}

/** 护甲那一排的上边：在最上面一排心的上方 10 */
export const armorTop = (baseY: number, rows: number, gap: number): number => baseY - (rows - 1) * gap - 10;
/** 护甲的第 i 个图标（从左数） */
export const armorX = (i: number, left: number): number => left + i * STEP;
/** 饥饿、空气的第 i 个图标（从右数） */
export const rightX = (i: number, right: number): number => right - i * STEP - ICON;
/** 空气那一排的上边：在饥饿上方 10 */
export const airTop = (baseY: number): number => baseY - 10;

/** 护甲、饥饿的第 i 个图标：满、半、空 */
export function pointState(i: number, value: number): IconState {
  const p = i * 2 + 1;
  return p < value ? 'full' : p === value ? 'half' : 'empty';
}

/** 第 i 颗心在生命值 value 下：满、半，或者不画（empty） */
export function heartState(i: number, value: number): IconState {
  if (i * 2 >= value) return 'empty';
  return i * 2 + 1 < value ? 'full' : 'half';
}

/** 空气泡：完整的个数和正在破裂的个数 */
export function airBubbles(air: number): { full: number; bursting: number } {
  const full = Math.max(0, Math.ceil(((air - 2) * 10) / MAX_AIR));
  return { full, bursting: Math.max(0, Math.ceil((air * 10) / MAX_AIR) - full) };
}

/** 生命值变化后经过 ticks 刻时是否在“闪白”的那一拍：剩余刻数 / 3 取整是奇数时亮 */
export function blinkOn(ticksSinceChange: number, damage: boolean): boolean {
  if (ticksSinceChange < 0) return false;
  const remaining = (damage ? BLINK_TICKS_DAMAGE : BLINK_TICKS_HEAL) - ticksSinceChange;
  return remaining > 0 && Math.floor(remaining / 3) % 2 === 1;
}

/** 当前生命值，以及闪白时垫在下面的“变化前的生命值”（变化后保留 1 秒） */
export function healthAt(ticksSinceChange: number, from: number, to: number): { health: number; display: number } {
  if (ticksSinceChange < 0) return { health: from, display: from };
  return { health: to, display: ticksSinceChange < DISPLAY_HOLD_TICKS ? from : to };
}

/** 生命恢复的波浪：这一刻被抬高 2 的那颗心的序号（可能超出心的个数，那一刻就没有心被抬） */
export const regenIndex = (tick: number, maxHealth: number): number => tick % Math.ceil(maxHealth + 5);
/** 饱和度为零时，饥饿图标在这些刻上抖 */
export const foodShakes = (tick: number, food: number): boolean => tick % (food * 3 + 1) === 0;
/** 低血量时心会抖 */
export const heartsShake = (health: number, absorption: number): boolean => health + absorption <= LOW_HEALTH;

/** 画出来的东西的外框高度（不含抖动）：从最上面一排的上边到最下面一排的下边 */
export function blockHeight(rows: number, gap: number, hasArmor: boolean, hasAir: boolean): number {
  const heartsTop = -(rows - 1) * gap - (hasArmor ? 10 : 0);
  const top = Math.min(heartsTop, hasAir ? -10 : 0);
  return ICON - top;
}

/** 心的贴图名前缀（gui/sprites/hud/heart/ 下）；吸收的心是另一套 */
export function heartPrefix(kind: HeartKind | 'absorbing', hardcore: boolean): string {
  const k = kind === 'normal' ? '' : `${kind}_`;
  return `${k}${hardcore ? 'hardcore_' : ''}`;
}

/** 旧图集 gui/icons（256 × 256）里各种心的 x；half 在右边 9，闪白的 full、half 再往右各 9 */
export const ATLAS_HEART_X: Readonly<Record<HeartKind | 'absorbing', number>> = { normal: 52, poisoned: 88, withered: 124, absorbing: 160, frozen: 178 };
/** 旧图集里核对过位置的闪白变体：普通的 full、half，中毒的 full；其余退回不闪的那张 */
export function atlasHeartRegion(kind: HeartKind | 'absorbing', half: boolean, blinking: boolean, hardcore: boolean): readonly [number, number, number, number] {
  const known = blinking && (kind === 'normal' || (kind === 'poisoned' && !half));
  return [ATLAS_HEART_X[kind] + (half ? 9 : 0) + (known ? 18 : 0), hardcore ? 45 : 0, ICON, ICON];
}

/** 旧图集里其余图标的位置 */
export const ATLAS: Readonly<Record<string, readonly [number, number, number, number]>> = {
  container: [16, 0, 9, 9],
  container_blinking: [25, 0, 9, 9],
  armor_empty: [16, 9, 9, 9],
  armor_half: [25, 9, 9, 9],
  armor_full: [34, 9, 9, 9],
  food_empty: [16, 27, 9, 9],
  food_full: [52, 27, 9, 9],
  food_half: [61, 27, 9, 9],
  food_empty_hunger: [133, 27, 9, 9],
  food_full_hunger: [88, 27, 9, 9],
  food_half_hunger: [97, 27, 9, 9],
  air: [16, 18, 9, 9],
  air_bursting: [25, 18, 9, 9],
};

/**
 * 没有任何贴图时纯色块在图标格子里的位置（相对图标左上角的 x、y、宽、高）：容器、空位和图标都是里面的 7 × 7，半个只画左边 4 宽。
 * 相邻图标相隔 8，块和块之间留 1 个界面像素的缝，数得出一共几颗、哪几颗是空的
 */
export const PLAIN_BOX = { full: [1, 1, ICON - 2, ICON - 2], half: [1, 1, 4, ICON - 2] } as const;

/**
 * 没有任何贴图时纯色块的颜色（占位，不是游戏里的颜色）。闪白的容器只比平时亮一些、不用白色：
 * 一排容器一起闪时不会连成一条白条；变化前的心闪白色
 */
export const PLAIN = {
  container: '#2A2A2A',
  containerBlinking: '#A0A0A0',
  blinking: '#FFFFFF',
  normal: '#E0261E',
  poisoned: '#8B8712',
  withered: '#2B2020',
  frozen: '#84BCEA',
  absorbing: '#D4AF37',
  armor: '#C8C8C8',
  food: '#B4602A',
  hunger: '#6F7F2A',
  air: '#5A9BEF',
  airBursting: '#B9D4F5',
} as const;
