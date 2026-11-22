// 模板接口的类型定义（自包含，不依赖任何包）。
// 由 pnpm templates:api 从 packages/template-sdk/src/runtime.ts 和 scripts/template-api/three-surface.d.ts 生成，不要直接改。
//
// 用法：放在模板文件夹里，与 template.js 同级；在 template.js 的默认导出上加
//   /** @type {import('./template-api').TemplateModule} */
// 编辑器就能对 ctx 补全。ctx.THREE 只声明了模板常用的类和成员（与真实的 three.js 兼容），
// 没列出的成员运行时照样可用，只是没有补全。

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
  /** 从数组里等概率取一个 */
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
  /** 把 x 钳制到 [min, max] */
  clamp(x: number, min: number, max: number): number;
  /** a + (b − a) × t */
  lerp(a: number, b: number, t: number): number;
  /** lerp 的反函数：(x − a) / (b − a) */
  invLerp(a: number, b: number, x: number): number;
  /** 把 x 从 [inMin, inMax] 线性映射到 [outMin, outMax] */
  remap(x: number, inMin: number, inMax: number, outMin: number, outMax: number): number;
  /** x 在 [edge0, edge1] 之间的平滑过渡（三次 Hermite），两端钳制到 0 和 1 */
  smoothstep(edge0: number, edge1: number, x: number): number;
}

export interface SetupContext {
  /** three.js（r187）。只声明了常用的类和成员，见本文件末尾的 THREE 命名空间；没列出的成员运行时照样可用 */
  THREE: typeof THREE;
  /** 参数值（manifest 的 params 声明）。已经清洗过：类型不对的回到默认值，越界的钳制，缺的补默认值 */
  params: Readonly<ParamValues>;
  /** 舞台：设计单位下的宽高（短边恒为 1080，原点在中心，+y 向上）、宽高比、帧率、像素比例 */
  stage: Readonly<StageInfo>;
  /** 往里加东西的场景。setup 结束后引擎回收场景里剩下的几何体和材质 */
  scene: THREE.Scene;
  /** 当前相机。默认是正交相机，刚好覆盖整个舞台 */
  camera: THREE.Camera;
  /** 换相机（比如换成 createStageCamera 建的透视相机） */
  setCamera(camera: THREE.Camera): void;
  /** 建一台透视相机（fov 是垂直视角，度），位置已算好，z = 0 平面恰好填满舞台 */
  createStageCamera(opts: { fov: number }): THREE.PerspectiveCamera;
  /** 贴图、方块、物品。都在 setup 里 await 完，update 里不要再取 */
  resources: {
    /** 已设好过滤和色彩空间的贴图；缺失时返回占位图并记一条警告。.mcmeta 动画由引擎按 t 自动播放 */
    texture(id: string): Promise<THREE.Texture>;
    /**
     * 可选贴图：资源栈里没有时返回 null，不记警告。用来按游戏版本依次试几个路径
     * （例如先试 1.20.2 起的 gui/sprites/…，没有再退回旧的图集），或者在缺素材时换一种画法
     */
    texture(id: string, opts: { optional: true }): Promise<THREE.Texture | null>;
    /** 方块目录里的方块；不认识的 ID 用占位贴图的立方体并记一条警告 */
    block(id: string, opts?: { shading?: boolean }): Promise<BlockHandle>;
    /** 物品目录里的物品（方块 ID 按方块渲染）；不认识的 ID 用占位贴图并记一条警告 */
    item(id: string): Promise<ItemHandle>;
  };
  /** 用资源栈里的字体排一段文字 */
  text: { /** 建一个文字对象；字体已在 setup 之前载好，所以是同步的 */ create(opts: TextOptions): TextObject };
  /** 贴图四边形，可带九宫格 */
  sprite: { /** 用一张贴图建精灵；中心在原点 */ create(texture: THREE.Texture, opts?: SpriteOptions): SpriteObject };
  /** 带种子的随机数（种子取模板的 seed 参数）。同一个 key 总是给出同一串数，不同 key 互不影响。在 setup 里预先算好，update 里只查表 */
  random(key?: string): Rng;
  /** 带种子的连续二维噪声（simplex），值约在 [-1, 1]；同样的输入总是同样的输出 */
  noise2D(x: number, y: number, key?: string): number;
  /** 缓动函数：预设名（如 ease.cubicInOut）、bezier(x1, y1, x2, y2)、from(easing 参数的值) */
  ease: EaseLibrary;
  /** 常用的数学小工具 */
  math: MathHelpers;
  /** 时间工具 */
  time: { /** t 在 [start, start + duration] 里的进度，钳制到 [0, 1] */ segment(t: number, start: number, duration: number): number };
  /** 音频提示 */
  audio: { /** 在时刻 at（秒）播放音效事件；只能在 setup 里调用。sound 为 null 时什么也不做 */ cue(sound: string | null, at: number, opts?: AudioCueOptions): void };
  /** 记一条警告，显示在应用里（一次装载最多 50 条） */
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
  /** 建 count 个实例（一次绘制）；用 setMatrix 等摆放，每帧改完调用一次 commit() */
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
  /** 实例个数 */
  count: number;
  /** 第 index 个实例的变换 */
  setMatrix(index: number, matrix: THREE.Matrix4): void;
  /** 0–1 */
  setOpacity(index: number, opacity: number): void;
  /** 第 index 个实例的染色（与贴图相乘） */
  setTint(index: number, color: THREE.ColorRepresentation): void;
  /** 一帧里改完所有实例后调用一次 */
  commit(): void;
}

