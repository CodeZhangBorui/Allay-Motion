// 模板封面和悬停预览（docs/04-templates.md 4.8 第 5 步、06-ui-design.md 6.4 模板库）：
// 由杂务引擎 Worker 以 320×180、30 fps 渲染，按 resourceStamp 缓存到 userData/cache/thumbs/。
// 封面是剪辑点那一帧（没有剪辑点取中间一帧）；悬停预览是全部帧排成的网格图，播放时按帧画到一块小画布上。
// 模板安装后、资源栈变化后重建；重建期间模板库显示骨架和悦灵。
import { frameCount } from '@allay/engine/frames';
import { defaultParams, type FrameQuality } from '@allay/template-sdk';
import i18next from 'i18next';
import { create } from 'zustand';
import type { TemplateEntry } from '../../../shared/templates';
import { EngineHost } from '../../engine-host/EngineHost';
import { createResolver, loadStamp } from '../../engine-host/resource-client';
import { currentStamp, useResourceStore } from '../../stores/resourceStore';
import { readTemplate, type AssetSource } from '../../templates/catalog';

export const COVER_W = 320;
export const COVER_H = 180;
export const COVER_FPS = 30;
/** 悬停预览最多 4 秒 */
const MAX_FRAMES = COVER_FPS * 4;
const SHEET_COLS = 8;
/** 封面只是缩略图：不加运动模糊，渲染快 */
const COVER_QUALITY: FrameQuality = { subframes: 1, shutterAngle: 0 };
const STAMP_RE = /^[0-9a-f]{16}$/;
const MAX_DISK_BYTES = 8 * 1024 * 1024;

export interface Cover {
  url: string;
  /** 悬停预览的帧网格（解码好的位图），没有时只显示封面 */
  sheet: ImageBitmap | null;
  frames: number;
  cols: number;
}

interface CoverState {
  covers: Record<string, Cover | null>;
  /** 正在生成的数量 */
  pending: number;
  /** 这一轮（资源栈变化后）是否已经全部生成过一次 */
  stamp: string;
}

export const useCoverStore = create<CoverState>(() => ({ covers: {}, pending: 0, stamp: '' }));

export function coverKey(id: string, version: string): string {
  return `cover_${`${id}_${version}`.toLowerCase().replace(/[^a-z0-9_.~-]/g, '_')}`.slice(0, 190);
}

function toPng(canvas: OffscreenCanvas): Promise<Uint8Array> {
  return canvas.convertToBlob({ type: 'image/png' }).then(async (b) => new Uint8Array(await b.arrayBuffer()));
}

function blobUrl(png: Uint8Array): string {
  return URL.createObjectURL(new Blob([png as Uint8Array<ArrayBuffer>], { type: 'image/png' }));
}

class CoverService {
  private host: Promise<EngineHost> | null = null;
  private chain: Promise<unknown> = Promise.resolve();
  private wanted = new Map<string, { id: string; version: string }>();
  private inflight = new Set<string>();

  constructor() {
    useResourceStore.subscribe((s, prev) => {
      if (s.state?.stamp !== prev.state?.stamp) this.reset();
    });
  }

  private reset(): void {
    const old = useCoverStore.getState().covers;
    for (const c of Object.values(old)) {
      if (!c) continue;
      URL.revokeObjectURL(c.url);
      c.sheet?.close();
    }
    useCoverStore.setState({ covers: {}, stamp: currentStamp() });
    this.inflight.clear();
    for (const r of this.wanted.values()) this.request(r.id, r.version);
  }

  /** 模板库要显示这些模板的封面 */
  ensure(entries: readonly TemplateEntry[]): void {
    for (const e of entries) if (!e.baseMissing) this.request(e.id, e.version);
  }

  private request(id: string, version: string): void {
    const key = coverKey(id, version);
    this.wanted.set(key, { id, version });
    if (key in useCoverStore.getState().covers || this.inflight.has(key)) return;
    this.inflight.add(key);
    useCoverStore.setState((s) => ({ pending: s.pending + 1 }));
    const stamp = currentStamp();
    const run = this.chain.then(() => this.build(id, version, key, stamp));
    this.chain = run.catch(() => undefined);
    void run
      .then((cover) => {
        if (stamp !== currentStamp()) {
          if (cover) {
            URL.revokeObjectURL(cover.url);
            cover.sheet?.close();
          }
          return;
        }
        useCoverStore.setState((s) => ({ covers: { ...s.covers, [key]: cover } }));
      })
      .catch((error: unknown) => {
        console.warn(`[covers] ${key} failed: ${error instanceof Error ? error.message : String(error)}`);
        if (stamp === currentStamp()) useCoverStore.setState((s) => ({ covers: { ...s.covers, [key]: null } }));
      })
      .finally(() => {
        this.inflight.delete(key);
        useCoverStore.setState((s) => ({ pending: Math.max(0, s.pending - 1) }));
        // 封面是一阵一阵生成的（安装、资源栈变化）：这一批做完就销毁杂务 Worker，不占着显存
        if (this.inflight.size === 0) this.dispose();
      });
  }

