// 013 方块冲镜的纯函数部分：方块的尺寸和取景、飞来和飞走的路径、撞上镜头时的晃动。
// 不依赖 ctx，验收测试直接导入（tests/unit/T-TPL-C013.block-punch.test.ts）。

/** 撞上镜头时方块的面比画面大多少（晃动时也盖得住） */
export const OVERSCAN = 1.14;
/** 晃动的最大角度（度），impactShake = 1 时 */
export const SHAKE_DEGREES = 2.5;
/** 晃动的频率（赫兹）和衰减（1 / 秒） */
export const SHAKE_HZ = 11;
export const SHAKE_DECAY = 7;

export type Framing = 'center' | 'top' | 'bottom';
export const FRAMINGS: readonly Framing[] = ['center', 'top', 'bottom'];

export type Face = 'side' | 'top' | 'bottom';
export const FACES: readonly Face[] = ['side', 'top', 'bottom'];

/**
 * 方块的边长和撞上时方块中心的竖直位置（设计单位）：边长 = 长边 × OVERSCAN；
 * 面比画面高时，top 让面的上沿留在画面上方一点（看得到草方块侧面上沿的草），bottom 反过来，center 居中。
 */
export function impactLayout(width: number, height: number, framing: Framing): { size: number; y: number } {
  const size = Math.max(width, height) * OVERSCAN;
  const slack = (size - height) / 2;
  // 上下各留边长的 4%：晃动时不露边
  const keep = Math.min(slack, size * 0.04);
  const y = framing === 'top' ? -(slack - keep) : framing === 'bottom' ? slack - keep : 0;
  return { size, y };
}

/** 相机离 z = 0 平面的距离：垂直视角 fov 下 z = 0 平面恰好填满舞台高度（同 ctx.createStageCamera） */
export function cameraDistance(height: number, fovDeg: number): number {
  return height / 2 / Math.tan((fovDeg * Math.PI) / 360);
}

/**
 * 飞来的起点（方块中心）：在 approach 方向（画面上的角度，0° 右、90° 上、180° 左、270° 下）的画外，
 * 离相机 far 远；投影下中心离画面中心 reach 个设计单位（在画外）。
 */
export function approachStart(approachDeg: number, width: number, height: number, size: number, distance: number, far: number): { x: number; y: number; z: number } {
  const a = (approachDeg * Math.PI) / 180;
  // 最近那个面的投影比例（算方块投影后有多大，偏大）和中心的投影比例（算中心投影到哪）
  const kFront = distance / (distance + far);
  const kCenter = distance / (distance + far + size / 2);
  // 半个画面（沿这个方向）+ 转着的方块投影后的半径（√3 / 2 个边长）+ 一点余量：起点整个在画外
  const half = Math.abs(Math.cos(a)) * (width / 2) + Math.abs(Math.sin(a)) * (height / 2);
  const reach = half + size * kFront * 0.87 + 40;
  return { x: (Math.cos(a) * reach) / kCenter, y: (Math.sin(a) * reach) / kCenter, z: -far - size / 2 };
}

/** 撞上之后的晃动角（弧度）：衰减的正弦，τ 是撞上之后的秒数 */
export function shakeAngle(tau: number, amount: number): number {
  if (tau <= 0 || amount <= 0) return 0;
  return ((SHAKE_DEGREES * Math.PI) / 180) * amount * Math.exp(-SHAKE_DECAY * tau) * Math.sin(2 * Math.PI * SHAKE_HZ * tau);
}

/**
 * 飞走：方块中心从撞上时的位置往相机方向冲，同时沿 exit 方向（approach 的反方向，接着来时的势头）侧移，
 * 侧移得比前进快：前面经过相机平面时方块已经整块偏到相机旁边，不会从相机里穿过去（那样会一帧之间整块消失）。
 * q 是退出进度（0–1，已缓动）。返回中心的 (x, y, z)。
 */
export function exitPath(q: number, from: { x: number; y: number; z: number }, approachDeg: number, size: number, distance: number): { x: number; y: number; z: number } {
  const a = ((approachDeg + 180) * Math.PI) / 180;
  const lateral = 1.4 * size * Math.pow(q, 0.7);
  return {
    x: from.x + Math.cos(a) * lateral,
    y: from.y + Math.sin(a) * lateral,
    z: from.z + (distance + 1.5 * size) * Math.pow(q, 1.5),
  };
}