/** 物品：高度为 1，厚度为 1/16，中心在原点 */
export interface ItemHandle {
  /** 一个物品的 3D 模型（有厚度的贴图） */
  single(): THREE.Object3D;
}

/**
 * 文字的字体和样式，也就是 font 参数的值（4.4）。family 的写法见 manifest 的 isFontFamily：
 * minecraft:default、minecraft:uniform、minecraft:alt、minecraft:illageralt 等资源栈里的字体，system:sans（系统字体），
 * user:<哈希>（用户导入的字体文件），以及随应用内嵌的 Unifont 的两种模式：
 * embedded:default（普通模式：Mojangles 优先，它没有的字形如中文用内嵌 Unifont）和
 * embedded:uniform（强制 Unicode 模式：所有字形都用内嵌 Unifont）。有没有原版素材、换不换机器，内嵌 Unifont 的字形都一样。样式与游戏的文字样式对应：粗体（向右重描一次）、斜体（错切）、下划线、删除线、
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
   * embedded:default、embedded:uniform 不看资源栈里的 unihex：中日韩等字形一律取内嵌的 Unifont，内嵌的也没有才用系统字体；
   * 没有原版素材时 embedded:default 等于全部用 Unifont。宿主没有内嵌字体（官网）时退回 minecraft:default 并记一条警告。
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
  /** 加到场景里 */
  object: THREE.Object3D;
  /** 设计单位 */
  width: number;
  height: number;
  /** 0–1 */
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
  /** 加到场景里 */
  object: THREE.Object3D;
  /** 设计单位 */
  setSize(width: number, height: number): void;
  /** 0–1 */
  setOpacity(opacity: number): void;
}

export interface TemplateInstance {
  /** 秒，0.1–30 */
  duration: number;
  /** 转场类必填 */
  cutTime?: number | null;
  /** 把画面摆到时刻 t（秒）。只能依赖 t 和 setup 时建立的状态；引擎可能按任意顺序、多次调用 */
  update(t: number): void;
  /** 释放 setup 里自己创建的几何体、材质、贴图 */
  dispose?(): void;
}

/** 模板文件的默认导出 */
export interface TemplateModule {
  /** 建场景、取资源、预先算好随机数，返回实例。可以是 async 的 */
  setup(ctx: SetupContext): TemplateInstance | Promise<TemplateInstance>;
}

// ---- ctx.THREE 的最小类型面 ----

export declare namespace THREE {
  type ColorSpace = '' | 'srgb' | 'srgb-linear' | 'display-p3' | 'display-p3-linear';
  type ColorRepresentation = Color | string | number;

  const SRGBColorSpace: 'srgb';
  const LinearSRGBColorSpace: 'srgb-linear';
  const NoColorSpace: '';

  const FrontSide: 0;
  const BackSide: 1;
  const DoubleSide: 2;
  type Side = 0 | 1 | 2;

  const NoBlending: 0;
  const NormalBlending: 1;
  const AdditiveBlending: 2;
  const SubtractiveBlending: 3;
  const MultiplyBlending: 4;
  type Blending = 0 | 1 | 2 | 3 | 4 | 5 | 6;

  const NearestFilter: 1003;
  const LinearFilter: 1006;
  const LinearMipmapLinearFilter: 1008;
  type MagnificationTextureFilter = 1003 | 1006;
  type MinificationTextureFilter = 1003 | 1004 | 1005 | 1006 | 1007 | 1008;

