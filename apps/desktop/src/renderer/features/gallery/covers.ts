// 模板封面和悬停预览（docs/04-templates.md 4.8 第 5 步、06-ui-design.md 6.4 模板库；docs/decisions.md“模板库撑到一百个模板”）。
//
// - 封面：剪辑点那一帧（没有剪辑点取前 4 秒的中间一帧），320×180。只给滚动到可见范围附近的卡片生成（模板库经 setView 报来
//   visible / near，见 cover-plan.ts），滚过去、还没开始的直接撤掉。
// - 悬停预览：前 4 秒的全部帧（30 fps）排成 8 列的网格图。只在指针（或键盘焦点）在卡片上停够了才生成（setHover），移开就停。
// - 都由杂务引擎 Worker 经统一的静帧接口（engine-host/still.ts，H4）渲染，一次只做一件。预览在换模板、改参数时（preview/activity.ts）
//   封面先等着，渲染悬停预览的中途也每几帧看一次：切换模板、改参数的预览始终优先。
// - 缓存：内存里每个模板一张封面；磁盘在 userData/cache/thumbs/<resourceStamp>/，键里有模板内容的哈希（contentHash）和界面语言
//   （默认参数里的文字随语言变），所以资源栈、模板内容、语言变了都会作废。作废的封面先照常显示（stale），看到哪张重画哪张，不一口气全部重建。
// - 网格图解码后很大（320×180×4 字节 × 帧数，最多约 27 MB）：解码好的只留正在播放的一张，其余按 PNG 留在内存（总量有上限）；
//   磁盘上一张最多 8 MB（MAX_THUMB_BYTES），超过的只在内存里。
// - 官网（apps/website）的模板一节用 ensure：不看位置，封面和悬停预览全都生成，网格图解码好放在 covers[key].sheet（和原来一样）。
// - 没有原版素材时要不要生成封面（docs/template-catalog.md 5.2）还没定：现在照常生成。要改时只改 coverPolicy，模板库按 policy 换成引导。
import { defaultParams } from '@allay/template-sdk';
import i18next from 'i18next';
import { create } from 'zustand';
import { MAX_THUMB_BYTES, type ResourceState } from '../../../shared/resources';
import type { TemplateEntry } from '../../../shared/templates';
import { EngineHost } from '../../engine-host/EngineHost';
import { createResolver } from '../../engine-host/resource-client';
import { openStill, STILL_FAST, type StillSession } from '../../engine-host/still';
import { currentStamp, useResourceStore } from '../../stores/resourceStore';
import { readTemplate, type AssetSource } from '../../templates/catalog';
import { previewActivity } from '../preview/activity';
import { CoverPlan, type CoverJob, type CoverJobKind, type CoverLane } from './cover-plan';
import { COVER_FPS, COVER_H, COVER_W, coverDiskKey, coverFrame, coverKey } from './covers-key';

export { COVER_FPS, COVER_H, COVER_W, coverDiskKey, coverFrame, coverKey };

/** 悬停预览最多 4 秒 */
const MAX_FRAMES = COVER_FPS * 4;
const SHEET_COLS = 8;
const STAMP_RE = /^[0-9a-f]{16}$/;
/** 预览忙完以后再安静这么久，封面才接着做 */
const PREVIEW_QUIET_MS = 150;
/** 渲染悬停预览时每隔几帧看一次：还有没有人要、预览忙不忙 */
const SHEET_CHECK_EVERY = 4;
/** 内存里留着的网格图 PNG 的总量 */
const SHEET_MEMORY_BYTES = 48 * 1024 * 1024;
/** 杂务 Worker 空闲多久就销毁（不占着显存）：封面是一阵一阵要的（启动、滚动、资源栈变化） */
const WORKER_IDLE_MS = 15_000;
/** 同时读磁盘缓存的个数 */
const DISK_CONCURRENCY = 3;

export interface Cover {
  url: string;
  /** 悬停预览的帧网格（解码好的位图）：只有 ensure 要过的才放在这里（官网）；模板库的悬停预览在 hover 里 */
  sheet: ImageBitmap | null;
  frames: number;
  cols: number;
  /** 资源栈、模板内容或界面语言变了，这张是旧的：照样显示，轮到它时重画 */
  stale: boolean;
}

