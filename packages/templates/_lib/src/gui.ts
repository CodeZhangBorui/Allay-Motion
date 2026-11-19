// 界面像素布局。还原游戏界面的模板按“界面像素”摆东西：一个界面像素 = scale 个设计单位，
// 原点在界面左上角、y 向下（和游戏的界面坐标一样）；舞台的原点在中心、y 向上（02-engine.md 2.5）。
import type { StageInfo } from '@allay/template-sdk';

export type Anchor = 'topLeft' | 'top' | 'topRight' | 'left' | 'center' | 'right' | 'bottomLeft' | 'bottom' | 'bottomRight';

export interface GuiRect {
  /** 中心，设计单位 */
  x: number;
  y: number;
  /** 设计单位 */
  width: number;
  height: number;
}

export interface GuiLayout {
  /** 一个界面像素对应多少设计单位 */
  scale: number;
  /** 界面的宽高，界面像素（可以不是整数；要整数的地方照游戏代码自己取整） */
  width: number;
  height: number;
  /** 界面坐标 → 舞台坐标 */
  x(gx: number): number;
  y(gy: number): number;
  /** 左上角在 (gx, gy)、宽高 (gw, gh) 的矩形 → 舞台里的中心和大小（精灵、文字都以中心定位） */
  rect(gx: number, gy: number, gw: number, gh: number): GuiRect;
}

type StageSize = Pick<StageInfo, 'width' | 'height'>;

export function guiLayout(stage: StageSize, scale: number): GuiLayout {
  const s = Math.max(1e-3, scale);
  const x = (gx: number) => -stage.width / 2 + gx * s;
  const y = (gy: number) => stage.height / 2 - gy * s;
  return {
    scale: s,
    width: stage.width / s,
    height: stage.height / s,
    x,
    y,
    rect: (gx, gy, gw, gh) => ({ x: x(gx + gw / 2), y: y(gy + gh / 2), width: gw * s, height: gh * s }),
  };
}

/**
 * 放得下的界面缩放：面板（界面像素）连同边距（设计单位）超出舞台时按比例缩小，
 * 三种画幅都成立（04-templates.md 4.6 第 5 条；advancement-toast 的做法）。
 */
export function fitScale(stage: StageSize, scale: number, panelWidth: number, panelHeight: number, margin = 0): number {
  return Math.max(0.1, Math.min(scale, (stage.width - 2 * margin) / panelWidth, (stage.height - 2 * margin) / panelHeight));
}

/** 宽高 (gw, gh) 的面板按停靠位置摆放时左上角的界面坐标；margin 是界面像素 */
export function anchorTopLeft(layout: Pick<GuiLayout, 'width' | 'height'>, anchor: Anchor, gw: number, gh: number, margin = 0): { x: number; y: number } {
  const left = anchor === 'topLeft' || anchor === 'left' || anchor === 'bottomLeft';
  const right = anchor === 'topRight' || anchor === 'right' || anchor === 'bottomRight';
  const top = anchor === 'topLeft' || anchor === 'top' || anchor === 'topRight';
  const bottom = anchor === 'bottomLeft' || anchor === 'bottom' || anchor === 'bottomRight';
  return {
    x: left ? margin : right ? layout.width - gw - margin : (layout.width - gw) / 2,
    y: top ? margin : bottom ? layout.height - gh - margin : (layout.height - gh) / 2,
  };
}
