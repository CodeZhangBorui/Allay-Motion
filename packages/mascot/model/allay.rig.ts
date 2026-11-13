// 悦灵的骨架数学：姿态 → 每个部件的世界矩阵、盒子 → 面、取景、手部锚点。
//
// 纯函数，自己做 4×4 矩阵（列主序，与 three 的 Matrix4.elements 相同），不依赖 three 的运行时：
// 内部模板（引擎 Worker 里）用它摆姿态，烘焙脚本（Node）用同一份代码算手部锚点，两边结果一致。
// 会被打进内部模板，所以只导入同目录下同样不含运行时依赖的文件。
import { ALLAY_PARTS, ALLAY_TEXTURE_SIZE, HAND_TIPS, type ModelBox, type PartName } from './allay.model';
import { CLIPS, pose, restPose, type ClipName, type Pose, type Rot } from './allay.motions';

export type Mat4 = number[];
export type Vec3 = [number, number, number];

const DEG = Math.PI / 180;

export function identity(): Mat4 {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

export function multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Array<number>(16);
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + r]! * b[c * 4 + k]!;
      out[c * 4 + r] = s;
    }
  return out;
}

export function translation(x: number, y: number, z: number): Mat4 {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];
}

export function rotationX(a: number): Mat4 {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1];
}

export function rotationY(a: number): Mat4 {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1];
}

export function rotationZ(a: number): Mat4 {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

/** 游戏的部件旋转：Rz · Ry · Rx */
function rotationZYX(r: Rot): Mat4 {
  return multiply(rotationZ(r.z), multiply(rotationY(r.y), rotationX(r.x)));
}

export function transformPoint(m: Mat4, p: readonly number[]): Vec3 {
  const [x, y, z] = [p[0]!, p[1]!, p[2]!];
  return [
    m[0]! * x + m[4]! * y + m[8]! * z + m[12]!,
    m[1]! * x + m[5]! * y + m[9]! * z + m[13]!,
    m[2]! * x + m[6]! * y + m[10]! * z + m[14]!,
  ];
}

export function transformDirection(m: Mat4, d: readonly number[]): Vec3 {
  const [x, y, z] = [d[0]!, d[1]!, d[2]!];
  const v: Vec3 = [m[0]! * x + m[4]! * y + m[8]! * z, m[1]! * x + m[5]! * y + m[9]! * z, m[2]! * x + m[6]! * y + m[10]! * z];
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / len, v[1] / len, v[2] / len];
}

// ---- 取景 ----

/**
 * 全身图集的取景（7.3）：正交相机，悦灵朝右并朝镜头转约 28°（绕竖轴 90° − 28°），俯角 8°。
 * 相机固定看 −Z；转角和俯角作用在模型上，等价于转相机。half 是画面半边长（模型像素），
 * 所有动作共用同一个取景，切换动作时大小和位置不跳。
 */
export const BODY_VIEW = {
  yaw: (90 - 28) * DEG,
  pitch: 8 * DEG,
  /** 转动中心（模型坐标）：身体中部，dance 绕它转圈 */
  center: [0, 19.6, 0] as Vec3,
  /**
   * 画面中心相对转动中心的偏移（three 坐标，模型像素）。身体放在画面正中：dance 转圈时翅膀会扫到两侧，
   * 按全部动作全部帧的包围盒（x −10.6…10.5，y −7.2…6.5）取半边长 11.5，留出边距。
   */
  offset: [0, -0.4, 0] as Vec3,
  half: 11.5,
} as const;

export type View = { kind: 'body' } | { kind: 'head' };

/** 正面头像的取景：头的正面（5×5）恰好是 5k 个像素，左上角对齐整像素 */
export function headFraming(size: number, k: number): { left: number; right: number; top: number; bottom: number; offset: number } {
  const offset = Math.floor((size - 5 * k) / 2);
  const left = -2.5 - offset / k;
  const top = 2.5 + offset / k;
  return { left, right: left + size / k, top, bottom: top - size / k, offset };
}

/** 头像的整数放大倍数：不超过 size 的最大 5 的倍数 */
export function headScale(size: number): number {
  return Math.max(1, Math.floor(size / 5));
}