/** 模板库当前悬停的那张卡片的悬停预览 */
export interface HoverSheet {
  key: string;
  state: 'loading' | 'ready' | 'failed';
  /** 渲染的进度（0–1）；从缓存读、还没开始渲染时为 null */
  progress: number | null;
  /** 画好的网格图（state 为 ready） */
  sheet: ImageBitmap | null;
  /** 正在渲染的网格图：边画边播，只有前 ready 帧是画好的（渲染比 30 fps 的播放快，一般追不上）；画完换成 sheet */
  partial: OffscreenCanvas | null;
  ready: number;
  frames: number;
  cols: number;
}

/** 'render'：照常生成；'guide'：不生成，模板库换成引导（docs/template-catalog.md 5.2 的选项 1，还没定，现在不用） */
export type CoverPolicy = 'render' | 'guide';

/** 生成封面的策略。没有原版素材时也照常生成（贴图是占位图），这是所有者在 5.2 定下之前的行为 */
export function coverPolicy(_state: ResourceState | null): CoverPolicy {
  return 'render';
}

interface CoverState {
  /** 按 coverKey(id, version)：没有这一项 = 还没生成；null = 生成失败（原因在 failures 里） */
  covers: Record<string, Cover | null>;
  failures: Record<string, string>;
  hover: HoverSheet | null;
  /** 可见范围里还没有当前封面的卡片数 */
  pending: number;
  /** 启动、资源栈变化之后，可见范围里的封面还没全部画好（模板库的加载编排看它，07-allay-mascot.md 7.5 第 2 项） */
  redrawing: boolean;
  policy: CoverPolicy;
  stamp: string;
}

export const useCoverStore = create<CoverState>(() => ({ covers: {}, failures: {}, hover: null, pending: 0, redrawing: false, policy: 'render', stamp: '' }));

function toPng(canvas: OffscreenCanvas): Promise<Blob> {
  return canvas.convertToBlob({ type: 'image/png' });
}

const bytesOf = async (b: Blob) => new Uint8Array(await b.arrayBuffer());
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** 网格图的 PNG，按用到的先后淘汰，总量不超过 limit */
class BlobMemory {
  private readonly map = new Map<string, Blob>();
  private total = 0;
  constructor(private readonly limit: number) {}
  get(key: string): Blob | undefined {
    const b = this.map.get(key);
    if (b) {
      this.map.delete(key);
      this.map.set(key, b);
    }
    return b;
  }
  set(key: string, blob: Blob): void {
    const had = this.map.get(key);
    if (had) this.total -= had.size;
    this.map.delete(key);
    if (blob.size > this.limit) return;
    this.map.set(key, blob);
    this.total += blob.size;
    for (const [k, b] of this.map) {
      if (this.total <= this.limit) break;
      this.map.delete(k);
      this.total -= b.size;
    }
  }
  get bytes(): number {
    return this.total;
  }
}

/** 测试钩子看的统计（T-GAL）：生成过哪些、撤掉过哪些 */
export interface CoverStats {
  /** 渲染过封面的模板（coverKey，按先后） */
  rendered: string[];
  /** 渲染完的悬停预览 */
  sheets: string[];
  /** 排过队、没开始就撤掉的封面 */
  dropped: string[];
  /** 渲染到一半停掉的悬停预览 */
  aborted: string[];
  diskHits: number;
  queue: string[];
  running: string | null;
  view: { visible: string[]; near: string[] };
  sheetMemoryBytes: number;
}

interface Pinned {
  bitmap: ImageBitmap;
  frames: number;
  identity: string;
}

