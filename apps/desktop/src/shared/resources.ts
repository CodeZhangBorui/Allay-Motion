import { isSafeRelativePath } from '@allay/assets';
import { z } from 'zod';

// resources、cache 两个 IPC 命名空间的数据（docs/01-product-architecture.md 1.8、docs/03-assets.md）。
// 主进程和渲染进程共用；入参 schema 在 ipc-contract.ts 里组装成 tuple。

/** 资源栈里一层的展示信息（6.4 资源栈弹层） */
export interface LayerInfo {
  id: string;
  kind: 'builtin' | 'vanilla' | 'pack';
  name: string;
  description?: string;
  packFormat?: number;
  /** pack.png（渲染进程做成 blob URL 显示） */
  icon?: Uint8Array;
  enabled: boolean;
  /** 1.12 及更早的命名，大部分贴图不会生效（3.5） */
  legacyFormat: boolean;
  warnings: string[];
  /** 原版层：本机游戏还是下载的；资源包：zip 还是文件夹 */
  source?: 'local' | 'downloaded' | 'zip' | 'folder';
  /** 内置层里有没有任何文件（v1 不自制素材，通常是空的） */
  empty?: boolean;
}

/** 设置里登记了、但打不开的资源包（文件被删、zip 被拒绝） */
export interface BrokenPack {
  id: string;
  name: string;
  problem: 'missing' | 'rejected' | 'unreadable';
}

export interface VanillaState {
  /** 用户是否同意使用原版素材；null 表示还没问过 */
  consent: boolean | null;
  enabled: boolean;
  /** 本机探测到的游戏（离线） */
  local: { versionId: string; gameDir: string } | null;
  /** 下载缓存里的版本（离线检查） */
  cached: { versionId: string } | null;
  /** 当前资源栈里用的是哪个 */
  active: 'local' | 'cached' | null;
  /** 同意过使用原版素材，但游戏和下载缓存都找不到了（missing），或者 jar 打不开（jar-unreadable）；已静默退回 */
  problem: 'missing' | 'jar-unreadable' | null;
}

export type DownloadErrorKind = 'network' | 'verify' | 'disk' | 'unknown';

export type DownloadState =
  | { status: 'idle' }
  | { status: 'running'; phase: 'manifest' | 'version' | 'jar' | 'index' | 'object'; received: number; total: number | null }
  | { status: 'failed'; error: DownloadErrorKind };

export interface ResourceState {
  /** 资源栈指纹（3.2）：变了，引擎缓存和缩略图缓存一起失效 */
  stamp: string;
  /** 从下到上，与解析顺序相反（下标 0 是 builtin） */
  layers: LayerInfo[];
  brokenPacks: BrokenPack[];
  vanilla: VanillaState;
  download: DownloadState;
  /** 还在启动时的离线探测 */
  detecting: boolean;
  /** 有没有任何启用的素材层（原版层或资源包）。都没有时界面显示引导状态 */
  hasAssets: boolean;
}

export type AddPackResult =
  | { ok: true; id: string; warnings: string[] }
  | { ok: false; error: 'rejected' | 'unsupported' | 'unreadable'; detail?: string }
  | { canceled: true };

export type ChooseGameDirResult = { ok: true } | { ok: false; error: 'no-release' } | { canceled: true };

export type DownloadResult = { ok: true } | { ok: false; error: DownloadErrorKind | 'busy' } | { canceled: true };

/** fontProviders 的结果：bitmap 提供器只给贴图在资源栈里的路径，由渲染进程读取解码 */
export interface FontProvidersResult {
  providers: (
    | { type: 'bitmap'; file: string; ascent: number; height: number; rows: number[][] }
    | { type: 'space'; advances: [number, number][] }
  )[];
  skipped: string[];
}

export interface CacheUsage {
  files: number;
  bytes: number;
}

// ---- 入参 schema ----

export const ResourcePathSchema = z.string().min(1).max(1024).refine(isSafeRelativePath, { message: 'unsafe resource path' });
export const ResourceIdSchema = z.string().min(1).max(512);
export const ResourcePrefixSchema = z.string().max(1024).refine((p) => p === '' || isSafeRelativePath(p.replace(/\/$/, '')), { message: 'unsafe prefix' });
export const LayerIdSchema = z.string().min(1).max(128);
export const VanillaPatchSchema = z.strictObject({ consent: z.boolean().optional(), enabled: z.boolean().optional() });
export const AddPackKindSchema = z.enum(['zip', 'folder']);
/** 拖放的文件：preload 用 webUtils.getPathForFile 取的路径（页面只传 File） */
export const DroppedPathSchema = z.string().min(3).max(32_767);

export const ResourceStampSchema = z.string().regex(/^[0-9a-f]{16}$/);
/** 缩略图的键：渲染进程把 ID 里的 : 和 / 换成 ~ */
export const ThumbKeySchema = z.string().regex(/^[a-z0-9_.~-]{1,200}$/);
export const MAX_THUMB_BYTES = 1024 * 1024;
export const ThumbPngSchema = z.instanceof(Uint8Array).refine((b) => b.byteLength > 8 && b.byteLength <= MAX_THUMB_BYTES, { message: 'thumbnail must be a PNG of at most 1 MB' });
