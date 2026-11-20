// 调试屏幕的版式、路线和数值格式（纯函数，T-TPL-C054 直接测）。坐标是界面像素、y 向下；依据见 docs/templates/debug-f3.md。

/** 左栏的 x、第一行的 y；右栏的行右端在 w − MARGIN */
export const MARGIN = 2;
/** 行距，以及一行字的内容高 */
export const LINE_H = 9;
export const TEXT_H = 8;
/** 每行灰底比文字向左、向上、向右各多出的界面像素；灰底高 9 */
export const BG_PAD = 1;
/** 左右两栏的灰底之间至少留的界面像素（放不下时整体缩小用） */
export const COLUMN_GAP = 4;
/** 每栏最多的行数；会随时间变的占位符最多这么多个，多出来的定格成停留中点的值 */
export const MAX_LINES = 24;
export const MAX_VALUES = 48;

const NUMERIC_KEYS = ['x', 'y', 'z', 'bx', 'by', 'bz', 'cx', 'cy', 'cz', 'rx', 'ry', 'rz', 'yaw', 'pitch', 'fps'] as const;
const WORD_KEYS = ['facing', 'towards'] as const;
export type NumericKey = (typeof NUMERIC_KEYS)[number];
export type WordKey = (typeof WORD_KEYS)[number];
export type ValueKey = NumericKey | WordKey;

/** 数值占位符只会用到这些字符 */
export const NUMERIC_CHARS = '0123456789-.';
/**
 * 每个数值占位符最长多少个字符（坐标在 ±30,000,000、y 在 −64…320 之内）：
 * x、z 如 “-30000000.000”；y 如 “-64.00000”；方块坐标如 “-30000000”；区块坐标如 “-1875000”；偏航如 “-180.0”。
 */
export const NUMERIC_MAX_LEN: Readonly<Record<NumericKey, number>> = { x: 13, y: 10, z: 13, bx: 9, by: 4, bz: 9, cx: 8, cy: 3, cz: 8, rx: 2, ry: 2, rz: 2, yaw: 6, pitch: 5, fps: 4 };

/** 朝向的四个词，序号 0–3 对应偏航 0°、90°、180°、−90° */
export const FACINGS = ['south', 'west', 'north', 'east'] as const;
export const TOWARDS = ['positive Z', 'negative X', 'negative Z', 'positive X'] as const;

export const isNumericKey = (key: string): key is NumericKey => (NUMERIC_KEYS as readonly string[]).includes(key);
export const isWordKey = (key: string): key is WordKey => (WORD_KEYS as readonly string[]).includes(key);