class CoverService {
  private readonly plan = new CoverPlan();
  /** coverKey → 模板（setView、setHover、ensure 见过的） */
  private readonly entries = new Map<string, TemplateEntry>();
  /** store 里那张封面是按什么画的（identity） */
  private readonly drawnAs = new Map<string, string>();
  /** 这个 identity 的磁盘缓存已经找过、没有 */
  private readonly diskMissed = { cover: new Map<string, string>(), sheet: new Map<string, string>() };
  /** 这个 identity 渲染失败过：不再重试（换了素材、内容或语言再试） */
  private readonly failedAs = { cover: new Map<string, string>(), sheet: new Map<string, string>() };
  /** ensure 要过的网格图（官网） */
  private readonly pinned = new Map<string, Pinned>();
  private readonly sheetPng = new BlobMemory(SHEET_MEMORY_BYTES);
  /** 正在读磁盘缓存的（kind:key） */
  private readonly diskBusy = new Set<string>();
  /** 正在把网格图解码给悬停预览的（key → 在途的个数；这时不要再去渲染一遍） */
  private readonly decoding = new Map<string, number>();
  private diskQueue: { kind: CoverJobKind; key: string }[] = [];
  private diskRunning = 0;
  private running: CoverJob | null = null;
  private pumping = false;
  private host: Promise<EngineHost> | null = null;
  private assets: AssetSource | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  /** 悬停的那张卡片要的网格图按什么画（identity） */
  private hoverIdentity = '';
  /** 启动、资源栈变化以后的这一批还没画完（见 CoverState.redrawing） */
  private batch = true;
  private viewSeen = false;
  private readonly stats: Pick<CoverStats, 'rendered' | 'sheets' | 'dropped' | 'aborted' | 'diskHits'> = { rendered: [], sheets: [], dropped: [], aborted: [], diskHits: 0 };
  /** 测试钩子：悬停预览每渲染一帧多等这么久（e2e 要在渲染中途移开指针） */
  private frameDelay = 0;

  constructor() {
    useResourceStore.subscribe((s, prev) => {
      if (s.state?.stamp !== prev.state?.stamp) this.invalidate(true);
      const policy = coverPolicy(s.state);
      if (policy !== useCoverStore.getState().policy) useCoverStore.setState({ policy });
    });
    i18next.on('languageChanged', () => this.invalidate(false));
    useCoverStore.setState({ stamp: currentStamp(), policy: coverPolicy(useResourceStore.getState().state) });
  }

  // ---- 对外 ----

  /**
   * 模板库报来可见范围附近的卡片（按界面上的先后）：只给这些生成封面，不在里面的、还没开始的撤掉。
   * 模板库卸载（换到别的标签页）时报一个空列表。
   */
  setView(items: readonly { entry: TemplateEntry; lane: 'visible' | 'near' }[]): void {
    const queued = this.plan.queue((j) => j.kind === 'cover' && (j.lane === 'visible' || j.lane === 'near') && this.needed(j)).map((j) => j.key);
    const next: { key: string; lane: 'visible' | 'near' }[] = [];
    for (const it of items) {
      if (it.entry.baseMissing) continue;
      const key = coverKey(it.entry.id, it.entry.version);
      this.entries.set(key, it.entry);
      next.push({ key, lane: it.lane });
    }
    this.plan.setView(next);
    if (next.length > 0) this.viewSeen = true;
    // 悬停着的那个模板内容变了（开发模式里改了文件）：悬停预览按新的重新取
    const hovered = this.plan.hover ? this.entries.get(this.plan.hover) : undefined;
    if (hovered && this.identity(hovered) !== this.hoverIdentity) this.setHover(hovered);
    for (const k of queued) if (!this.plan.wanted('cover', k)) this.stats.dropped.push(k);
    for (const n of next) this.lookup('cover', n.key);
    this.refresh();
    this.pump();
  }

  /** 指针（或键盘焦点）在这张卡片上停够了：要它的悬停预览；null 表示移开了 */
  setHover(entry: TemplateEntry | null): void {
    const key = entry && !entry.baseMissing ? coverKey(entry.id, entry.version) : null;
    const identity = entry && key ? this.identity(entry) : '';
    if (key === this.plan.hover && identity === this.hoverIdentity) return;
    if (entry && key) this.entries.set(key, entry);
    this.plan.setHover(key);
    this.hoverIdentity = identity;
    const old = useCoverStore.getState().hover;
    if (old?.sheet) closeLater(old.sheet);
    if (!entry || !key) {
      useCoverStore.setState({ hover: null });
      return;
    }
    useCoverStore.setState({ hover: { key, state: 'loading', progress: null, sheet: null, partial: null, ready: 0, frames: 0, cols: SHEET_COLS } });
    if (this.failedAs.sheet.get(key) === identity) {
      useCoverStore.setState({ hover: { key, state: 'failed', progress: null, sheet: null, partial: null, ready: 0, frames: 0, cols: SHEET_COLS } });
      return;
    }
    const memo = this.sheetPng.get(this.sheetMemKey(entry));
    if (memo) {
      void this.decodeFor(key, identity, memo);
      return;
    }
    this.lookup('sheet', key);
    this.pump();
  }

