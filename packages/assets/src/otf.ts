// 点阵 OTF（GNU Unifont 的 OpenType 版本）还原成点阵：docs/03-assets.md 3.9“内嵌 Unifont”。
// Unifont 的 OTF 是把每个点阵像素画成一个正方形的 CFF 轮廓（每 em 64 单位，一个像素 4 单位，上升 14 像素、下降 2 像素）。
// 这里只实现读它需要的部分：sfnt 表目录、cmap（格式 4、12）、hmtx、CFF（含 CID 字体的 FDArray / FDSelect、子程序）和
// Type 2 charstring 的绘制指令；按像素中心做非零环绕采样，得到和 .hex 一样的 8 或 16 列 × 16 行点阵。
// 纯计算、不依赖画布和系统字体，同一个文件在任何机器上结果都相同。
import { parseUnihex, type UnihexOverride, type UnihexTables } from './font';

/** 一个点阵像素是多少字体单位（Unifont：每 em 64 单位、16 像素） */
const UNITS_PER_PIXEL = 4;
const ROWS = 16;
/** 基线以上的像素行数 */
const ASCENT_PX = 14;

export class OtfParseError extends Error {
  override name = 'OtfParseError';
}

interface Table {
  off: number;
  len: number;
}

function tables(b: DataView): Map<string, Table> {
  const tag = b.getUint32(0);
  // 'OTTO'（CFF 轮廓）
  if (tag !== 0x4f54544f) throw new OtfParseError('not a CFF-flavored OpenType font');
  const n = b.getUint16(4);
  const out = new Map<string, Table>();
  for (let i = 0; i < n; i++) {
    const o = 12 + i * 16;
    const name = String.fromCharCode(b.getUint8(o), b.getUint8(o + 1), b.getUint8(o + 2), b.getUint8(o + 3));
    const off = b.getUint32(o + 8);
    const len = b.getUint32(o + 12);
    if (off + len > b.byteLength) throw new OtfParseError(`table ${name} out of range`);
    out.set(name, { off, len });
  }
  return out;
}

/** cmap：码位 → 字形号。取 (3,10) 格式 12，没有时取 (3,1) 或 (0,*) 格式 4 */
function readCmap(b: DataView, t: Table): Map<number, number> {
  const n = b.getUint16(t.off + 2);
  let best = -1;
  let bestScore = -1;
  for (let i = 0; i < n; i++) {
    const o = t.off + 4 + i * 8;
    const pid = b.getUint16(o);
    const eid = b.getUint16(o + 2);
    const sub = t.off + b.getUint32(o + 4);
    const format = b.getUint16(sub);
    const score = format === 12 && (pid === 3 || pid === 0) ? 3 : format === 4 && ((pid === 3 && eid === 1) || pid === 0) ? 2 : -1;
    if (score > bestScore) {
      bestScore = score;
      best = sub;
    }
  }
  if (best < 0) throw new OtfParseError('no usable cmap subtable');
  const map = new Map<number, number>();
  if (b.getUint16(best) === 12) {
    const groups = b.getUint32(best + 12);
    for (let g = 0; g < groups; g++) {
      const o = best + 16 + g * 12;
      const start = b.getUint32(o);
      const end = Math.min(b.getUint32(o + 4), 0x10ffff);
      const gid = b.getUint32(o + 8);
      for (let cp = start; cp <= end; cp++) if (gid + cp - start > 0) map.set(cp, gid + cp - start);
    }
    return map;
  }
  const segX2 = b.getUint16(best + 6);
  const ends = best + 14;
  const starts = ends + segX2 + 2;
  const deltas = starts + segX2;
  const ranges = deltas + segX2;
  for (let s = 0; s < segX2 / 2; s++) {
    const end = b.getUint16(ends + s * 2);
    const start = b.getUint16(starts + s * 2);
    const delta = b.getInt16(deltas + s * 2);
    const rangeOff = b.getUint16(ranges + s * 2);
    for (let cp = start; cp <= end && cp !== 0xffff; cp++) {
      let gid: number;
      if (rangeOff === 0) gid = (cp + delta) & 0xffff;
      else {
        const g = b.getUint16(ranges + s * 2 + rangeOff + (cp - start) * 2);
        gid = g === 0 ? 0 : (g + delta) & 0xffff;
      }
      if (gid > 0) map.set(cp, gid);
    }
  }
  return map;
}