  const RepeatWrapping: 1000;
  const ClampToEdgeWrapping: 1001;
  const MirroredRepeatWrapping: 1002;
  type Wrapping = 1000 | 1001 | 1002;

  const UnsignedByteType: 1009;
  const FloatType: 1015;
  const HalfFloatType: 1016;
  const RedFormat: 1028;
  const RGFormat: 1030;
  const RGBAFormat: 1023;

  namespace MathUtils {
    const DEG2RAD: number;
    const RAD2DEG: number;
    function clamp(value: number, min: number, max: number): number;
    function lerp(x: number, y: number, t: number): number;
    function inverseLerp(x: number, y: number, value: number): number;
    function mapLinear(x: number, a1: number, a2: number, b1: number, b2: number): number;
    function smoothstep(x: number, min: number, max: number): number;
    function degToRad(degrees: number): number;
    function radToDeg(radians: number): number;
    function euclideanModulo(n: number, m: number): number;
  }

  class Vector2 {
    constructor(x?: number, y?: number);
    x: number;
    y: number;
    set(x: number, y: number): this;
    setScalar(scalar: number): this;
    copy(v: Vector2): this;
    clone(): Vector2;
    add(v: Vector2): this;
    sub(v: Vector2): this;
    multiplyScalar(s: number): this;
    lerp(v: Vector2, alpha: number): this;
    length(): number;
    normalize(): this;
    dot(v: Vector2): number;
  }

  class Vector3 {
    constructor(x?: number, y?: number, z?: number);
    x: number;
    y: number;
    z: number;
    set(x: number, y: number, z: number): this;
    setScalar(scalar: number): this;
    copy(v: Vector3): this;
    clone(): Vector3;
    add(v: Vector3): this;
    sub(v: Vector3): this;
    addVectors(a: Vector3, b: Vector3): this;
    subVectors(a: Vector3, b: Vector3): this;
    multiplyScalar(s: number): this;
    applyQuaternion(q: Quaternion): this;
    applyMatrix4(m: Matrix4): this;
    lerp(v: Vector3, alpha: number): this;
    lerpVectors(v1: Vector3, v2: Vector3, alpha: number): this;
    length(): number;
    normalize(): this;
    dot(v: Vector3): number;
    cross(v: Vector3): this;
  }

  class Vector4 {
    constructor(x?: number, y?: number, z?: number, w?: number);
    x: number;
    y: number;
    z: number;
    w: number;
    set(x: number, y: number, z: number, w: number): this;
    copy(v: Vector4): this;
    clone(): Vector4;
  }

  class Euler {
    constructor(x?: number, y?: number, z?: number, order?: 'XYZ' | 'YXZ' | 'ZXY' | 'ZYX' | 'YZX' | 'XZY');
    x: number;
    y: number;
    z: number;
    set(x: number, y: number, z: number, order?: 'XYZ' | 'YXZ' | 'ZXY' | 'ZYX' | 'YZX' | 'XZY'): this;
    copy(e: Euler): this;
  }

  class Quaternion {
    constructor(x?: number, y?: number, z?: number, w?: number);
    x: number;
    y: number;
    z: number;
    w: number;
    set(x: number, y: number, z: number, w: number): this;
    identity(): this;
    copy(q: Quaternion): this;
    setFromAxisAngle(axis: Vector3, angle: number): this;
    setFromEuler(euler: Euler): this;
    multiply(q: Quaternion): this;
    premultiply(q: Quaternion): this;
    slerp(qb: Quaternion, t: number): this;
  }

  class Matrix4 {
    constructor();
    elements: number[];
    identity(): this;
    copy(m: Matrix4): this;
    compose(position: Vector3, quaternion: Quaternion, scale: Vector3): this;
    decompose(position: Vector3, quaternion: Quaternion, scale: Vector3): this;
    multiply(m: Matrix4): this;
    premultiply(m: Matrix4): this;
    makeTranslation(x: number, y: number, z: number): this;
    makeRotationX(theta: number): this;
    makeRotationY(theta: number): this;
    makeRotationZ(theta: number): this;
    makeRotationAxis(axis: Vector3, angle: number): this;
    makeScale(x: number, y: number, z: number): this;
  }