  /** 官网的模板一节：这些模板的封面和悬停预览都要，不看位置 */
  ensure(entries: readonly TemplateEntry[]): void {
    const keys: string[] = [];
    for (const e of entries) {
      if (e.baseMissing) continue;
      const key = coverKey(e.id, e.version);
      this.entries.set(key, e);
      keys.push(key);
    }
    this.plan.addBackground(keys);
    for (const k of keys) {
      this.lookup('cover', k);
      this.lookup('sheet', k);
    }
    this.pump();
  }

  /** 测试钩子 */
  setTestFrameDelay(ms: number): void {
    this.frameDelay = Math.max(0, Math.min(1000, ms));
  }

  /** 测试钩子 */
  debugStats(): CoverStats {
    const visible: string[] = [];
    const near: string[] = [];
    for (const j of this.plan.queue()) {
      if (j.kind !== 'cover') continue;
      if (j.lane === 'visible') visible.push(j.key);
      else if (j.lane === 'near') near.push(j.key);
    }
    return {
      ...structuredClone(this.stats),
      queue: this.plan.queue((j) => this.needed(j)).map((j) => `${j.kind}:${j.key}`),
      running: this.running ? `${this.running.kind}:${this.running.key}` : null,
      view: { visible, near },
      sheetMemoryBytes: this.sheetPng.bytes,
    };
  }

  // ---- 状态 ----

  private locale(): string {
    return i18next.language || 'en';
  }

  /** 一张封面是按什么画的：资源栈、模板内容、语言 */
  private identity(entry: TemplateEntry): string {
    return `${currentStamp()}|${entry.contentHash}|${this.locale()}`;
  }

  private diskKey(entry: TemplateEntry, kind: CoverJobKind): string {
    const k = coverDiskKey(entry, this.locale());
    return kind === 'sheet' ? `${k}~sheet` : k;
  }

  /** 内存里网格图 PNG 的键：磁盘的键加上 resourceStamp（磁盘上 stamp 是目录，内存里要写进键里） */
  private sheetMemKey(entry: TemplateEntry): string {
    return `${currentStamp()}/${this.diskKey(entry, 'sheet')}`;
  }

  /** 这个模板当前的网格图已经有了：悬停的那张已经在播（或在解码），或者官网要的已经挂上 */
  private haveSheet(key: string, identity: string): boolean {
    if ((this.decoding.get(key) ?? 0) > 0) return true;
    if (this.plan.hover === key) {
      const h = useCoverStore.getState().hover;
      return h?.key === key && h.state !== 'loading' && this.hoverIdentity === identity;
    }
    return this.pinned.get(key)?.identity === identity;
  }

  /** store 里有这个模板当前的封面 */
  private fresh(key: string): boolean {
    const e = this.entries.get(key);
    return !!e && this.drawnAs.get(key) === this.identity(e) && !!useCoverStore.getState().covers[key];
  }

  /** 这件活现在要不要做：已经有了、还在找磁盘缓存、正在做、失败过的都不要 */
  private needed(job: CoverJob): boolean {
    const e = this.entries.get(job.key);
    if (!e || e.baseMissing || useCoverStore.getState().policy !== 'render') return false;
    if (this.running?.kind === job.kind && this.running.key === job.key) return false;
    const id = this.identity(e);
    if (this.failedAs[job.kind].get(job.key) === id || this.diskMissed[job.kind].get(job.key) !== id) return false;
    return job.kind === 'cover' ? !this.fresh(job.key) : !this.haveSheet(job.key, id);
  }

