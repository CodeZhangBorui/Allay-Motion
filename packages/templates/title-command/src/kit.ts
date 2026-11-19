// 界面类模板的小工具：参数读取、可选贴图、成批的矩形（纯色或贴图的一块）、按界面坐标摆放、带 § 格式码的一行文字。
// 第 1 批（docs/templates/batch-1.md）的每个模板目录里各有一份逐字相同的副本：批次不能改 _lib，等主控沉淀进去后删掉这些副本。
// 只用 ctx 给的东西；不含任何模板自己的数值。
import type { FontStyle, ParamValue, SetupContext, TextObject } from '@allay/template-sdk';

type Three = SetupContext['THREE'];
type Texture = InstanceType<Three['Texture']>;
type Object3D = InstanceType<Three['Object3D']>;

export const num = (v: ParamValue | undefined, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
export const str = (v: ParamValue | undefined, fallback: string): string => (typeof v === 'string' ? v : fallback);
export const bool = (v: ParamValue | undefined, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);
export const fontOf = (v: ParamValue | undefined): FontStyle =>
  v && typeof v === 'object' && !Array.isArray(v) && typeof (v as { family?: unknown }).family === 'string' ? (v as unknown as FontStyle) : { family: 'minecraft:default' };
/** #RRGGBB（丢掉 alpha）；不合法时取 fallback */
export const rgbOf = (v: ParamValue | undefined, fallback: string): string => (typeof v === 'string' && /^#[0-9a-fA-F]{6}/.test(v) ? v.slice(0, 7) : fallback);
/** #RRGGBBAA 的 alpha（0–1）；没有 alpha 位时是 1 */
export const alphaOf = (v: ParamValue | undefined): number => (typeof v === 'string' && /^#[0-9a-fA-F]{8}$/.test(v) ? Number.parseInt(v.slice(7, 9), 16) / 255 : 1);
/** 多行文字参数 → 非空行（去掉行尾空白） */
export const linesOf = (v: ParamValue | undefined, max: number): string[] =>
  str(v, '')
    .split('\n')
    .map((l) => l.replace(/\s+$/, ''))
    .filter((l) => l.trim() !== '')
    .slice(0, max);

/** 按顺序试几个贴图 ID（新路径在前、旧路径在后），返回第一个有的和它的序号；都没有时是 null，不记警告 */
export async function firstTexture(ctx: SetupContext, ids: readonly string[]): Promise<{ texture: Texture; index: number } | null> {
  for (const [index, id] of ids.entries()) {
    const texture = await ctx.resources.texture(id, { optional: true });
    if (texture) return { texture, index };
  }
  return null;
}

/** 图集里的一块，单位是图集像素（按 256 × 256 的原版图集写；高清资源包按比例换算） */
export type Region = readonly [x: number, y: number, w: number, h: number];

/**
 * 界面坐标系：原点在界面左上角、y 向下，一个界面像素 = unit 个设计单位。
 * root 加到场景里；整体缩放、停靠由模板改 root 的 position 和 scale。
 */
export interface Gui {
  root: Object3D;
  unit: number;
  /** 把一个对象的原点放到界面坐标 (gx, gy) */
  put(obj: Object3D, gx: number, gy: number, z?: number): void;
  /** 文字：水平按它自己的 align 对到 gx，上边对到 gy（游戏里 drawString 的 y） */
  putText(text: TextObject, gx: number, gy: number, z?: number): void;
  /** 成批的矩形，一次绘制。texture 为 null 时画纯色 */
  quads(capacity: number, texture: Texture | null, z?: number): Quads;
}

export interface Quads {
  object: Object3D;
  /** 第 i 个矩形：左上角 (gx, gy)、宽高 (gw, gh)，界面像素 */
  rect(i: number, gx: number, gy: number, gw: number, gh: number): void;
  hide(i: number): void;
  /** 颜色（#RRGGBB）和不透明度；贴图矩形是与贴图相乘 */
  color(i: number, hex: string, alpha?: number): void;
  /** 贴图的一块；atlas 是图集的逻辑边长（默认 256） */
  region(i: number, region: Region, atlas?: number): void;
  /** 贴图坐标（0–1，v 从上往下） */
  uv(i: number, u0: number, v0: number, u1: number, v1: number): void;
  /** 改完之后调用一次 */
  commit(): void;
  setOpacity(a: number): void;
  dispose(): void;
}

export function createGui(ctx: SetupContext, unit: number): Gui {
  const { THREE } = ctx;
  const root = new THREE.Object3D();
  ctx.scene.add(root);
  const scratch = new THREE.Color();
  return {
    root,
    unit,
    put(obj, gx, gy, z = 0) {
      obj.position.set(gx * unit, -gy * unit, z);
      root.add(obj);
    },
    putText(text, gx, gy, z = 0) {
      text.object.position.set(gx * unit, -gy * unit - text.height / 2, z);
      root.add(text.object);
    },
    quads(capacity, texture, z = 0) {
      const n = Math.max(1, capacity);
      const pos = new Float32Array(n * 12);
      const col = new Float32Array(n * 16).fill(1);
      const uvs = new Float32Array(n * 8);
      const index: number[] = [];
      for (let i = 0; i < n; i++) {
        // 左上、左下、右下、右上
        uvs.set([0, 1, 0, 0, 1, 0, 1, 1], i * 8);
        index.push(i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3);
      }
      const geometry = new THREE.BufferGeometry();
      const posAttr = new THREE.BufferAttribute(pos, 3);
      const colAttr = new THREE.BufferAttribute(col, 4);
      const uvAttr = new THREE.BufferAttribute(uvs, 2);
      geometry.setAttribute('position', posAttr);
      geometry.setAttribute('color', colAttr);
      geometry.setAttribute('uv', uvAttr);
      geometry.setIndex(index);
      const material = new THREE.MeshBasicMaterial({ ...(texture ? { map: texture } : {}), vertexColors: true, transparent: true, depthWrite: false });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.frustumCulled = false;
      mesh.position.z = z;
      root.add(mesh);
      const setUv = (i: number, u0: number, v0: number, u1: number, v1: number) => {
        // 引擎的贴图 v = 1 是顶部
        uvs.set([u0, 1 - v0, u0, 1 - v1, u1, 1 - v1, u1, 1 - v0], i * 8);
        uvAttr.needsUpdate = true;
      };
      return {
        object: mesh,
        rect(i, gx, gy, gw, gh) {
          const x0 = gx * unit;
          const x1 = (gx + gw) * unit;
          const y0 = -gy * unit;
          const y1 = -(gy + gh) * unit;
          pos.set([x0, y0, 0, x0, y1, 0, x1, y1, 0, x1, y0, 0], i * 12);
        },
        hide(i) {
          pos.fill(0, i * 12, i * 12 + 12);
        },
        color(i, hex, alpha = 1) {
          scratch.set(hex);
          for (let k = 0; k < 4; k++) col.set([scratch.r, scratch.g, scratch.b, alpha], i * 16 + k * 4);
        },
        region(i, [x, y, w, h], atlas = 256) {
          setUv(i, x / atlas, y / atlas, (x + w) / atlas, (y + h) / atlas);
        },
        uv: setUv,
        commit() {
          posAttr.needsUpdate = true;
          colAttr.needsUpdate = true;
        },
        setOpacity(a) {
          material.opacity = Math.min(1, Math.max(0, Number.isFinite(a) ? a : 0));
        },
        dispose() {
          geometry.dispose();
          material.dispose();
        },
      };
    },
  };
}

/** 聊天格式码的 16 种颜色（§0–§f） */
export const CHAT_COLORS: Readonly<Record<string, string>> = {
  '0': '#000000',
  '1': '#0000AA',
  '2': '#00AA00',
  '3': '#00AAAA',
  '4': '#AA0000',
  '5': '#AA00AA',
  '6': '#FFAA00',
  '7': '#AAAAAA',
  '8': '#555555',
  '9': '#5555FF',
  a: '#55FF55',
  b: '#55FFFF',
  c: '#FF5555',
  d: '#FF55FF',
  e: '#FFFF55',
  f: '#FFFFFF',
};

export interface Segment {
  text: string;
  color: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strikethrough: boolean;
}

/**
 * 把一行带格式码的文字拆成同样式的几段。格式码用 § 或 &（& 后面必须跟合法的码，否则当普通字符）：
 * 0–9、a–f 换颜色并清掉样式（和游戏一样），l 粗体、o 斜体、n 下划线、m 删除线、r 复原；k（乱码字）不支持，忽略。
 */
export function parseFormatted(line: string, base: Omit<Segment, 'text'>): Segment[] {
  const out: Segment[] = [];
  let style = { ...base };
  let buf = '';
  const flush = () => {
    if (buf !== '') out.push({ text: buf, ...style });
    buf = '';
  };
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    const code = line[i + 1]?.toLowerCase();
    if ((ch === '§' || ch === '&') && code !== undefined && /^[0-9a-fk-or]$/.test(code)) {
      flush();
      i++;
      if (CHAT_COLORS[code]) style = { color: CHAT_COLORS[code], bold: false, italic: false, underline: false, strikethrough: false };
      else if (code === 'l') style.bold = true;
      else if (code === 'o') style.italic = true;
      else if (code === 'n') style.underline = true;
      else if (code === 'm') style.strikethrough = true;
      else if (code === 'r') style = { ...base };
      continue;
    }
    if (ch === '§') continue;
    buf += ch;
  }
  flush();
  return out;
}

/** 去掉格式码后的纯文字 */
export const plainText = (line: string): string =>
  parseFormatted(line, { color: '#FFFFFF', bold: false, italic: false, underline: false, strikethrough: false })
    .map((s) => s.text)
    .join('');

export interface RichText {
  object: Object3D;
  /** 设计单位 */
  width: number;
  height: number;
  setOpacity(a: number): void;
}

/**
 * 一行多色文字：每段一个文字对象，按宽度从左往右拼（文字接口还不支持一段里多种颜色，docs/template-catalog.md P6）。
 * 原点在左边、垂直在中线（和 TextObject 的 align: 'left' 一样）。不换行。
 */
export function richText(ctx: SetupContext, segments: readonly Segment[], size: number, font: FontStyle, shadow: boolean): RichText {
  const group = new ctx.THREE.Object3D();
  const parts: TextObject[] = [];
  let x = 0;
  let height = 0;
  for (const s of segments) {
    const t = ctx.text.create({
      text: s.text,
      size,
      color: s.color,
      align: 'left',
      // 字体参数里打开的样式优先；格式码只能再加样式
      font: { ...font, bold: font.bold === true || s.bold, italic: font.italic === true || s.italic, underline: font.underline === true || s.underline, strikethrough: font.strikethrough === true || s.strikethrough, shadow: font.shadow ?? shadow },
    });
    t.object.position.x = x;
    group.add(t.object);
    parts.push(t);
    // 只有空格的一段宽度也要算：文字对象的宽度不含行尾空格，按空格数补（原版字体的空格宽 4）
    const trailing = s.text.length - s.text.replace(/ +$/, '').length;
    x += (s.text.trim() === '' ? 0 : t.width) + trailing * 4 * size;
    height = Math.max(height, t.height);
  }
  return {
    object: group,
    width: x,
    height,
    setOpacity(a) {
      for (const p of parts) p.setOpacity(a);
    },
  };
}