  class Color {
    constructor(color?: ColorRepresentation);
    constructor(r: number, g: number, b: number);
    r: number;
    g: number;
    b: number;
    set(...args: [color: ColorRepresentation] | [r: number, g: number, b: number]): this;
    setRGB(r: number, g: number, b: number, colorSpace?: ColorSpace): this;
    setHSL(h: number, s: number, l: number, colorSpace?: ColorSpace): this;
    setStyle(style: string, colorSpace?: ColorSpace): this;
    copy(color: Color): this;
    clone(): Color;
    lerp(color: Color, alpha: number): this;
    multiplyScalar(s: number): this;
    getHex(colorSpace?: ColorSpace): number;
    getHexString(colorSpace?: ColorSpace): string;
  }

  class Object3D {
    constructor();
    readonly isObject3D: boolean;
    name: string;
    parent: Object3D | null;
    children: Object3D[];
    readonly position: Vector3;
    readonly rotation: Euler;
    readonly quaternion: Quaternion;
    readonly scale: Vector3;
    matrix: Matrix4;
    matrixAutoUpdate: boolean;
    visible: boolean;
    renderOrder: number;
    frustumCulled: boolean;
    userData: Record<string, unknown>;
    add(...object: Object3D[]): this;
    remove(...object: Object3D[]): this;
    clear(): this;
    traverse(callback: (object: Object3D) => unknown): void;
    lookAt(x: number, y: number, z: number): void;
    rotateX(angle: number): this;
    rotateY(angle: number): this;
    rotateZ(angle: number): this;
    updateMatrix(): void;
    /** 复制一份，recursive 默认为 true（连子对象一起复制）。Mesh 的副本和原件共用几何体和材质 */
    clone(recursive?: boolean): this;
  }

  class Group extends Object3D {
    constructor();
    readonly isGroup: boolean;
  }

  class Scene extends Object3D {
    constructor();
    readonly isScene: boolean;
  }

  class Camera extends Object3D {
    constructor();
    readonly isCamera: boolean;
  }

  class PerspectiveCamera extends Camera {
    constructor(fov?: number, aspect?: number, near?: number, far?: number);
    readonly isPerspectiveCamera: boolean;
    fov: number;
    aspect: number;
    near: number;
    far: number;
    zoom: number;
    updateProjectionMatrix(): void;
  }

  class OrthographicCamera extends Camera {
    constructor(left?: number, right?: number, top?: number, bottom?: number, near?: number, far?: number);
    readonly isOrthographicCamera: boolean;
    left: number;
    right: number;
    top: number;
    bottom: number;
    near: number;
    far: number;
    zoom: number;
    updateProjectionMatrix(): void;
  }

  type TypedArray = Int8Array | Uint8Array | Uint8ClampedArray | Int16Array | Uint16Array | Int32Array | Uint32Array | Float32Array | Float64Array;

  /** 从几何体里取出来的属性（getAttribute、getIndex 的结果）：只读着用 */
  interface GeometryAttribute {
    readonly count: number;
    readonly itemSize: number;
    needsUpdate: boolean;
    getX(index: number): number;
    getY(index: number): number;
    getZ(index: number): number;
    getW(index: number): number;
    setXYZ(index: number, x: number, y: number, z: number): this;
  }

  /** 顶点属性：自己建几何体时用（位置 3 个一组、uv 2 个一组、颜色 3 或 4 个一组）。改了 array 之后把 needsUpdate 设为 true */
  class BufferAttribute {
    constructor(array: TypedArray, itemSize: number, normalized?: boolean);
    array: TypedArray;
    readonly count: number;
    readonly itemSize: number;
    needsUpdate: boolean;
    getX(index: number): number;
    getY(index: number): number;
    getZ(index: number): number;
    getW(index: number): number;
    setX(index: number, x: number): this;
    setY(index: number, y: number): this;
    setXY(index: number, x: number, y: number): this;
    setXYZ(index: number, x: number, y: number, z: number): this;
    setXYZW(index: number, x: number, y: number, z: number, w: number): this;
  }

  /** 每个实例一份的属性（InstancedMesh 的矩阵和颜色，或自己写的实例化着色器的输入） */
  class InstancedBufferAttribute extends BufferAttribute {
    constructor(array: TypedArray, itemSize: number, normalized?: boolean, meshPerAttribute?: number);
    readonly isInstancedBufferAttribute: boolean;
  }