  /** 资源栈（stamp = true）或语言变了：现有的封面标成过期（照常显示），正在要的重新找缓存、重新画 */
  private invalidate(stamp: boolean): void {
    const covers = useCoverStore.getState().covers;
    const next: Record<string, Cover | null> = {};
    for (const [k, c] of Object.entries(covers)) next[k] = c ? { ...c, stale: true } : c;
    useCoverStore.setState({ covers: next, failures: {}, ...(stamp ? { stamp: currentStamp() } : {}) });
    this.failedAs.cover.clear();
    this.failedAs.sheet.clear();
    this.batch = true;
    const hover = this.plan.hover;
    if (hover) this.setHover(this.entries.get(hover) ?? null);
    for (const j of this.plan.queue()) this.lookup(j.kind, j.key);
    this.refresh();
    this.pump();
  }

  /** 重算 pending、redrawing */
  private refresh(): void {
    const s = useCoverStore.getState();
    let pending = 0;
    for (const j of this.plan.queue()) if (j.kind === 'cover' && j.lane === 'visible' && !this.fresh(j.key) && s.covers[j.key] !== null) pending++;
    if (pending === 0 && this.viewSeen) this.batch = false;
    const redrawing = this.batch && pending > 0;
    if (pending !== s.pending || redrawing !== s.redrawing) useCoverStore.setState({ pending, redrawing });
  }

  private setCover(key: string, identity: string, url: string): void {
    const s = useCoverStore.getState();
    const old = s.covers[key];
    if (old && old.url !== url) URL.revokeObjectURL(old.url);
    this.drawnAs.set(key, identity);
    const pin = this.pinned.get(key);
    const failures = { ...s.failures };
    delete failures[key];
    const cover: Cover = { url, sheet: pin?.bitmap ?? null, frames: pin?.frames ?? 0, cols: SHEET_COLS, stale: false };
    useCoverStore.setState({ covers: { ...s.covers, [key]: cover }, failures });
    this.refresh();
  }

