// 悦灵的四个动作（docs/07-allay-mascot.md 7.3）：程序化，都是时间的周期函数，首尾无缝。
//
// 每个动作里出现的所有频率都是“1 / 时长”的整数倍，所以 pose(clip, t) 与 pose(clip, t + 时长) 完全相同；
// 图集里一段动作取 t = 0, 1/30, …, (帧数 − 1)/30，末帧的下一帧正好回到首帧。
// 纯函数：不读时间、不用随机数、不依赖调用顺序。会被打进内部模板，所以不导入任何东西。

export type ClipName = 'hover' | 'fly' | 'dance' | 'sad';

export const FPS = 30;

/** 动作的顺序就是图集里的顺序 */
export const CLIP_ORDER: readonly ClipName[] = ['hover', 'fly', 'dance', 'sad'];

/** 时长（秒）与帧数（30 fps） */
export const CLIPS: Readonly<Record<ClipName, { duration: number; frames: number }>> = {
  hover: { duration: 1.5, frames: 45 },
  fly: { duration: 0.8, frames: 24 },
  dance: { duration: 2.0, frames: 60 },
  sad: { duration: 1.0, frames: 30 },
};

/** 欧拉角（弧度），按游戏的 ZYX 顺序作用，模型坐标（Y 朝下、正面 −Z） */
export interface Rot {
  x: number;
  y: number;
  z: number;
}

export interface Pose {
  /** 整体沿模型 Y 的位移（模型像素，正数向下） */
  rootDy: number;
  root: Rot;
  head: Rot;
  body: Rot;
  rightArm: Rot;
  leftArm: Rot;
  rightWing: Rot;
  leftWing: Rot;
  /** 绕竖轴的额外转角（弧度，three 坐标），dance 转圈用 */
  spin: number;
}

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
const rot = (x = 0, y = 0, z = 0): Rot => ({ x, y, z });
/** 一个周期里转 n 圈的正弦：n 必须是整数，保证首尾无缝 */
const wave = (p: number, n: number, phase = 0): number => Math.sin(TAU * n * p + phase);

/** 翅膀：基础张开角（原版是向外 45°、向上 25°），flap 是绕竖轴的扇动 */
function wings(spread: number, lift: number, flap: number): Pick<Pose, 'rightWing' | 'leftWing'> {
  return { rightWing: rot(lift, -spread + flap, 0), leftWing: rot(lift, spread - flap, 0) };
}

/** 动作的姿态。t 可以是任意实数，按时长取模 */
export function pose(clip: ClipName, t: number): Pose {
  const { duration } = CLIPS[clip];
  let p = (t % duration) / duration;
  if (p < 0) p += 1;
  switch (clip) {
    case 'hover':
      // 1.5 s：上下浮动一个来回；翅膀 4 Hz（6 次）±22°；手臂轻摆；身体小幅左右转
      return {
        rootDy: -0.5 * wave(p, 1),
        root: rot(0.04 * wave(p, 1, 1.2), 6 * DEG * wave(p, 1), 0),
        head: rot(0.06 * wave(p, 1, 2.0), -3 * DEG * wave(p, 1), 0),
        body: rot(),
        rightArm: rot(-0.45 + 0.1 * wave(p, 1, 0.5), 0, 0.06 + 0.03 * wave(p, 2)),
        leftArm: rot(-0.45 + 0.1 * wave(p, 1, 0.5 + Math.PI), 0, -0.06 - 0.03 * wave(p, 2)),
        ...wings(45 * DEG, 25 * DEG, 22 * DEG * wave(p, 6)),
        spin: 0,
      };
    case 'fly':
      // 0.8 s：身体前倾 18°；翅膀 7.5 Hz（6 次）±32°；手臂向后收
      return {
        rootDy: -0.25 * wave(p, 2),
        root: rot(18 * DEG + 2 * DEG * wave(p, 2, 0.8), 0, 0),
        head: rot(-0.2, 0, 0),
        body: rot(),
        rightArm: rot(0.55 + 0.08 * wave(p, 2), 0, 0.1),
        leftArm: rot(0.55 + 0.08 * wave(p, 2, 0.4), 0, -0.1),
        ...wings(50 * DEG, 20 * DEG, 32 * DEG * wave(p, 6)),
        spin: 0,
      };
    case 'dance':
      // 2.0 s：绕竖轴转一整圈，同时左右摇摆两个来回，手臂上举交替挥动，跟着节拍轻跳
      return {
        rootDy: -0.35 * (1 - Math.cos(TAU * 4 * p)),
        root: rot(0, 0, 10 * DEG * wave(p, 2)),
        head: rot(0, 0, 0.12 * wave(p, 2, Math.PI / 2)),
        body: rot(),
        rightArm: rot(-2.6 + 0.25 * wave(p, 4), 0, 0.25),
        leftArm: rot(-2.6 + 0.25 * wave(p, 4, Math.PI), 0, -0.25),
        ...wings(45 * DEG, 25 * DEG, 22 * DEG * wave(p, 8)),
        spin: TAU * p,
      };
    case 'sad':
      // 1.0 s：低头，翅膀下垂慢扇（1 次 ±10°），缓慢浮动，手臂垂下
      return {
        rootDy: -0.35 * wave(p, 1),
        root: rot(6 * DEG, 0, 0),
        head: rot(0.35 + 0.04 * wave(p, 1, 1.0), 0, 0),
        body: rot(),
        rightArm: rot(-0.05 + 0.04 * wave(p, 1), 0, 0.04),
        leftArm: rot(-0.05 + 0.04 * wave(p, 1, Math.PI), 0, -0.04),
        ...wings(30 * DEG, -12 * DEG, 10 * DEG * wave(p, 1)),
        spin: 0,
      };
  }
}

/** 头像用的静止姿态 */
export function restPose(): Pose {
  return {
    rootDy: 0,
    root: rot(),
    head: rot(),
    body: rot(),
    rightArm: rot(),
    leftArm: rot(),
    rightWing: rot(),
    leftWing: rot(),
    spin: 0,
  };
}
