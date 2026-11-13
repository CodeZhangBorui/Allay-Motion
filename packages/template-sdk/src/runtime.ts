// 模板运行时契约（docs/04-templates.md 4.5）。只有类型，没有运行时代码。
// M1 只实现了 ctx 的一部分：THREE、params、stage、scene、camera、setCamera、createStageCamera、
// resources.texture、random、noise2D、ease、math、time、audio.cue、warn。
// 方块、物品、文字、精灵（resources.block / item、text、sprite）在 M2 加入。
import type * as THREE from 'three';

/** 参数值。具体类型由 manifest 的参数定义决定（4.4） */
export type ParamValue = number | string | boolean | null | ParamValue[] | { [key: string]: ParamValue };
export type ParamValues = Record<string, ParamValue>;

export interface StageInfo {
  /** 设计单位：短边恒为 1080（02-engine.md 2.5） */
  width: number;
  height: number;
  aspect: number;
  fps: number;
  /** 输出短边像素 / 1080 */
  pixelScale: number;
}

export interface Rng {
  /** [0, 1) */
  next(): number;
  /** [a, b) */
  range(a: number, b: number): number;
  /** [a, b] 内的整数 */
  int(a: number, b: number): number;
  pick<T>(items: readonly T[]): T;
  /** 原地打乱并返回同一个数组 */
  shuffle<T>(items: T[]): T[];
}

export type EaseFn = (x: number) => number;

export type EasingName =
  | 'linear'
  | 'quadIn' | 'quadOut' | 'quadInOut'
  | 'cubicIn' | 'cubicOut' | 'cubicInOut'
  | 'quartIn' | 'quartOut' | 'quartInOut'
  | 'quintIn' | 'quintOut' | 'quintInOut'
  | 'expoIn' | 'expoOut' | 'expoInOut'
  | 'circIn' | 'circOut' | 'circInOut'
  | 'backIn' | 'backOut' | 'backInOut'
  | 'elasticOut' | 'bounceOut';

/** easing 参数的值：预设名或三次贝塞尔控制点 */
export type EasingValue = EasingName | readonly [number, number, number, number];

export type EaseLibrary = Readonly<Record<EasingName, EaseFn>> & {
  bezier(x1: number, y1: number, x2: number, y2: number): EaseFn;
  /** 把 easing 参数的值变成函数；认不出的值退回 linear */
  from(value: unknown): EaseFn;
};

export interface MathHelpers {
  clamp(x: number, min: number, max: number): number;
  lerp(a: number, b: number, t: number): number;
  invLerp(a: number, b: number, x: number): number;
  remap(x: number, inMin: number, inMax: number, outMin: number, outMax: number): number;
  smoothstep(edge0: number, edge1: number, x: number): number;
}

export interface SetupContext {
  THREE: typeof THREE;
  params: Readonly<ParamValues>;
  stage: Readonly<StageInfo>;
  scene: THREE.Scene;
  camera: THREE.Camera;
  setCamera(camera: THREE.Camera): void;
  createStageCamera(opts: { fov: number }): THREE.PerspectiveCamera;
  resources: {
    /** 已设好过滤和色彩空间的贴图；缺失时返回占位图并记一条警告 */
    texture(id: string): Promise<THREE.Texture>;
  };
  random(key?: string): Rng;
  noise2D(x: number, y: number, key?: string): number;
  ease: EaseLibrary;
  math: MathHelpers;
  time: { segment(t: number, start: number, duration: number): number };
  audio: { cue(sound: string | null, at: number, opts?: { gain?: number; rate?: number; pan?: number }): void };
  warn(message: string): void;
}

export interface TemplateInstance {
  /** 秒，0.1–30 */
  duration: number;
  /** 转场类必填 */
  cutTime?: number | null;
  update(t: number): void;
  dispose?(): void;
}

/** 模板文件的默认导出 */
export interface TemplateModule {
  setup(ctx: SetupContext): TemplateInstance | Promise<TemplateInstance>;
}
