// 用户导入的矢量字体（TTF、OTF、WOFF、WOFF2）的文字：字体文件已由 resources.ts 用 FontFace 注册进 Worker，
// 这里用 OffscreenCanvas 的 2D 上下文按输出分辨率栅格化，带抗锯齿（矢量字没有“像素”可对齐）。
// 结果只取决于文字、样式和输出分辨率：同一台机器上预览和导出走同一份代码。分辨率不同时（预览比导出小）字形的抗锯齿会略有不同。
//
// 尺寸约定：一个 em 等于 10 个字体像素（大写字母约 7 个字体像素高，和游戏字体的字号接近），行高取字体自己的上升 + 下降。
// 样式：粗体、斜体交给 CSS 字体描述（字体文件里没有对应字重时浏览器合成）；阴影、描边偏移 1 个字体像素；下划线、删除线自己画。
import type { TextObject, TextOptions } from '@allay/template-sdk';
import * as THREE from 'three';
import { makeDataTexture, type Warn } from './resources';
import { readTextOptions, type ResolvedStyle } from './text';

/** 一个 em 等于多少字体像素 */
export const VECTOR_EM = 10;
/** 贴图边长上限 */
const MAX_SIDE = 4096;

function isCjk(cp: number): boolean {
  return (cp >= 0x2e80 && cp <= 0x9fff) || (cp >= 0xac00 && cp <= 0xd7af) || (cp >= 0xf900 && cp <= 0xfaff) || (cp >= 0xff00 && cp <= 0xffef) || (cp >= 0x20000 && cp <= 0x3134f);
}

/** 断行：同位图文字的规则（空格处断，中日韩逐字断），宽度用 measureText 量 */
function wrap(text: string, maxWidth: number, measure: (s: string) => number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    if (maxWidth <= 0) {
      out.push(para);
      continue;
    }
    const chars = Array.from(para);
    let line = '';
    let lastSpace = -1;
    for (const ch of chars) {
      const next = line + ch;
      if (line !== '' && ch !== ' ' && measure(next) > maxWidth) {
        const cp = ch.codePointAt(0) ?? 0;
        if (isCjk(cp) || lastSpace < 0) {
          out.push(line.trimEnd());
          line = ch;
        } else {
          out.push(line.slice(0, lastSpace).trimEnd());
          line = line.slice(lastSpace + 1) + ch;
        }
        lastSpace = -1;
        continue;
      }
      if (ch === ' ') lastSpace = line.length;
      line = next;
    }
    out.push(line.trimEnd());
  }
  return out;
}

export interface VectorTextEnv {
  /** 输出短边像素 / 1080（StageInfo.pixelScale） */
  pixelScale: number;
}

/** ctx.text.create(opts)，矢量字体 */
export function createVectorText(opts: TextOptions, css: string, style: ResolvedStyle, env: VectorTextEnv, warn: Warn, owned: THREE.Texture[]): TextObject {
  const { text, size, align, maxWidthPx, color } = readTextOptions(opts);
  // 每个字体像素多少个输出像素；贴图超过上限时整体降低分辨率
  let k = Math.max(0.25, size * (Number.isFinite(env.pixelScale) && env.pixelScale > 0 ? env.pixelScale : 1));
  const fontCss = (scale: number) => `${style.italic ? 'italic ' : ''}${style.bold ? 'bold ' : ''}${VECTOR_EM * scale}px "${css}"`;

  const probe = new OffscreenCanvas(1, 1).getContext('2d');
  if (!probe) {
    warn('text: no 2D canvas in this worker; text is not drawn');
    return emptyText();
  }
  probe.font = fontCss(1);
  const lines = wrap(text, maxWidthPx, (s) => probe.measureText(s).width);
  const m = probe.measureText('Hg国');
  const ascent = Math.ceil(m.fontBoundingBoxAscent || VECTOR_EM * 0.8);
  const descent = Math.ceil(m.fontBoundingBoxDescent || VECTOR_EM * 0.2);
  const lineH = ascent + descent;
  const widths = lines.map((l) => probe.measureText(l).width);
  const width = Math.max(1, Math.ceil(Math.max(0, ...widths)));
  const height = Math.max(1, lines.length * lineH + Math.max(0, lines.length - 1));
  const pad = 2;
  const side = Math.max(width, height) + 2 * pad;
  if (side * k > MAX_SIDE) k = MAX_SIDE / side;

  const W = Math.max(1, Math.ceil((width + 2 * pad) * k));
  const H = Math.max(1, Math.ceil((height + 2 * pad) * k));
  const canvas = new OffscreenCanvas(W, H);
  const g = canvas.getContext('2d');
  if (!g) {
    warn('text: no 2D canvas in this worker; text is not drawn');
    return emptyText();
  }
  g.font = fontCss(k);
  g.textBaseline = 'alphabetic';
  const draw = (fill: string, ox: number, oy: number) => {
    g.fillStyle = fill;
    lines.forEach((line, i) => {
      const lx = align === 'left' ? 0 : align === 'center' ? (width - widths[i]!) / 2 : width - widths[i]!;
      const x = (pad + lx + ox) * k;
      const base = (pad + i * (lineH + 1) + ascent + oy) * k;
      g.fillText(line, x, base);
      const lw = widths[i]! * k;
      if (style.strikethrough) g.fillRect(x, base - Math.round(ascent * 0.3 * k), lw, Math.max(1, k));
      if (style.underline) g.fillRect(x, base + k, lw, Math.max(1, k));
    });
  };
  const rgb = /^#([0-9a-fA-F]{6})/.exec(color)?.[1] ?? 'FFFFFF';
  const v = Number.parseInt(rgb, 16);
  if (style.outline) {
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (dx !== 0 || dy !== 0) draw(style.outline, dx, dy);
  } else if (style.shadow) {
    // 阴影颜色：正文各通道的 1/4（同位图文字、同游戏）
    draw(`rgb(${((v >> 16) & 255) >> 2}, ${((v >> 8) & 255) >> 2}, ${(v & 255) >> 2})`, 1, 1);
  }
  draw(`#${rgb}`, 0, 0);

  const img = g.getImageData(0, 0, W, H);
  const tex = makeDataTexture(W, H, new Uint8Array(img.data.buffer, img.data.byteOffset, img.data.byteLength));
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  owned.push(tex);

  const w = width * size;
  const h = height * size;
  const gw = (W / k) * size;
  const gh = (H / k) * size;
  const x0 = align === 'left' ? 0 : align === 'center' ? -w / 2 : -w;
  const geometry = new THREE.PlaneGeometry(gw, gh);
  // 贴图左上角在内容框左上角再往外 pad
  geometry.translate(x0 - pad * size + gw / 2, h / 2 + pad * size - gh / 2, 0);
  const material = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false });
  const group = new THREE.Group();
  group.add(new THREE.Mesh(geometry, material));
  return {
    object: group,
    width: w,
    height: h,
    setOpacity(a) {
      material.opacity = Math.min(1, Math.max(0, Number.isFinite(a) ? a : 0));
    },
  };
}

function emptyText(): TextObject {
  return { object: new THREE.Group(), width: 0, height: 0, setOpacity: () => undefined };
}
