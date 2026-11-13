// 方块、物品缩略图（docs/03-assets.md 3.10）：杂务引擎 Worker 批量生成，按 resourceStamp 缓存到 userData/cache/thumbs/。
// 资源栈一变，内存里的全部作废，已经要过的缩略图在后台按新的资源栈重建。杂务 Worker 空闲 30 秒后销毁（02-engine.md 2.2）。
import type { ThumbRequest } from '@allay/template-sdk';
import { EngineHost } from '../../engine-host/EngineHost';
import { resolveResource } from '../../engine-host/resource-client';
import { currentStamp, useResourceStore } from '../../stores/resourceStore';

export type ThumbKind = ThumbRequest['kind'];
export type ThumbSize = ThumbRequest['size'];

export interface Thumb {
  /** blob: URL，可以直接给 <img> */
  url: string;
  /** 从哪里来的（测试和诊断用） */
  source: 'memory' | 'disk' | 'rendered';
}

const IDLE_MS = 30_000;
const STAMP_RE = /^[0-9a-f]{16}$/;

export function thumbKey(kind: ThumbKind, id: string, size: ThumbSize): string {
  return `${kind}_${size}_${id.toLowerCase().replace(/[:/]/g, '~').replace(/[^a-z0-9_.~-]/g, '_')}`.slice(0, 200);
}

async function encodePng(bitmap: ImageBitmap): Promise<Uint8Array> {
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const g = canvas.getContext('2d');
  if (!g) throw new Error('2d context unavailable');
  g.drawImage(bitmap, 0, 0);
  bitmap.close();
  return new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer());
}

class ThumbnailService {
  private host: Promise<EngineHost> | null = null;
  private idle: ReturnType<typeof setTimeout> | null = null;
  private chain: Promise<unknown> = Promise.resolve();
  private stamp = '';
  private readonly memory = new Map<string, Promise<string | null>>();
  /** 要过的缩略图，资源栈变了以后按新的重建 */
  private readonly wanted = new Map<string, { kind: ThumbKind; id: string; size: ThumbSize }>();
  rendered = 0;

  constructor() {
    useResourceStore.subscribe((s, prev) => {
      if (s.state?.stamp !== prev.state?.stamp) this.onStampChanged();
    });
  }

  private onStampChanged(): void {
    this.resetMemory();
    // 后台重建（3.10）
    for (const r of this.wanted.values()) void this.get(r.kind, r.id, r.size).catch(() => undefined);
  }

  private resetMemory(): void {
    for (const p of this.memory.values()) void p.then((url) => url && URL.revokeObjectURL(url));
    this.memory.clear();
    this.stamp = currentStamp();
  }

  /** 一张缩略图：先看内存，再看磁盘缓存，都没有就交给杂务 Worker 画 */
  async get(kind: ThumbKind, id: string, size: ThumbSize): Promise<Thumb | null> {
    if (this.stamp !== currentStamp()) this.resetMemory();
    const key = thumbKey(kind, id, size);
    this.wanted.set(key, { kind, id, size });
    const cached = this.memory.get(key);
    if (cached) {
      const url = await cached;
      return url ? { url, source: 'memory' } : null;
    }
    let source: Thumb['source'] = 'disk';
    const stamp = this.stamp;
    const p = (async () => {
      const diskOk = STAMP_RE.test(stamp);
      let png = diskOk ? await window.allay.cache.getThumb(stamp, key) : null;
      if (!png) {
        source = 'rendered';
        png = await this.render({ kind, id, size, resourceStamp: stamp });
        if (diskOk && stamp === currentStamp()) await window.allay.cache.putThumb(stamp, key, png);
      }
      return URL.createObjectURL(new Blob([png as Uint8Array<ArrayBuffer>], { type: 'image/png' }));
    })().catch((error: unknown) => {
      console.warn(`[thumbnails] ${key} failed: ${error instanceof Error ? error.message : String(error)}`);
      this.memory.delete(key);
      return null;
    });
    this.memory.set(key, p);
    const url = await p;
    return url ? { url, source } : null;
  }

  /** 批量：按顺序在同一个杂务 Worker 里画 */
  getMany(reqs: readonly { kind: ThumbKind; id: string; size: ThumbSize }[]): Promise<(Thumb | null)[]> {
    return Promise.all(reqs.map((r) => this.get(r.kind, r.id, r.size)));
  }

  private render(req: ThumbRequest): Promise<Uint8Array> {
    const run = this.chain.then(async () => {
      if (this.idle) clearTimeout(this.idle);
      this.host ??= EngineHost.create({ mode: 'utility', resolveResource, strictDeterminism: import.meta.env.DEV });
      let host: EngineHost;
      try {
        host = await this.host;
      } catch (error) {
        this.host = null;
        throw error;
      }
      try {
        const png = await encodePng(await host.renderThumbnail(req));
        this.rendered++;
        return png;
      } catch (error) {
        if (host.dead) this.host = null;
        throw error;
      } finally {
        this.idle = setTimeout(() => this.disposeWorker(), IDLE_MS);
      }
    });
    this.chain = run.catch(() => undefined);
    return run;
  }

  private disposeWorker(): void {
    const h = this.host;
    this.host = null;
    void h?.then((x) => x.dispose(), () => undefined);
  }
}

export const thumbnails = new ThumbnailService();
