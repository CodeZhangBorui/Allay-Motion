// 骨架屏上的飞舞路径（docs/07-allay-mascot.md 7.6 A）。纯函数：给区域尺寸和进场后的秒数，算悦灵的位置、朝向、倾斜和动作。

export interface FlightArea {
  w: number;
  h: number;
}

export interface FlightPose {
  x: number;
  y: number;
  /** 1 朝右，-1 朝左 */
  facing: 1 | -1;
  /** 度，与水平速度成正比，不超过 ±10° */
  tilt: number;
  clip: 'fly' | 'hover';
}

/** 悦灵尺寸 S = clamp(h × 0.22, 48, 96) */
export function flightSize(h: number): number {
  return Math.min(96, Math.max(48, h * 0.22));
}

/** 进场：从区域左侧外面飞入，320 ms 到达路径起点 */
export const ENTER_MS = 320;

export function flightPose(area: FlightArea, tau: number): FlightPose {
  const { w, h } = area;
  const S = flightSize(h);
  const cx = w / 2;
  const cy = h / 2;
  const ax = Math.max(0, w / 2 - 24 - S / 2);
  const ay = Math.min(h * 0.18, 40);
  const wx = (2 * Math.PI) / 3.6;
  const wy = (2 * Math.PI) / 2.3;
  const x = cx + ax * Math.sin(wx * tau);
  const y = cy + ay * Math.sin(wy * tau + 0.6);
  const vx = ax * wx * Math.cos(wx * tau);
  const vmax = ax * wx || 1;
  const ratio = vx / vmax;
  return {
    x,
    y,
    facing: vx >= 0 ? 1 : -1,
    tilt: Math.max(-10, Math.min(10, ratio * 10)),
    // 水平速度大时用 fly，接近折返点时切到 hover
    clip: Math.abs(ratio) > 0.35 ? 'fly' : 'hover',
  };
}

/** 进场时的位置：从左侧外面（-S）缓出到路径起点 */
export function enterPose(area: FlightArea, ms: number): FlightPose {
  const start = flightPose(area, 0);
  const S = flightSize(area.h);
  const k = Math.min(1, ms / ENTER_MS);
  const e = 1 - (1 - k) ** 3;
  return { ...start, x: -S + (start.x + S) * e, facing: 1, tilt: 10 * (1 - e), clip: 'fly' };
}