// ---- 姿态 ----

/** 模型坐标（Y 下、正面 −Z）→ three 坐标（Y 上、正面 +Z）：绕 X 转 180° */
const FLIP = rotationX(Math.PI);

/** 部件的世界矩阵（three 坐标，已经过取景变换：相机在原点看 −Z） */
export function partMatrices(p: Pose, view: View): Record<PartName, Mat4> {
  const local = new Map<PartName, Mat4>();
  const world = {} as Record<PartName, Mat4>;
  let viewMatrix: Mat4;
  if (view.kind === 'body') {
    const c = BODY_VIEW.center;
    viewMatrix = multiply(
      translation(-BODY_VIEW.offset[0], -BODY_VIEW.offset[1], -BODY_VIEW.offset[2]),
      multiply(rotationX(BODY_VIEW.pitch), multiply(rotationY(BODY_VIEW.yaw + p.spin), multiply(FLIP, translation(-c[0], -c[1], -c[2])))),
    );
  } else {
    // 头的正面中心放在原点
    const head = ALLAY_PARTS.find((x) => x.name === 'head')!;
    const root = ALLAY_PARTS.find((x) => x.name === 'root')!;
    const cy = root.pivot[1] + head.pivot[1] - 2.5;
    viewMatrix = multiply(FLIP, translation(0, -cy, 0));
  }
  for (const part of ALLAY_PARTS) {
    const r = part.name === 'root' ? p.root : (p[part.name] as Rot);
    const dy = part.name === 'root' ? p.rootDy : 0;
    const m = multiply(translation(part.pivot[0], part.pivot[1] + dy, part.pivot[2]), rotationZYX(r));
    const parent = part.parent ? local.get(part.parent)! : identity();
    const chained = multiply(parent, m);
    local.set(part.name, chained);
    world[part.name] = multiply(viewMatrix, chained);
  }
  return world;
}

export function clipPose(clip: ClipName, frame: number): Pose {
  return pose(clip, frame / 30);
}

export { restPose };

// ---- 盒子 → 面 ----

export interface Face {
  /** 四个顶点（部件坐标），逆时针 */
  positions: [Vec3, Vec3, Vec3, Vec3];
  /** 四个顶点的贴图坐标（像素，左上为原点） */
  uvs: [[number, number], [number, number], [number, number], [number, number]];
  /** 朝外的法线（部件坐标） */
  normal: Vec3;
  /** 宽度为 0 的盒子的侧面：两面都可见，明暗按 |n·L| */
  twoSided: boolean;
}

/**
 * 按游戏的盒子展开方式生成各面（上下面在第一行，西、北、东、南四个侧面在第二行）。
 * 面积为 0 的面不生成。镜像时左右对调、贴图水平翻转。
 */