  private setFailed(kind: CoverJobKind, key: string, identity: string, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[covers] ${kind} ${key} failed: ${message}`);
    this.failedAs[kind].set(key, identity);
    if (kind === 'sheet') {
      const h = useCoverStore.getState().hover;
      if (h?.key === key) useCoverStore.setState({ hover: { ...h, state: 'failed', progress: null, partial: null, ready: 0 } });
      return;
    }
    const s = useCoverStore.getState();
    // 过期的旧封面也不留：这个模板现在画不出来，卡片显示出错的样子
    const old = s.covers[key];
    if (old) URL.revokeObjectURL(old.url);
    useCoverStore.setState({ covers: { ...s.covers, [key]: null }, failures: { ...s.failures, [key]: message.slice(0, 300) } });
    this.refresh();
  }

  // ---- 磁盘缓存 ----

  /** 先找磁盘缓存（不占杂务 Worker，几个一起读）；没有才排进渲染 */
  private lookup(kind: CoverJobKind, key: string): void {
    const e = this.entries.get(key);
    if (!e || e.baseMissing) return;
    const id = this.identity(e);
    if (this.diskMissed[kind].get(key) === id) return;
    if (kind === 'cover' ? this.fresh(key) : this.haveSheet(key, id)) return;
    const tag = `${kind}:${key}`;
    if (this.diskBusy.has(tag)) return;
    this.diskBusy.add(tag);
    this.diskQueue.push({ kind, key });
    this.drainDisk();
  }

  private drainDisk(): void {
    while (this.diskRunning < DISK_CONCURRENCY && this.diskQueue.length > 0) {
      const job = this.diskQueue.shift()!;
      this.diskRunning++;
      void this.readDisk(job.kind, job.key)
        .catch((error: unknown) => console.warn(`[covers] disk ${job.kind} ${job.key}: ${error instanceof Error ? error.message : String(error)}`))
        .finally(() => {
          this.diskRunning--;
          this.diskBusy.delete(`${job.kind}:${job.key}`);
          // 读的时候资源栈、语言变了（这一次的结果作废了）：还要的话按新的再找一次；找到了、确定没有的，lookup 自己会跳过
          if (this.plan.wanted(job.kind, job.key)) this.lookup(job.kind, job.key);
          this.drainDisk();
          this.refresh();
          this.pump();
        });
    }
  }

  private async readDisk(kind: CoverJobKind, key: string): Promise<void> {
    const e = this.entries.get(key);
    if (!e) return;
    // 已经没人要了：不读（还要时会再来找）
    if (!this.plan.wanted(kind, key)) return;
    const id = this.identity(e);
    const stamp = currentStamp();
    // 还没拿到资源栈（或者官网这种不是 16 位的 stamp）：没有磁盘缓存可找，直接去渲染
    const png = STAMP_RE.test(stamp) ? await window.allay.cache.getThumb(stamp, this.diskKey(e, kind)).catch(() => null) : null;
    if (this.identity(e) !== id) return;
    if (!png) {
      this.diskMissed[kind].set(key, id);
      return;
    }
    this.stats.diskHits++;
    const blob = new Blob([png as Uint8Array<ArrayBuffer>], { type: 'image/png' });
    if (kind === 'cover') {
      this.setCover(key, id, URL.createObjectURL(blob));
      return;
    }
    this.sheetPng.set(this.sheetMemKey(e), blob);
    if (this.plan.hover === key) await this.decodeFor(key, id, blob);
    else if (this.plan.wanted('sheet', key)) await this.pinSheet(key, id, await createImageBitmap(blob), null);
  }

  /** 解码给悬停预览，解码期间记着（haveSheet 据此不再排渲染） */
  private async decodeFor(key: string, identity: string, blob: Blob): Promise<void> {
    this.decoding.set(key, (this.decoding.get(key) ?? 0) + 1);
    try {
      await this.showSheet(key, identity, blob);
    } finally {
      const left = (this.decoding.get(key) ?? 1) - 1;
      if (left > 0) this.decoding.set(key, left);
      else this.decoding.delete(key);
    }
  }

  /** 把网格图解码给悬停预览 */
  private async showSheet(key: string, identity: string, blob: Blob, frames: number | null = null): Promise<void> {
    let bitmap: ImageBitmap;
    try {
      bitmap = await createImageBitmap(blob);
    } catch (error) {
      this.setFailed('sheet', key, identity, error);
      return;
    }
    const entry = this.entries.get(key);
    if (this.plan.hover !== key || !entry || this.identity(entry) !== identity) {
      bitmap.close();
      return;
    }
    this.showReady(key, identity, bitmap, frames ?? cellsOf(bitmap), SHEET_COLS);
  }

  /** 悬停预览就绪：换上新的位图（同一张卡片上原来的那张过一会儿释放） */
  private showReady(key: string, identity: string, bitmap: ImageBitmap, frames: number, cols: number): void {
    const prev = useCoverStore.getState().hover;
    if (prev?.sheet && prev.sheet !== bitmap) closeLater(prev.sheet);
    this.hoverIdentity = identity;
    useCoverStore.setState({ hover: { key, state: 'ready', progress: null, sheet: bitmap, partial: null, ready: frames, frames, cols } });
  }

  /** 写进磁盘缓存：写之前再看一次资源栈有没有变（变了就不写，主进程那边也会拒收） */
  private async store(stamp: string, key: string, png: Blob): Promise<void> {
    if (!STAMP_RE.test(stamp)) return;
    const bytes = await bytesOf(png);
    if (stamp !== currentStamp()) return;
    await window.allay.cache.putThumb(stamp, key, bytes).catch(() => undefined);
  }

  /** 官网要的网格图：解码好挂在封面上（封面还没好时先记着，setCover 时挂上） */
  private async pinSheet(key: string, identity: string, bitmap: ImageBitmap, frames: number | null): Promise<void> {
    const e = this.entries.get(key);
    if (!e || this.identity(e) !== identity) {
      bitmap.close();
      return;
    }
    const old = this.pinned.get(key);
    if (old && old.bitmap !== bitmap) closeLater(old.bitmap);
    const pin = { bitmap, frames: frames ?? cellsOf(bitmap), identity };
    this.pinned.set(key, pin);
    const covers = useCoverStore.getState().covers;
    const c = covers[key];
    if (c) useCoverStore.setState({ covers: { ...covers, [key]: { ...c, sheet: pin.bitmap, frames: pin.frames, cols: SHEET_COLS } } });
  }

  // ---- 渲染 ----

  /** 一次只做一件：按计划挑下一件，等预览不忙，再做 */
  private pump(): void {
    if (this.pumping) return;
    this.pumping = true;
    void this.loop().finally(() => {
      this.pumping = false;
      this.refresh();
      // 收尾的这一刻又来了活（pumping 还是 true 时被挡掉的）：接着做
      if (this.plan.next((j) => this.needed(j))) this.pump();
      else this.scheduleIdleDispose();
    });
  }

  private async loop(): Promise<void> {
    for (;;) {
      if (!this.plan.next((j) => this.needed(j))) return;
      this.cancelIdleDispose();
      await this.waitForPreview();
      // 等的时候计划可能变了：重新挑
      const job = this.plan.next((j) => this.needed(j));
      if (!job) return;
      this.running = job;
      try {
        if (job.kind === 'cover') await this.renderCover(job.key);
        else await this.renderSheet(job.key, job.lane);
      } finally {
        this.running = null;
      }
    }
  }

  /**
   * 预览在换模板、改参数（或刚忙完）时先等着；原版层还在后台探测时也等着（探测完资源栈会变，这时画的封面马上就作废）
   */
  private async waitForPreview(): Promise<void> {
    while (previewActivity.busy(PREVIEW_QUIET_MS) || useResourceStore.getState().state?.detecting === true) await sleep(50);
  }

  private async open(entry: TemplateEntry): Promise<{ still: StillSession; total: number; cut: number }> {
    const source = await readTemplate(entry.id, entry.version);
    if (!source) throw new Error('template not found');
    const host = await this.getHost();
    this.assets = source.assets;
    const locale = this.locale();
    const still = await openStill(host, { source, params: defaultParams(source.params, { locale }), width: COVER_W, height: COVER_H, fps: COVER_FPS, locale });
    const total = Math.max(1, Math.min(MAX_FRAMES, still.frames));
    return { still, total, cut: coverFrame(still.cutTime, total) };
  }

  private async renderCover(key: string): Promise<void> {
    const entry = this.entries.get(key);
    if (!entry) return;
    const id = this.identity(entry);
    const stamp = currentStamp();
    try {
      const { still, cut } = await this.open(entry);
      if (this.identity(entry) !== id) return;
      const img = await still.frame(cut, STILL_FAST);
      const canvas = new OffscreenCanvas(COVER_W, COVER_H);
      const g = canvas.getContext('2d');
      if (!g) throw new Error('2d context unavailable');
      g.putImageData(img, 0, 0);
      const png = await toPng(canvas);
      this.stats.rendered.push(key);
      if (this.identity(entry) !== id) return;
      void this.store(stamp, this.diskKey(entry, 'cover'), png);
      this.setCover(key, id, URL.createObjectURL(png));
    } catch (error) {
      if (this.identity(entry) === id) this.setFailed('cover', key, id, error);
    }
  }

  private async renderSheet(key: string, lane: CoverLane): Promise<void> {
    const entry = this.entries.get(key);
    if (!entry) return;
    const id = this.identity(entry);
    const stamp = currentStamp();
    const stillWanted = () => this.plan.wanted('sheet', key) && this.identity(entry) === id;
    try {
      const { still, total, cut } = await this.open(entry);
      const cols = Math.min(SHEET_COLS, total);
      const sheet = new OffscreenCanvas(cols * COVER_W, Math.ceil(total / cols) * COVER_H);
      const g = sheet.getContext('2d');
      const coverCanvas = new OffscreenCanvas(COVER_W, COVER_H);
      const cg = coverCanvas.getContext('2d');
      if (!g || !cg) throw new Error('2d context unavailable');
      for (let i = 0; i < total; i++) {
        if (i % SHEET_CHECK_EVERY === 0) {
          if (!stillWanted()) {
            this.stats.aborted.push(key);
            return;
          }
          if (previewActivity.busy(PREVIEW_QUIET_MS)) await this.waitForPreview();
        }
        if (this.frameDelay > 0) await sleep(this.frameDelay);
        const img = await still.frame(i, STILL_FAST);
        g.putImageData(img, (i % cols) * COVER_W, Math.floor(i / cols) * COVER_H);
        if (i === cut) cg.putImageData(img, 0, 0);
        // 悬停的那张：第一帧画好就开始播，之后每几帧告诉播放器画到哪了
        if (i === 0 || (i + 1) % SHEET_CHECK_EVERY === 0 || i === total - 1) this.progress(key, lane, sheet, i + 1, total, cols);
      }
      if (!stillWanted()) {
        this.stats.aborted.push(key);
        return;
      }
      this.stats.sheets.push(key);
      const needCover = !this.fresh(key);
      const [sheetPng, coverPng] = await Promise.all([toPng(sheet), needCover ? toPng(coverCanvas) : Promise.resolve(null)]);
      if (this.identity(entry) !== id) return;
      this.sheetPng.set(this.sheetMemKey(entry), sheetPng);
      if (sheetPng.size <= MAX_THUMB_BYTES) {
        void this.store(stamp, this.diskKey(entry, 'sheet'), sheetPng);
        // 磁盘上有了：内存里的被挤掉以后，下次悬停先去磁盘找，不再重画
        this.diskMissed.sheet.delete(key);
      }
      if (coverPng) {
        void this.store(stamp, this.diskKey(entry, 'cover'), coverPng);
        this.setCover(key, id, URL.createObjectURL(coverPng));
      }
      // 复制一份（不用 transferToImageBitmap：那会清空画布，正在边画边播的播放器会闪一帧空白）
      const bitmap = await createImageBitmap(sheet);
      // 上面已经确认过 id 仍是这个模板当前的样子：悬停着就直接给它（不看 hoverIdentity：模板内容变了但卡片还没重新悬停时它是旧的）
      if (this.plan.hover === key && this.identity(entry) === id) this.showReady(key, id, bitmap, total, cols);
      else if (this.plan.wanted('sheet', key)) await this.pinSheet(key, id, bitmap, total);
      else bitmap.close();
    } catch (error) {
      if (this.identity(entry) === id) this.setFailed('sheet', key, id, error);
    }
  }

  private progress(key: string, lane: CoverLane, partial: OffscreenCanvas, ready: number, frames: number, cols: number): void {
    if (lane !== 'hover') return;
    const h = useCoverStore.getState().hover;
    if (h?.key === key && h.state === 'loading') useCoverStore.setState({ hover: { ...h, progress: ready / frames, partial, ready, frames, cols } });
  }

  /** 杂务 Worker：没有、或者上一个已经挂了（看门狗、崩溃）就新建一个 */
  private async getHost(): Promise<EngineHost> {
    if (this.host) {
      const h = await this.host.catch(() => null);
      if (h && !h.dead) return h;
      this.host = null;
    }
    const created = EngineHost.create({ mode: 'utility', resolveResource: createResolver(() => this.assets), strictDeterminism: import.meta.env.DEV });
    this.host = created;
    try {
      return await created;
    } catch (error) {
      if (this.host === created) this.host = null;
      throw error;
    }
  }

  private scheduleIdleDispose(): void {
    this.cancelIdleDispose();
    if (!this.host) return;
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      if (this.running || this.pumping) return;
      const h = this.host;
      this.host = null;
      void h?.then((x) => x.dispose(), () => undefined);
    }, WORKER_IDLE_MS);
  }

  private cancelIdleDispose(): void {
    if (this.idleTimer !== null) clearTimeout(this.idleTimer);
    this.idleTimer = null;
  }
}

/** 磁盘缓存的网格图里有几帧：没有记帧数，按格子数算（末行可能不满，最后几格是全透明的，循环时多停一会儿） */
function cellsOf(sheet: ImageBitmap): number {
  return Math.round((sheet.width / COVER_W) * (sheet.height / COVER_H));
}

/** 位图可能还在某块画布的最后一帧里用着：过一会儿再释放 */
function closeLater(bitmap: ImageBitmap): void {
  setTimeout(() => bitmap.close(), 500);
}

export const covers = new CoverService();