// ---- CFF ----

interface Index {
  count: number;
  /** 第 i 项的 [起, 止)（相对整个文件） */
  item(i: number): [number, number];
  end: number;
}

function readIndex(b: DataView, at: number): Index {
  const count = b.getUint16(at);
  if (count === 0) return { count, item: () => [at + 2, at + 2], end: at + 2 };
  const offSize = b.getUint8(at + 2);
  const offAt = (i: number) => {
    let v = 0;
    for (let k = 0; k < offSize; k++) v = v * 256 + b.getUint8(at + 3 + i * offSize + k);
    return v;
  };
  const dataStart = at + 3 + (count + 1) * offSize - 1;
  return { count, item: (i) => [dataStart + offAt(i), dataStart + offAt(i + 1)], end: dataStart + offAt(count) };
}

/** DICT：操作符（12 x 记成 1200 + x）→ 操作数 */
function readDict(b: DataView, start: number, end: number): Map<number, number[]> {
  const out = new Map<number, number[]>();
  let ops: number[] = [];
  let p = start;
  while (p < end) {
    const v = b.getUint8(p);
    if (v <= 21) {
      let op = v;
      p++;
      if (v === 12) op = 1200 + b.getUint8(p++);
      out.set(op, ops);
      ops = [];
    } else if (v === 28) {
      ops.push(b.getInt16(p + 1));
      p += 3;
    } else if (v === 29) {
      ops.push(b.getInt32(p + 1));
      p += 5;
    } else if (v === 30) {
      // 实数：只需要跳过（这里用到的键都是整数）
      p++;
      for (;;) {
        const x = b.getUint8(p++);
        if ((x & 0x0f) === 0x0f || (x >> 4) === 0x0f) break;
      }
      ops.push(0);
    } else if (v >= 32 && v <= 246) {
      ops.push(v - 139);
      p++;
    } else if (v >= 247 && v <= 250) {
      ops.push((v - 247) * 256 + b.getUint8(p + 1) + 108);
      p += 2;
    } else if (v >= 251 && v <= 254) {
      ops.push(-(v - 251) * 256 - b.getUint8(p + 1) - 108);
      p += 2;
    } else p++;
  }
  return out;
}

const subrBias = (n: number) => (n < 1240 ? 107 : n < 33900 ? 1131 : 32768);

interface Cff {
  charStrings: Index;
  gsubrs: Index;
  /** 字形号 → 它的局部子程序 */
  localSubrs(gid: number): Index | null;
}

function readCff(b: DataView, t: Table): Cff {
  const base = t.off;
  const hdrSize = b.getUint8(base + 2);
  const names = readIndex(b, base + hdrSize);
  const topDicts = readIndex(b, names.end);
  const strings = readIndex(b, topDicts.end);
  const gsubrs = readIndex(b, strings.end);
  const [ts, te] = topDicts.item(0);
  const top = readDict(b, ts, te);
  const csOff = top.get(17)?.[0];
  if (csOff === undefined) throw new OtfParseError('CFF has no CharStrings');
  const charStrings = readIndex(b, base + csOff);
  const privSubrs = (dict: Map<number, number[]>): Index | null => {
    const priv = dict.get(18);
    if (!priv || priv.length < 2) return null;
    const [size, off] = priv as [number, number];
    const pd = readDict(b, base + off, base + off + size);
    const subrs = pd.get(19)?.[0];
    return subrs === undefined ? null : readIndex(b, base + off + subrs);
  };
  const fdArrayOff = top.get(1236)?.[0];
  const fdSelectOff = top.get(1237)?.[0];
  if (fdArrayOff === undefined || fdSelectOff === undefined) {
    const subrs = privSubrs(top);
    return { charStrings, gsubrs, localSubrs: () => subrs };
  }
  // CID 字体：每个字形按 FDSelect 找它的字体字典
  const fdArray = readIndex(b, base + fdArrayOff);
  const fdSubrs: (Index | null)[] = [];
  for (let i = 0; i < fdArray.count; i++) {
    const [s, e] = fdArray.item(i);
    fdSubrs.push(privSubrs(readDict(b, s, e)));
  }
  const fs = base + fdSelectOff;
  const format = b.getUint8(fs);
  let fdOf: (gid: number) => number;
  if (format === 0) fdOf = (gid) => b.getUint8(fs + 1 + gid);
  else if (format === 3) {
    const nRanges = b.getUint16(fs + 1);
    fdOf = (gid) => {
      let lo = 0;
      let hi = nRanges - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (b.getUint16(fs + 3 + mid * 3) <= gid) lo = mid;
        else hi = mid - 1;
      }
      return b.getUint8(fs + 3 + lo * 3 + 2);
    };
  } else throw new OtfParseError(`unsupported FDSelect format ${format}`);
  return { charStrings, gsubrs, localSubrs: (gid) => fdSubrs[fdOf(gid)] ?? null };
}