  class BufferGeometry {
    constructor();
    readonly isBufferGeometry: boolean;
    groups: Array<{ start: number; count: number; materialIndex?: number | undefined }>;
    getAttribute(name: string): GeometryAttribute | undefined;
    setAttribute(name: string, attribute: BufferAttribute): this;
    getIndex(): GeometryAttribute | null;
    /** 三角形的顶点序号；传数组时 three 自己选 16 位或 32 位 */
    setIndex(index: BufferAttribute | number[] | null): this;
    setDrawRange(start: number, count: number): void;
    computeBoundingBox(): void;
    computeBoundingSphere(): void;
    translate(x: number, y: number, z: number): this;
    scale(x: number, y: number, z: number): this;
    rotateX(angle: number): this;
    rotateY(angle: number): this;
    rotateZ(angle: number): this;
    dispose(): void;
  }

  class PlaneGeometry extends BufferGeometry {
    constructor(width?: number, height?: number, widthSegments?: number, heightSegments?: number);
  }

  class BoxGeometry extends BufferGeometry {
    constructor(width?: number, height?: number, depth?: number, widthSegments?: number, heightSegments?: number, depthSegments?: number);
  }

  class CircleGeometry extends BufferGeometry {
    constructor(radius?: number, segments?: number, thetaStart?: number, thetaLength?: number);
  }

  interface MaterialParameters {
    opacity?: number | undefined;
    transparent?: boolean | undefined;
    side?: Side | undefined;
    blending?: Blending | undefined;
    depthTest?: boolean | undefined;
    depthWrite?: boolean | undefined;
    alphaTest?: number | undefined;
    toneMapped?: boolean | undefined;
    vertexColors?: boolean | undefined;
  }

  class Material {
    constructor();
    readonly isMaterial: boolean;
    opacity: number;
    transparent: boolean;
    side: Side;
    blending: Blending;
    depthTest: boolean;
    depthWrite: boolean;
    alphaTest: number;
    toneMapped: boolean;
    vertexColors: boolean;
    visible: boolean;
    needsUpdate: boolean;
    dispose(): void;
  }

  interface MeshBasicMaterialParameters extends MaterialParameters {
    color?: ColorRepresentation | undefined;
    map?: Texture | null | undefined;
    alphaMap?: Texture | null | undefined;
  }

  class MeshBasicMaterial extends Material {
    constructor(parameters?: MeshBasicMaterialParameters);
    readonly isMeshBasicMaterial: boolean;
    color: Color;
    map: Texture | null;
    alphaMap: Texture | null;
  }

  interface IUniform<T = unknown> {
    value: T;
  }

  interface ShaderMaterialParameters extends MaterialParameters {
    uniforms?: { [uniform: string]: IUniform } | undefined;
    vertexShader?: string | undefined;
    fragmentShader?: string | undefined;
    defines?: { [key: string]: unknown } | undefined;
  }

  class ShaderMaterial extends Material {
    constructor(parameters?: ShaderMaterialParameters);
    readonly isShaderMaterial: boolean;
    uniforms: { [uniform: string]: IUniform };
    vertexShader: string;
    fragmentShader: string;
  }

  class Mesh extends Object3D {
    constructor(geometry?: BufferGeometry, material?: Material | Material[]);
    readonly isMesh: boolean;
    geometry: BufferGeometry;
    material: Material | Material[];
  }

  /**
   * 同一个几何体画很多份（一次绘制）。每帧用 setMatrixAt、setColorAt 改完后，
   * 把 instanceMatrix.needsUpdate（以及 instanceColor.needsUpdate）设为 true。方块用 ctx.resources.block().instanced() 更省事
   */
  class InstancedMesh extends Mesh {
    constructor(geometry: BufferGeometry | undefined, material: Material | Material[] | undefined, count: number);
    readonly isInstancedMesh: boolean;
    count: number;
    instanceMatrix: InstancedBufferAttribute;
    instanceColor: InstancedBufferAttribute | null;
    setMatrixAt(index: number, matrix: Matrix4): void;
    setColorAt(index: number, color: Color): void;
  }

  class Texture {
    readonly isTexture: boolean;
    /** 图像数据（类型与 three 一致是 unknown）。引擎给的贴图都有 width、height（像素），读之前自己断言类型 */
    image: unknown;
    magFilter: MagnificationTextureFilter;
    minFilter: MinificationTextureFilter;
    wrapS: Wrapping;
    wrapT: Wrapping;
    colorSpace: string;
    generateMipmaps: boolean;
    flipY: boolean;
    readonly offset: Vector2;
    readonly repeat: Vector2;
    needsUpdate: boolean;
    dispose(): void;
  }

  class DataTexture extends Texture {
    constructor(data?: ArrayBufferView | null, width?: number, height?: number, format?: number, type?: number);
    readonly isDataTexture: boolean;
  }
}
