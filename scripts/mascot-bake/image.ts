// 烘焙用的位图操作：拼图、合成、裁切、应用图标的底板。全部是整数运算或固定顺序的浮点运算，结果确定。
import { FACE_RECT } from '../../packages/mascot/model/allay.model';
import type { Rgba } from './png';

export function createImage(width: number, height: number, rgba: readonly [number, number, number, number] = [0, 0, 0, 0]): Rgba {
  const data = new Uint8Array(width * height * 4);
  if (rgba.some((v) => v !== 0)) for (let i = 0; i < data.length; i += 4) data.set(rgba, i);
  return { width, height, data };
}

/** 原样拷贝（覆盖），超出边界的部分裁掉 */
export function blit(dst: Rgba, src: Rgba, dx: number, dy: number): void {
  for (let y = 0; y < src.height; y++) {
    const ty = dy + y;
    if (ty < 0 || ty >= dst.height) continue;
    for (let x = 0; x < src.width; x++) {
      const tx = dx + x;
      if (tx < 0 || tx >= dst.width) continue;
      const s = (y * src.width + x) * 4;
      dst.data.set(src.data.subarray(s, s + 4), (ty * dst.width + tx) * 4);
    }
  }
}

/** 直通 alpha 的 source-over 合成 */
export function over(dst: Rgba, src: Rgba, dx: number, dy: number): void {
  for (let y = 0; y < src.height; y++) {
    const ty = dy + y;
    if (ty < 0 || ty >= dst.height) continue;
    for (let x = 0; x < src.width; x++) {
      const tx = dx + x;
      if (tx < 0 || tx >= dst.width) continue;
      const s = (y * src.width + x) * 4;
      const d = (ty * dst.width + tx) * 4;
      const sa = src.data[s + 3]! / 255;
      if (sa === 0) continue;
      const da = dst.data[d + 3]! / 255;
      const oa = sa + da * (1 - sa);
      for (let c = 0; c < 3; c++) {
        const v = (src.data[s + c]! * sa + dst.data[d + c]! * da * (1 - sa)) / oa;
        dst.data[d + c] = Math.round(v);
      }
      dst.data[d + 3] = Math.round(oa * 255);
    }
  }
}

export function crop(src: Rgba, x0: number, y0: number, w: number, h: number): Rgba {
  const out = createImage(w, h);
  blit(out, src, -x0, -y0);
  return out;
}

/** 长宽都缩小到 1/n：n×n 块在预乘域里平均（透明处的颜色不参与） */
export function downscale(src: Rgba, n: number): Rgba {
  const w = Math.floor(src.width / n);
  const h = Math.floor(src.height / n);
  const out = createImage(w, h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let dy = 0; dy < n; dy++)
        for (let dx = 0; dx < n; dx++) {
          const s = ((y * n + dy) * src.width + x * n + dx) * 4;
          const sa = src.data[s + 3]!;
          r += src.data[s]! * sa;
          g += src.data[s + 1]! * sa;
          b += src.data[s + 2]! * sa;
          a += sa;
        }
      const o = (y * w + x) * 4;
      if (a > 0) {
        out.data[o] = Math.round(r / a);
        out.data[o + 1] = Math.round(g / a);
        out.data[o + 2] = Math.round(b / a);
      }
      out.data[o + 3] = Math.round(a / (n * n));
    }
  return out;
}

function hex(h: string): [number, number, number] {
  return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
}

/** 应用图标的底板（7.3）：圆角方形，#2072D5 到 #52CFF3 的 135° 渐变（左上到右下）。边缘 4×4 超采样抗锯齿 */
export function iconPlate(size: number): Rgba {
  const out = createImage(size, size);
  const from = hex('#2072D5');
  const to = hex('#52CFF3');
  const r = size * 0.22;
  const SS = 4;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      let cover = 0;
      for (let sy = 0; sy < SS; sy++)
        for (let sx = 0; sx < SS; sx++) {
          const px = x + (sx + 0.5) / SS;
          const py = y + (sy + 0.5) / SS;
          const cx = Math.min(Math.max(px, r), size - r);
          const cy = Math.min(Math.max(py, r), size - r);
          if ((px - cx) ** 2 + (py - cy) ** 2 <= r * r) cover++;
        }
      if (cover === 0) continue;
      const t = (x + 0.5 + y + 0.5) / (2 * size);
      const o = (y * size + x) * 4;
      for (let c = 0; c < 3; c++) out.data[o + c] = Math.round(from[c]! + (to[c]! - from[c]!) * t);
      out.data[o + 3] = Math.round((cover / (SS * SS)) * 255);
    }
  return out;
}

/**
 * 闭眼版贴图：原版贴图没有闭眼的样子，这里从原图派生，不画新的像素。
 * 在头的正面里找出眼睛（接近白色的像素），每一列只保留最下面那个眼睛像素，
 * 上面的换成同一行里左边（没有就右边）最近的非眼睛像素，看起来像眯起来的眼睛。
 */
export function closedEyes(tex: Rgba): Rgba {
  const out: Rgba = { width: tex.width, height: tex.height, data: tex.data.slice() };
  const scale = tex.width / 32;
  const fx = FACE_RECT.u * scale;
  const fy = FACE_RECT.v * scale;
  const fw = FACE_RECT.w * scale;
  const fh = FACE_RECT.h * scale;
  const at = (x: number, y: number) => (y * tex.width + x) * 4;
  const isEye = (x: number, y: number) => {
    const o = at(x, y);
    const d = tex.data;
    return d[o + 3]! > 0 && Math.min(d[o]!, d[o + 1]!, d[o + 2]!) >= 230;
  };
  for (let x = fx; x < fx + fw; x++) {
    const rows: number[] = [];
    for (let y = fy; y < fy + fh; y++) if (isEye(x, y)) rows.push(y);
    rows.pop();
    for (const y of rows) {
      let sx = -1;
      for (let d = 1; d < fw && sx < 0; d++) {
        if (x - d >= fx && !isEye(x - d, y)) sx = x - d;
        else if (x + d < fx + fw && !isEye(x + d, y)) sx = x + d;
      }
      if (sx >= 0) out.data.set(tex.data.subarray(at(sx, y), at(sx, y) + 4), at(x, y));
    }
  }
  return out;
}