/** 轮廓的边（字体单位，y 向上），曲线按折线近似 */
type Edge = [number, number, number, number];

/** 执行一个 Type 2 charstring，收集轮廓的边 */
function outline(b: DataView, cff: Cff, gid: number): Edge[] {
  const edges: Edge[] = [];
  const stack: number[] = [];
  let x = 0;
  let y = 0;
  let sx = 0;
  let sy = 0;
  let open = false;
  let stems = 0;
  let haveWidth = false;
  const local = cff.localSubrs(gid);
  const close = () => {
    if (open && (x !== sx || y !== sy)) edges.push([x, y, sx, sy]);
    open = false;
  };
  const moveTo = (nx: number, ny: number) => {
    close();
    x = sx = nx;
    y = sy = ny;
    open = true;
  };
  const lineTo = (nx: number, ny: number) => {
    edges.push([x, y, nx, ny]);
    x = nx;
    y = ny;
  };
  const curveTo = (x1: number, y1: number, x2: number, y2: number, x3: number, y3: number) => {
    const x0 = x;
    const y0 = y;
    const N = 8;
    for (let i = 1; i <= N; i++) {
      const t = i / N;
      const u = 1 - t;
      lineTo(u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3, u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3);
    }
  };
  // 第一个清栈的操作符前多出来的参数是前进宽度（这里用 hmtx，丢掉）
  const takeWidth = (expectEven: boolean) => {
    if (!haveWidth && stack.length % 2 === (expectEven ? 1 : 0)) stack.shift();
    haveWidth = true;
  };
  let depth = 0;
  let ended = false;
  const run = (start: number, end: number): void => {
    if (++depth > 10) throw new OtfParseError('subroutine nesting too deep');
    let p = start;
    while (p < end && !ended) {
      const v = b.getUint8(p++);
      if (v >= 32 || v === 28) {
        if (v === 28) {
          stack.push(b.getInt16(p));
          p += 2;
        } else if (v <= 246) stack.push(v - 139);
        else if (v <= 250) stack.push((v - 247) * 256 + b.getUint8(p++) + 108);
        else if (v <= 254) stack.push(-(v - 251) * 256 - b.getUint8(p++) - 108);
        else {
          stack.push(b.getInt32(p) / 65536);
          p += 4;
        }
        continue;
      }
      switch (v) {
        case 1: // hstem
        case 3: // vstem
        case 18: // hstemhm
        case 23: // vstemhm
          takeWidth(true);
          stems += stack.length >> 1;
          stack.length = 0;
          break;
        case 19: // hintmask
        case 20: // cntrmask
          takeWidth(true);
          stems += stack.length >> 1;
          stack.length = 0;
          p += (stems + 7) >> 3;
          break;
        case 21: // rmoveto
          takeWidth(true);
          moveTo(x + stack[0]!, y + stack[1]!);
          stack.length = 0;
          break;
        case 22: // hmoveto
          takeWidth(false);
          moveTo(x + stack[0]!, y);
          stack.length = 0;
          break;
        case 4: // vmoveto
          takeWidth(false);
          moveTo(x, y + stack[0]!);
          stack.length = 0;
          break;
        case 5: // rlineto
          for (let i = 0; i + 1 < stack.length; i += 2) lineTo(x + stack[i]!, y + stack[i + 1]!);
          stack.length = 0;
          break;
        case 6: // hlineto
        case 7: {
          // vlineto
          let horiz = v === 6;
          for (const d of stack) {
            if (horiz) lineTo(x + d, y);
            else lineTo(x, y + d);
            horiz = !horiz;
          }
          stack.length = 0;
          break;
        }
        case 8: // rrcurveto
          for (let i = 0; i + 5 < stack.length; i += 6) curveTo(x + stack[i]!, y + stack[i + 1]!, x + stack[i]! + stack[i + 2]!, y + stack[i + 1]! + stack[i + 3]!, x + stack[i]! + stack[i + 2]! + stack[i + 4]!, y + stack[i + 1]! + stack[i + 3]! + stack[i + 5]!);
          stack.length = 0;
          break;
        case 24: {
          // rcurveline
          let i = 0;
          for (; i + 5 < stack.length - 2; i += 6) curveTo(x + stack[i]!, y + stack[i + 1]!, x + stack[i]! + stack[i + 2]!, y + stack[i + 1]! + stack[i + 3]!, x + stack[i]! + stack[i + 2]! + stack[i + 4]!, y + stack[i + 1]! + stack[i + 3]! + stack[i + 5]!);
          lineTo(x + stack[i]!, y + stack[i + 1]!);
          stack.length = 0;
          break;
        }
        case 25: {
          // rlinecurve
          let i = 0;
          for (; i + 1 < stack.length - 6; i += 2) lineTo(x + stack[i]!, y + stack[i + 1]!);
          curveTo(x + stack[i]!, y + stack[i + 1]!, x + stack[i]! + stack[i + 2]!, y + stack[i + 1]! + stack[i + 3]!, x + stack[i]! + stack[i + 2]! + stack[i + 4]!, y + stack[i + 1]! + stack[i + 3]! + stack[i + 5]!);
          stack.length = 0;
          break;
        }
        case 26: // vvcurveto
        case 27: {
          // hhcurveto
          let i = 0;
          let d1 = 0;
          if (stack.length % 4 === 1) d1 = stack[i++]!;
          for (; i + 3 < stack.length; i += 4) {
            if (v === 26) curveTo(x + d1, y + stack[i]!, x + d1 + stack[i + 1]!, y + stack[i]! + stack[i + 2]!, x + d1 + stack[i + 1]!, y + stack[i]! + stack[i + 2]! + stack[i + 3]!);
            else curveTo(x + stack[i]!, y + d1, x + stack[i]! + stack[i + 1]!, y + d1 + stack[i + 2]!, x + stack[i]! + stack[i + 1]! + stack[i + 3]!, y + d1 + stack[i + 2]!);
            d1 = 0;
          }
          stack.length = 0;
          break;
        }
        case 30: // vhcurveto
        case 31: {
          // hvcurveto
          let horiz = v === 31;
          for (let i = 0; i + 3 < stack.length; i += 4) {
            const last = i + 5 === stack.length ? stack[i + 4]! : 0;
            if (horiz) curveTo(x + stack[i]!, y, x + stack[i]! + stack[i + 1]!, y + stack[i + 2]!, x + stack[i]! + stack[i + 1]! + last, y + stack[i + 2]! + stack[i + 3]!);
            else curveTo(x, y + stack[i]!, x + stack[i + 1]!, y + stack[i]! + stack[i + 2]!, x + stack[i + 1]! + stack[i + 3]!, y + stack[i]! + stack[i + 2]! + last);
            horiz = !horiz;
          }
          stack.length = 0;
          break;
        }
        case 10: // callsubr
        case 29: {
          // callgsubr
          const subrs = v === 10 ? local : cff.gsubrs;
          if (!subrs) throw new OtfParseError('callsubr without subroutines');
          const idx = stack.pop()! + subrBias(subrs.count);
          if (idx < 0 || idx >= subrs.count) throw new OtfParseError('subroutine index out of range');
          const [s, e] = subrs.item(idx);
          run(s, e);
          break;
        }
        case 11: // return
          depth--;
          return;
        case 14: // endchar
          takeWidth(true);
          close();
          ended = true;
          break;
        case 12: {
          // 扩展操作符：Unifont 不用（flex 等），遇到就当作不认识
          throw new OtfParseError(`unsupported charstring operator 12 ${b.getUint8(p)}`);
        }
        default:
          throw new OtfParseError(`unsupported charstring operator ${v}`);
      }
    }
    depth--;
  };
  const [s, e] = cff.charStrings.item(gid);
  run(s, e);
  close();
  return edges;
}