export function boxFaces(b: ModelBox): Face[] {
  const [ox, oy, oz] = b.origin;
  const [w, h, d] = b.size;
  const g = b.grow;
  let x0 = ox - g;
  let x1 = ox + w + g;
  const y0 = oy - g;
  const y1 = oy + h + g;
  const z0 = oz - g;
  const z1 = oz + d + g;
  if (b.mirror) [x0, x1] = [x1, x0];
  const v7: Vec3 = [x0, y0, z0];
  const v0: Vec3 = [x1, y0, z0];
  const v1: Vec3 = [x1, y1, z0];
  const v2: Vec3 = [x0, y1, z0];
  const v3: Vec3 = [x0, y0, z1];
  const v4: Vec3 = [x1, y0, z1];
  const v5: Vec3 = [x1, y1, z1];
  const v6: Vec3 = [x0, y1, z1];
  const [u, v] = b.uv;
  const f4 = u;
  const f5 = u + d;
  const f6 = u + d + w;
  const f7 = u + d + w + w;
  const f8 = u + d + w + d;
  const f9 = u + d + w + d + w;
  const f10 = v;
  const f11 = v + d;
  const f12 = v + d + h;
  const twoSided = w === 0;
  const defs: [Vec3[], number, number, number, number, Vec3, boolean][] = [
    // 顶点，u1, v1, u2, v2，法线（模型坐标，Y 朝下），面积是否为 0
    [[v4, v3, v7, v0], f5, f10, f6, f11, [0, -1, 0], w === 0 || d === 0],
    [[v1, v2, v6, v5], f6, f11, f7, f10, [0, 1, 0], w === 0 || d === 0],
    [[v7, v3, v6, v2], f4, f11, f5, f12, [-1, 0, 0], d === 0 || h === 0],
    [[v0, v7, v2, v1], f5, f11, f6, f12, [0, 0, -1], w === 0 || h === 0],
    [[v5, v4, v0, v1], f6, f11, f8, f12, [1, 0, 0], d === 0 || h === 0],
    [[v3, v4, v5, v6], f8, f11, f9, f12, [0, 0, 1], w === 0 || h === 0],
  ];
  const faces: Face[] = [];
  for (const [verts, u1, vv1, u2, vv2, n, empty] of defs) {
    if (empty) continue;
    let positions = [verts[0]!, verts[1]!, verts[2]!, verts[3]!] as Face['positions'];
    let uvs: Face['uvs'] = [
      [u2, vv1],
      [u1, vv1],
      [u1, vv2],
      [u2, vv2],
    ];
    const normal: Vec3 = b.mirror ? [-n[0], n[1], n[2]] : n;
    if (b.mirror) {
      positions = [positions[3], positions[2], positions[1], positions[0]];
      uvs = [uvs[3], uvs[2], uvs[1], uvs[0]];
    }
    faces.push({ positions, uvs, normal, twoSided });
  }
  return faces;
}

// ---- 明暗 ----

/** 光从左上前方来（three 坐标，相机空间） */
export const LIGHT_DIR: Vec3 = (() => {
  const v: Vec3 = [-0.35, 0.8, 0.5];
  const len = Math.hypot(...v);
  return [v[0] / len, v[1] / len, v[2] / len];
})();
const AMBIENT = 0.58;

/** 面的亮度（线性，乘到贴图颜色上） */
export function faceShade(worldNormal: Vec3, twoSided: boolean): number {
  let d = worldNormal[0] * LIGHT_DIR[0] + worldNormal[1] * LIGHT_DIR[1] + worldNormal[2] * LIGHT_DIR[2];
  d = twoSided ? Math.abs(d) : Math.max(0, d);
  return AMBIENT + (1 - AMBIENT) * d;
}

// ---- 手部锚点 ----

/** 世界坐标（body 取景）→ 帧里的位置（占边长的比例，左上为原点） */
export function projectBody(p: Vec3): [number, number] {
  return [(p[0] + BODY_VIEW.half) / (2 * BODY_VIEW.half), (BODY_VIEW.half - p[1]) / (2 * BODY_VIEW.half)];
}

const round = (x: number, n: number): number => Math.round(x * 10 ** n) / 10 ** n;

/**
 * 捧东西的锚点（7.3 atlas.json 的 handAnchor）：两只手末端的中点，
 * x、y 是占帧边长的比例，角度（度，顺时针为正）取身体竖轴在画面上的倾斜。
 */
export function handAnchor(clip: ClipName, frame: number): [number, number, number] {
  const m = partMatrices(clipPose(clip, frame), { kind: 'body' });
  const r = transformPoint(m.rightArm, HAND_TIPS.rightArm);
  const l = transformPoint(m.leftArm, HAND_TIPS.leftArm);
  const [x, y] = projectBody([(r[0] + l[0]) / 2, (r[1] + l[1]) / 2, (r[2] + l[2]) / 2]);
  const top = transformPoint(m.body, [0, 0, 0]);
  const bottom = transformPoint(m.body, [0, 4, 0]);
  const dx = bottom[0] - top[0];
  const dy = -(bottom[1] - top[1]);
  const deg = (Math.atan2(-dx, dy) * 180) / Math.PI;
  return [round(x, 4), round(y, 4), round(deg, 2)];
}

/** 全部动作每一帧的锚点，顺序与图集一致 */
export function allHandAnchors(order: readonly ClipName[]): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (const clip of order) for (let i = 0; i < CLIPS[clip].frames; i++) out.push(handAnchor(clip, i));
  return out;
}

export { ALLAY_TEXTURE_SIZE };
