// 状态效果图标的版式和时间公式（纯函数，T-TPL-C052 直接测）。坐标是界面像素、y 向下；依据见 docs/templates/effect-icons.md。

/** 一刻的秒数 */
export const TICK = 1 / 20;
/** 框的边长、图标的边长、图标在框里的偏移、相邻两个框的步距 */
export const FRAME = 24;
export const ICON = 18;
export const ICON_INSET = 3;
export const STEP = 25;
/** 两排的上边：正面效果在第一排，负面和中性的在第二排 */
export const ROW_TOP_BENEFICIAL = 1;
export const ROW_TOP_OTHER = 27;
/** 剩余时间不超过这么多刻（10 秒）时图标开始变淡、闪烁 */
export const BLINK_TICKS = 200;
/** 最多几个效果 */
export const SLOTS = 6;

export interface EffectInfo {
  /** 正面效果（第一排）；负面和中性的都在第二排 */
  beneficial: boolean;
  /** 没有图标贴图时占位色块的颜色（凭记忆的药水颜色，只当占位用） */
  color: string;
}

/** 效果的分类（凭记忆）和占位颜色。瞬间治疗、瞬间伤害没有持续时间，不会出现在抬头显示里，所以不列 */
export const EFFECTS: Readonly<Record<string, EffectInfo>> = {
  speed: { beneficial: true, color: '#33EBFF' },
  haste: { beneficial: true, color: '#D9C043' },
  strength: { beneficial: true, color: '#FFC700' },
  jump_boost: { beneficial: true, color: '#FDFF84' },
  regeneration: { beneficial: true, color: '#CD5CAB' },
  resistance: { beneficial: true, color: '#9146F0' },
  fire_resistance: { beneficial: true, color: '#FF9900' },
  water_breathing: { beneficial: true, color: '#98DAC0' },
  invisibility: { beneficial: true, color: '#F6F6F6' },
  night_vision: { beneficial: true, color: '#C2FF66' },
  health_boost: { beneficial: true, color: '#F87D23' },
  absorption: { beneficial: true, color: '#2552A5' },
  saturation: { beneficial: true, color: '#F82423' },
  luck: { beneficial: true, color: '#59C106' },
  slow_falling: { beneficial: true, color: '#F3CFB9' },
  conduit_power: { beneficial: true, color: '#1DC2D1' },
  dolphins_grace: { beneficial: true, color: '#88A3BE' },
  hero_of_the_village: { beneficial: true, color: '#44FF44' },
  slowness: { beneficial: false, color: '#8BAFE0' },
  mining_fatigue: { beneficial: false, color: '#4A4217' },
  nausea: { beneficial: false, color: '#551D4A' },
  blindness: { beneficial: false, color: '#1F1F23' },
  hunger: { beneficial: false, color: '#587653' },
  weakness: { beneficial: false, color: '#484D48' },
  poison: { beneficial: false, color: '#87A363' },
  wither: { beneficial: false, color: '#736156' },
  levitation: { beneficial: false, color: '#CEFFFF' },
  unluck: { beneficial: false, color: '#C0A44D' },
  darkness: { beneficial: false, color: '#292721' },
  glowing: { beneficial: false, color: '#94A061' },
  bad_omen: { beneficial: false, color: '#0B6138' },
  raid_omen: { beneficial: false, color: '#DE4058' },
  trial_omen: { beneficial: false, color: '#16A6A6' },
  infested: { beneficial: false, color: '#8C9B8C' },
  oozing: { beneficial: false, color: '#99FFA3' },
  weaving: { beneficial: false, color: '#78695A' },
  wind_charged: { beneficial: false, color: '#BDC9FF' },
};

/** 一排里从屏幕边上数第 k 个（k 从 1 起）框的左边；mirrored 是摆到左上角的镜像 */
export function frameX(width: number, k: number, mirrored: boolean): number {
  return mirrored ? STEP * k - FRAME : width - STEP * k;
}

/**
 * 快结束的效果的图标不透明度；d 是剩余刻数。超过 200 刻是 1；200 刻以内先降到一半，
 * 再叠一个周期 10 刻的余弦，摆幅每过 20 刻加大一档（到最后 1 秒是 ±0.25）；最后 50 刻底从一半线性降到 0。
 */
export function blinkAlpha(d: number): number {
  if (d > BLINK_TICKS) return 1;
  if (d <= 0) return 0;
  const m = 10 - Math.floor(d / 20);
  const base = Math.min(0.5, Math.max(0, (d / 10 / 5) * 0.5));
  const swing = Math.min(0.25, Math.max(0, (m / 10) * 0.25));
  return Math.min(1, Math.max(0, base + Math.cos((d * Math.PI) / 5) * swing));
}

export interface Slot {
  /** 效果名；EFFECTS 里没有的当成负面 */
  effect: string;
  /** 出现的时刻（秒） */
  appearAt: number;
  /** 消失的时刻；不会消失的是 Infinity */
  expireAt: number;
}

export interface Placed {
  /** slots 里的序号 */
  index: number;
  /** 框的左上角 */
  x: number;
  y: number;
}

/**
 * t 时刻在场的效果各自的位置：按 slots 的顺序，各排从屏幕边上往里排；
 * 某个效果消失后，排在它后面的立刻补上来（游戏每帧重新排）。
 */
export function arrange(slots: readonly Slot[], t: number, width: number, mirrored: boolean): Placed[] {
  const out: Placed[] = [];
  let good = 0;
  let other = 0;
  slots.forEach((s, index) => {
    if (t < s.appearAt || t >= s.expireAt) return;
    const beneficial = EFFECTS[s.effect]?.beneficial === true;
    const k = beneficial ? ++good : ++other;
    out.push({ index, x: frameX(width, k, mirrored), y: beneficial ? ROW_TOP_BENEFICIAL : ROW_TOP_OTHER });
  });
  return out;
}

/** 出现后 age 秒时的剩余刻数（游戏里每刻减一） */
export const remainingTicks = (remainingSeconds: number, age: number): number => Math.round(remainingSeconds / TICK) - Math.floor(age / TICK + 1e-6);

/** 放得下一排 count 个框所需的界面宽度 */
export const rowWidth = (count: number): number => STEP * count + 1;