/** 非零环绕规则，在像素中心采样：返回 cols × 16 的点阵（行优先，1 为有墨） */
function sample(edges: readonly Edge[], originX: number, cols: number): Uint8Array {
  const out = new Uint8Array(cols * ROWS);
  const xs: { x: number; w: number }[] = [];
  for (let row = 0; row < ROWS; row++) {
    const cy = (ASCENT_PX - row - 0.5) * UNITS_PER_PIXEL;
    xs.length = 0;
    for (const [x0, y0, x1, y1] of edges) {
      if (y0 === y1) continue;
      const lo = Math.min(y0, y1);
      const hi = Math.max(y0, y1);
      if (cy < lo || cy >= hi) continue;
      xs.push({ x: x0 + ((cy - y0) / (y1 - y0)) * (x1 - x0), w: y1 > y0 ? 1 : -1 });
    }
    if (xs.length === 0) continue;
    xs.sort((a, b) => a.x - b.x);
    for (let col = 0; col < cols; col++) {
      const cx = originX + (col + 0.5) * UNITS_PER_PIXEL;
      let wind = 0;
      for (const c of xs) {
        if (c.x > cx) break;
        wind += c.w;
      }
      if (wind !== 0) out[row * cols + col] = 1;
    }
  }
  return out;
}