  private async getHost(): Promise<EngineHost> {
    this.host ??= EngineHost.create({ mode: 'utility', resolveResource: createResolver(() => this.assets), strictDeterminism: import.meta.env.DEV });
    try {
      return await this.host;
    } catch (error) {
      this.host = null;
      throw error;
    }
  }

  private assets: AssetSource | null = null;

  private async build(id: string, version: string, key: string, stamp: string): Promise<Cover | null> {
    const diskOk = STAMP_RE.test(stamp);
    // 先看磁盘缓存
    if (diskOk) {
      const [coverPng, sheetPng] = await Promise.all([window.allay.cache.getThumb(stamp, key), window.allay.cache.getThumb(stamp, `${key}~sheet`)]);
      if (coverPng) {
        const sheet = sheetPng ? await createImageBitmap(new Blob([sheetPng as Uint8Array<ArrayBuffer>])) : null;
        const frames = sheet ? Math.round((sheet.width / COVER_W) * (sheet.height / COVER_H)) : 0;
        return { url: blobUrl(coverPng), sheet, frames: sheetFramesFrom(sheet, frames), cols: SHEET_COLS };
      }
    }
    const source = await readTemplate(id, version);
    if (!source) return null;
    const host = await this.getHost();
    try {
      this.assets = source.assets;
      const output = { width: COVER_W, height: COVER_H, fps: COVER_FPS };
      const loaded = await host.load({
        manifest: source.manifest,
        code: source.code,
        params: defaultParams(source.params, { locale: i18next.language }),
        output,
        resourceStamp: loadStamp(source.assets),
        locale: i18next.language,
      });
      const total = Math.min(MAX_FRAMES, frameCount(loaded.duration, COVER_FPS));
      const cut = loaded.cutTime === null ? Math.floor(total / 2) : Math.min(total - 1, Math.round(loaded.cutTime * COVER_FPS));
      const cols = Math.min(SHEET_COLS, total);
      const rows = Math.ceil(total / cols);
      const sheet = new OffscreenCanvas(cols * COVER_W, rows * COVER_H);
      const g = sheet.getContext('2d');
      const coverCanvas = new OffscreenCanvas(COVER_W, COVER_H);
      const cg = coverCanvas.getContext('2d');
      if (!g || !cg) throw new Error('2d context unavailable');
      for (let i = 0; i < total; i++) {
        const px = await host.renderFrame(i, COVER_QUALITY);
        const img = new ImageData(new Uint8ClampedArray(px.buffer, px.byteOffset, px.byteLength), COVER_W, COVER_H);
        g.putImageData(img, (i % cols) * COVER_W, Math.floor(i / cols) * COVER_H);
        if (i === cut) cg.putImageData(img, 0, 0);
      }
      const [coverPng, sheetPng] = await Promise.all([toPng(coverCanvas), toPng(sheet)]);
      if (diskOk && stamp === currentStamp()) {
        await window.allay.cache.putThumb(stamp, key, coverPng).catch(() => undefined);
        if (sheetPng.byteLength <= MAX_DISK_BYTES) await window.allay.cache.putThumb(stamp, `${key}~sheet`, sheetPng).catch(() => undefined);
      }
      return { url: blobUrl(coverPng), sheet: sheet.transferToImageBitmap(), frames: total, cols };
    } catch (error) {
      if (host.dead) this.host = null;
      throw error;
    }
  }

  private dispose(): void {
    const h = this.host;
    this.host = null;
    void h?.then((x) => x.dispose(), () => undefined);
  }
}

/** 磁盘缓存的网格图里有几帧：末行可能不满，最后几格是全透明的；按格子数算，多出来的空帧不影响循环观感 */
function sheetFramesFrom(sheet: ImageBitmap | null, cells: number): number {
  return sheet ? cells : 0;
}

export const covers = new CoverService();