/** 多行文字参数 → 各行（去掉行尾空白；空行保留、占一行的位置；末尾的空行去掉） */
export function splitLines(text: string, max = MAX_LINES): string[] {
  const lines = text
    .split('\n')
    .slice(0, max)
    .map((l) => l.replace(/\s+$/, ''));
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

export type Token = { kind: 'text'; text: string } | { kind: 'value'; key: ValueKey };

/** 把一行拆成固定文字和占位符；不认识的 {……} 当普通文字 */
export function parseLine(line: string): Token[] {
  const out: Token[] = [];
  let buf = '';
  const re = /\{([a-z]+)\}/g;
  let last = 0;
  for (let m = re.exec(line); m; m = re.exec(line)) {
    const key = m[1]!;
    if (!isNumericKey(key) && !isWordKey(key)) continue;
    buf += line.slice(last, m.index);
    if (buf !== '') out.push({ kind: 'text', text: buf });
    buf = '';
    out.push({ kind: 'value', key });
    last = m.index + m[0].length;
  }
  buf += line.slice(last);
  if (buf !== '') out.push({ kind: 'text', text: buf });
  return out;
}

/** 第 i 行文字的上边 */
export const lineTop = (i: number): number => MARGIN + i * LINE_H;

/** 一行的灰底：文字左上角 (x, top)、文字宽 width → [左, 上, 宽, 高] */
export const lineBackground = (x: number, top: number, width: number): [number, number, number, number] => [x - BG_PAD, top - BG_PAD, width + 2 * BG_PAD, LINE_H];

/** 右栏一行文字的左边：行的右端在 w − MARGIN */
export const rightLineX = (guiWidth: number, width: number): number => guiWidth - MARGIN - width;

/** 放不下时的整体缩小倍数（≤ 1）。宽度是两栏最宽的行，rows 是两栏里较多的行数；都按界面像素 */
export function fitRoot(guiWidth: number, guiHeight: number, leftWidth: number, rightWidth: number, rows: number): number {
  const sides = (leftWidth > 0 ? 1 : 0) + (rightWidth > 0 ? 1 : 0);
  // 每栏：外边距 + 文字 + 灰底多出的 1；两栏都有时中间再留 COLUMN_GAP
  const needW = leftWidth + rightWidth + sides * (MARGIN + BG_PAD) + (sides === 2 ? COLUMN_GAP : 0);
  const needH = rows > 0 ? MARGIN + rows * LINE_H + MARGIN : 0;
  return Math.min(1, needW > 0 ? guiWidth / needW : 1, needH > 0 ? guiHeight / needH : 1);
}

/** 角度折到 [−180, 180) */
export function wrapDegrees(a: number): number {
  const r = ((a % 360) + 360) % 360;
  return r >= 180 ? r - 360 : r;
}

/** 行进方向的偏航：0 = 南（+Z），90 = 西（−X），±180 = 北（−Z），−90 = 东（+X）；水平方向没有位移时是 0 */
export function travelYaw(dx: number, dz: number): number {
  if (Math.abs(dx) < 1e-9 && Math.abs(dz) < 1e-9) return 0;
  return wrapDegrees((Math.atan2(-dx, dz) * 180) / Math.PI);
}

/** 偏航 → 朝向的序号（FACINGS、TOWARDS 的下标）：每 90° 一个方向，分界在 ±45°、±135° */
export function facingIndex(yaw: number): number {
  return (((Math.floor(wrapDegrees(yaw) / 90 + 0.5) % 4) + 4) % 4) as number;
}

/** 视角的轻微晃动：两个正弦之和，幅度 amplitude 度；phases 是 setup 里用种子定的相位 */
export function sway(t: number, phases: readonly [number, number], amplitude: number): number {
  return amplitude * (0.65 * Math.sin(2 * Math.PI * 0.31 * t + phases[0]) + 0.35 * Math.sin(2 * Math.PI * 0.83 * t + phases[1]));
}

export interface Route {
  from: readonly [number, number, number];
  to: readonly [number, number, number];
  /** 俯仰的基准值，度（向下为正） */
  pitch: number;
  fpsBase: number;
  /** 偏航、俯仰晃动的相位 */
  yawPhases: readonly [number, number];
  pitchPhases: readonly [number, number];
  /** 每秒一个 −1…1 的数，帧率按它在基准值上下浮动 */
  fpsJitter: readonly number[];
}

/** 偏航、俯仰晃动的幅度（度），帧率浮动的比例 */
export const YAW_SWAY = 2.5;
export const PITCH_SWAY = 1.2;
export const FPS_JITTER = 0.04;

export interface Pose {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  fps: number;
}

/**
 * 时刻 t 的状态。p 是位置在路线上的进度（0–1：进入阶段停在起点，停留阶段匀速走完，退出阶段停在终点）。
 * 帧率每秒变一次（游戏的帧率计数每秒更新一次）。
 */
export function poseAt(t: number, p: number, route: Route): Pose {
  const q = Math.min(1, Math.max(0, p));
  const [fx, fy, fz] = route.from;
  const [tx, ty, tz] = route.to;
  const jitter = route.fpsJitter.length > 0 ? route.fpsJitter[Math.max(0, Math.floor(t)) % route.fpsJitter.length]! : 0;
  return {
    x: fx + (tx - fx) * q,
    y: fy + (ty - fy) * q,
    z: fz + (tz - fz) * q,
    yaw: wrapDegrees(travelYaw(tx - fx, tz - fz) + sway(t, route.yawPhases, YAW_SWAY)),
    pitch: Math.min(90, Math.max(-90, route.pitch + sway(t, route.pitchPhases, PITCH_SWAY))),
    fps: Math.max(1, Math.round(route.fpsBase * (1 + FPS_JITTER * jitter))),
  };
}

/** 位置在路线上的进度：停留阶段从 0 走到 1 */
export function routeProgress(t: number, inDuration: number, hold: number): number {
  if (hold <= 0) return t < inDuration ? 0 : 1;
  return Math.min(1, Math.max(0, (t - inDuration) / hold));
}

const chunkOf = (block: number): number => Math.floor(block / 16);
const inChunk = (block: number): number => block - 16 * Math.floor(block / 16);

/** 占位符在某个状态下的文字。x、z 三位小数，y 五位小数，偏航、俯仰一位小数，其余是整数 */
export function formatValue(key: ValueKey, pose: Pose): string {
  const bx = Math.floor(pose.x);
  const by = Math.floor(pose.y);
  const bz = Math.floor(pose.z);
  switch (key) {
    case 'x':
      return pose.x.toFixed(3);
    case 'y':
      return pose.y.toFixed(5);
    case 'z':
      return pose.z.toFixed(3);
    case 'bx':
      return String(bx);
    case 'by':
      return String(by);
    case 'bz':
      return String(bz);
    case 'cx':
      return String(chunkOf(bx));
    case 'cy':
      return String(chunkOf(by));
    case 'cz':
      return String(chunkOf(bz));
    case 'rx':
      return String(inChunk(bx));
    case 'ry':
      return String(inChunk(by));
    case 'rz':
      return String(inChunk(bz));
    case 'yaw':
      return pose.yaw.toFixed(1);
    case 'pitch':
      return pose.pitch.toFixed(1);
    case 'fps':
      return String(pose.fps);
    case 'facing':
      return FACINGS[facingIndex(pose.yaw)]!;
    case 'towards':
      return TOWARDS[facingIndex(pose.yaw)]!;
  }
}

/** 把一行里的占位符都换成文字（单元测试和定格用） */
export function formatLine(tokens: readonly Token[], pose: Pose): string {
  return tokens.map((tk) => (tk.kind === 'text' ? tk.text : formatValue(tk.key, pose))).join('');
}