export interface OtfBitmapFont {
  /** 字体名表里的完整版本串（如 "Version 18.0.01"） */
  version: string;
  /** .hex 格式的文本（每行“码位:位图”），直接交给 parseUnihex */
  hex: string;
  glyphs: number;
}

function nameRecord(b: DataView, t: Table, id: number): string {
  const count = b.getUint16(t.off + 2);
  const strOff = t.off + b.getUint16(t.off + 4);
  for (let i = 0; i < count; i++) {
    const o = t.off + 6 + i * 12;
    if (b.getUint16(o) !== 3 || b.getUint16(o + 6) !== id) continue;
    const len = b.getUint16(o + 8);
    const off = strOff + b.getUint16(o + 10);
    let s = '';
    for (let k = 0; k + 1 < len; k += 2) s += String.fromCharCode(b.getUint16(off + k));
    return s;
  }
  return '';
}

const HEX = '0123456789ABCDEF';
const NEWLINE = String.fromCharCode(10);

/**
 * 把点阵 OTF 还原成 .hex 文本，每还原 chunk 个字形 yield 一次（让调用方可以把事件循环让出去）。
 * 字形的列数取前进宽度（8 或 16 像素）；前进宽度为 0 的组合字符按墨迹所在的 8 / 16 列格子取。只收基本多文种平面里 cmap 有的码位。
 */
