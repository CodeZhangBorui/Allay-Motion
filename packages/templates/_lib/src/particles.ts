// 闭式粒子的基础：每个粒子的出生时刻、寿命、初速度在 setup 里用 ctx.random 定好，
// update(t) 里用下面的闭式算位置，不做逐帧积分（硬性规则 2：画面是时间的纯函数）。

/** 粒子在时刻 t 的年龄（秒）；还没出生或已经死了返回 −1 */
export function ageAt(t: number, birth: number, life: number): number {
  const age = t - birth;
  return age < 0 || age > life ? -1 : age;
}

/**
 * 匀加速运动的位移：v0·age + ½·a·age²。
 * 重力向下时 a 取负值（舞台的 +y 向上）。
 */
export function ballistic(age: number, v0: number, acceleration: number): number {
  return v0 * age + 0.5 * acceleration * age * age;
}

/**
 * 带线性阻力的位移：速度按 e^(−drag·age) 衰减，位移 v0·(1 − e^(−drag·age)) / drag。
 * drag 趋近 0 时退化为 v0·age。
 */
export function dragged(age: number, v0: number, drag: number): number {
  if (drag < 1e-6) return v0 * age;
  return (v0 * (1 - Math.exp(-drag * age))) / drag;
}

/** 把“每刻把速度乘 friction”（每秒 20 刻）换算成 dragged() 用的每秒阻力系数 */
export function dragFromTickFriction(friction: number): number {
  return -20 * Math.log(Math.min(1, Math.max(1e-6, friction)));
}

/** 动画粒子贴图在年龄 age 时的帧序号：寿命内从第 0 帧均匀走到最后一帧 */
export function frameAt(age: number, life: number, frames: number): number {
  if (frames <= 1 || life <= 0) return 0;
  return Math.min(frames - 1, Math.max(0, Math.floor((age / life) * frames)));
}
