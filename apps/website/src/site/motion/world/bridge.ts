// 页面（DOM 里的逻辑）和 3D 世界之间交换的几样东西。都是模块级的可变对象：每帧读写，不经过 React。

/** 悦灵在 3D 世界里画（带路的逻辑仍在 AllayGuide 里算：落点、弹簧、朝向、动作） */
export const allay3d: {
  /** 世界已经装好悦灵的图集；为假时 AllayGuide 照旧用 DOM 里的 <Allay> */
  ready: boolean;
  /** 这一帧悦灵在哪（视口坐标、CSS 像素）、多大、画图集的第几帧；不出场时为 null */
  state: { x: number; y: number; size: number; frame: number; facing: 1 | -1; tilt: number } | null;
} = { ready: false, state: null };