function* hexGlyphs(bytes: Uint8Array, lines: string[], chunk: number): Generator<void, string> {
  const b = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const t = tables(b);
  const need = (name: string) => {
    const v = t.get(name);
    if (!v) throw new OtfParseError(`missing table ${name}`);
    return v;
  };
  const cmap = readCmap(b, need('cmap'));
  const hhea = need('hhea');
  const hmtx = need('hmtx');
  const numH = b.getUint16(hhea.off + 34);
  const advanceOf = (gid: number) => b.getUint16(hmtx.off + Math.min(gid, numH - 1) * 4);
  const unitsPerEm = b.getUint16(need('head').off + 18);
  if (unitsPerEm !== ROWS * UNITS_PER_PIXEL) throw new OtfParseError(`unexpected unitsPerEm ${unitsPerEm}`);
  const cff = readCff(b, need('CFF '));
  const cps = [...cmap.keys()].filter((cp) => cp <= 0xffff).sort((a, c) => a - c);
  let n = 0;
  for (const cp of cps) {
    const gid = cmap.get(cp)!;
    if (gid >= cff.charStrings.count) continue;
    const edges = outline(b, cff, gid);
    const adv = advanceOf(gid) / UNITS_PER_PIXEL;
    let cols = adv > 8 ? 16 : 8;
    let originX = 0;
    if (adv === 0 && edges.length > 0) {
      // 零宽的组合字符：轮廓画在原点左侧，按墨迹范围找它所在的格子
      const minX = Math.min(...edges.map((e) => Math.min(e[0], e[2])));
      const maxX = Math.max(...edges.map((e) => Math.max(e[0], e[2])));
      cols = maxX - minX > 8 * UNITS_PER_PIXEL ? 16 : 8;
      originX = Math.floor(minX / (cols * UNITS_PER_PIXEL)) * cols * UNITS_PER_PIXEL;
    }
    const bits = sample(edges, originX, cols);
    let line = `${cp.toString(16).toUpperCase().padStart(4, '0')}:`;
    for (let i = 0; i < bits.length; i += 4) line += HEX[(bits[i]! << 3) | (bits[i + 1]! << 2) | (bits[i + 2]! << 1) | bits[i + 3]!];
    lines.push(line);
    if (++n % chunk === 0) yield;
  }
  return nameRecord(b, need('name'), 5);
}

/** 同步版：一口气还原完 */
export function otfToHex(bytes: Uint8Array): OtfBitmapFont {
  const lines: string[] = [];
  const it = hexGlyphs(bytes, lines, Number.MAX_SAFE_INTEGER);
  let r = it.next();
  while (!r.done) r = it.next();
  return { version: r.value, hex: lines.join(NEWLINE), glyphs: lines.length };
}

/** 分块版：每还原 chunk 个字形 await 一次 pause（主进程里用 setImmediate，解析期间不卡住界面的 IPC）；结果和同步版逐字节相同 */
export async function otfToHexChunked(bytes: Uint8Array, pause: () => Promise<void>, chunk = 2000): Promise<OtfBitmapFont> {
  const lines: string[] = [];
  const it = hexGlyphs(bytes, lines, chunk);
  let r = it.next();
  while (!r.done) {
    await pause();
    r = it.next();
  }
  return { version: r.value, hex: lines.join(NEWLINE), glyphs: lines.length };
}

/**
 * 内嵌 Unifont 的全宽区间：这些码位的字形按整格（16 列）算宽度，不按墨迹裁，中文、日文假名、全角标点一律前进 9 个字体像素，
 * 和游戏里中日韩文字的排版一致（游戏的 unihex 提供器用 size_overrides 做同样的事；这里的区间是本项目自己定的，docs/decisions.md
 * “内嵌 Unifont 与两种字体模式”）。区间里的半宽字形（8 列）按整个 8 列算。
 */
export const UNIFONT_FULL_WIDTH: readonly UnihexOverride[] = [
  { from: 0x2e80, to: 0x2fdf, left: 0, right: 15 },
  { from: 0x3000, to: 0x30ff, left: 0, right: 15 },
  { from: 0x3100, to: 0x9fff, left: 0, right: 15 },
  { from: 0xac00, to: 0xd7a3, left: 1, right: 15 },
  { from: 0xf900, to: 0xfaff, left: 0, right: 15 },
  { from: 0xfe30, to: 0xfe4f, left: 0, right: 15 },
  { from: 0xff01, to: 0xff60, left: 0, right: 15 },
  { from: 0xffe0, to: 0xffe6, left: 0, right: 15 },
];

/** 读内嵌的 Unifont OTF，得到和 unihex 提供器一样的字形表（半个字体像素一格，oversample = 2） */
export function parseUnifontOtf(bytes: Uint8Array): UnihexTables & { version: string } {
  const { hex, version } = otfToHex(bytes);
  return { ...parseUnihex([hex], UNIFONT_FULL_WIDTH), version };
}

/** 分块版的 parseUnifontOtf（见 otfToHexChunked） */
export async function parseUnifontOtfChunked(bytes: Uint8Array, pause: () => Promise<void>): Promise<UnihexTables & { version: string }> {
  const { hex, version } = await otfToHexChunked(bytes, pause);
  await pause();
  return { ...parseUnihex([hex], UNIFONT_FULL_WIDTH), version };
}
