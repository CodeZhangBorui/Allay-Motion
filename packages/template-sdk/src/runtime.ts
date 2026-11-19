// 模板运行时契约（docs/04-templates.md 4.5）。只有类型，没有运行时代码。
// M2 起 ctx 的方块、物品、文字、精灵（resources.block / item、text、sprite）都已实现。
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
    /** 已设好过滤和色彩空间的贴图；缺失时返回占位图并记一条警告。.mcmeta 动画由引擎按 t 自动播放 */
    texture(id: string): Promise<THREE.Texture>;
    /** 方块目录里的方块；不认识的 ID 用占位贴图的立方体并记一条警告 */
    block(id: string, opts?: { shading?: boolean }): Promise<BlockHandle>;
    /** 物品目录里的物品（方块 ID 按方块渲染）；不认识的 ID 用占位贴图并记一条警告 */
    item(id: string): Promise<ItemHandle>;
  };
  text: { create(opts: TextOptions): TextObject };
  sprite: { create(texture: THREE.Texture, opts?: SpriteOptions): SpriteObject };
  random(key?: string): Rng;
  noise2D(x: number, y: number, key?: string): number;
  ease: EaseLibrary;
  math: MathHelpers;
  time: { segment(t: number, start: number, duration: number): number };
  audio: { cue(sound: string | null, at: number, opts?: AudioCueOptions): void };
  warn(message: string): void;
}

/**
 * ctx.audio.cue 的选项。position 是可选的空间音效字段（2026-11 反馈）：声源相对听者的位置，单位是格（方块），
 * +x 右、+y 上、-z 正前方。宿主打开“空间音效”时按原版的规则处理：线性衰减（默认 16 格外听不到）、按左右方位定声像；
 * 只对单声道音效生效。模板自己决定画面怎样对应到格（例如把舞台的半宽当作 8 格、听者站在画面前 6 格）。
 * 不给 position 的 cue 和以前一样，不做空间处理。
 */
export interface AudioCueOptions {
  gain?: number;
  rate?: number;
  pan?: number;
  position?: { x: number; y: number; z: number };
}

/** 方块的六个面：上、下、北（-z）、南（+z，朝向默认相机）、东（+x）、西（-x） */
export type BlockFace = 'up' | 'down' | 'north' | 'south' | 'east' | 'west';

export interface BlockHandle {
  /** 边长为 1 的方块，中心在原点，模板自己缩放 */
  single(): THREE.Object3D;
  instanced(count: number): BlockInstances;
  /**
   * 方块某个面用的贴图（按方块目录；不含草方块侧面的叠加层，不带面明暗和着色），供着色器平铺等用途。
   * 返回引擎缓存里的贴图：模板不要释放它，也不要改它的属性（例如 wrapS）。
   */
  faceTexture(face: BlockFace): THREE.Texture;
}

export interface BlockInstances {
  /** 加到场景里 */
  object: THREE.Object3D;
  count: number;
  setMatrix(index: number, matrix: THREE.Matrix4): void;
  /** 0–1 */
  setOpacity(index: number, opacity: number): void;
  setTint(index: number, color: THREE.ColorRepresentation): void;
  /** 一帧里改完所有实例后调用一次 */
  commit(): void;
}

/** 物品：高度为 1，厚度为 1/16，中心在原点 */
export interface ItemHandle {
  single(): THREE.Object3D;
}

/**
 * 文字的字体和样式，也就是 font 参数的值（4.4）。family 的写法见 manifest 的 isFontFamily：
 * minecraft:default、minecraft:uniform、minecraft:alt、minecraft:illageralt 等资源栈里的字体，system:sans（系统字体），
 * user:<哈希>（用户导入的字体文件）。样式与游戏的文字样式对应：粗体（向右重描一次）、斜体（错切）、下划线、删除线、
 * 阴影（右下偏移、颜色 × 1/4），描边（发光墨囊告示牌的八方向描边；有描边时不画阴影）。
 */
export interface FontStyle {
  family: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
  shadow?: boolean;
  /** 描边颜色 #RRGGBB；null 或不给为不描边 */
  outline?: string | null;
}

export interface TextOptions {
  text: string;
  /** 一个字体像素对应多少设计单位 */
  size: number;
  /** #RRGGBB，默认白色 */
  color?: string;
  shadow?: boolean;
  align?: 'left' | 'center' | 'right';
  /** 设计单位；超过时按空格（中日韩字符逐字）换行 */
  maxWidth?: number;
  /**
   * 字体：字体族 ID，或者整个 font 参数的值。给对象时，对象里写了的样式优先于下面几个同名字段（用户在参数里选的为准）。
   * 不给时用 minecraft:default。资源栈里没有这个字体时退回 minecraft:default，缺的字形再退回系统字体；
   * 连 minecraft:default 都没有（没有原版素材）时整段用系统字体。
   * 只有出现在 font 参数里（含默认值）和 minecraft:default 的字体会在 setup 之前载入（system:sans 不用载入）；
   * 代码里临时写的其他字体族 ID 当作没载入，退回 minecraft:default 并记一条警告。
   */
  font?: string | FontStyle;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
  /** 描边颜色 #RRGGBB */
  outline?: string | null;
}

/** 文字对象。原点：水平方向按 align（左边、中点、右边），垂直方向在整段文字的中线 */
export interface TextObject {
  object: THREE.Object3D;
  /** 设计单位 */
  width: number;
  height: number;
  setOpacity(opacity: number): void;
}

export interface SpriteOptions {
  /** 九宫格边框 [左, 上, 右, 下]，单位是贴图像素。不给时用贴图 .mcmeta 里的 gui.scaling（若有） */
  nineSlice?: [number, number, number, number];
  /** 一个贴图像素对应多少设计单位，默认 1 */
  pixelSize?: number;
}

/** 精灵：中心在原点的贴图四边形 */
export interface SpriteObject {
  object: THREE.Object3D;
  /** 设计单位 */
  setSize(width: number, height: number): void;
  setOpacity(opacity: number): void;
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
