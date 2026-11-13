import type {
  ExportFinishResult,
  ExportStartRequest,
  ExportStartResult,
  ExportStepResult,
  FfmpegInfo,
} from '../shared/export';
import type { BitmapFontTables } from '@allay/assets';
import type { AppInfo, PickedFile, TitleBarColors } from '../shared/ipc-contract';
import type { AddPackResult, CacheUsage, ChooseGameDirResult, DownloadResult, FontProvidersResult, ResourceState } from '../shared/resources';
import type { UiSettings, UiSettingsPatch } from '../shared/settings';

/** 渲染进程能看到的唯一接口：window.allay（docs/01-product-architecture.md 1.8） */
export interface AllayApi {
  app: {
    info(): Promise<AppInfo>;
  };
  settings: {
    get(): Promise<UiSettings>;
    set(patch: UiSettingsPatch): Promise<UiSettings>;
    /** 返回取消订阅的函数 */
    onChanged(callback: (settings: UiSettings) => void): () => void;
  };
  window: {
    setTitleBarColors(colors: TitleBarColors): Promise<void>;
  };
  files: {
    /** 弹出主进程的文件对话框；取消时为 null */
    pickImage(): Promise<PickedFile | null>;
    /** 只能读 pickImage 授权过的引用 */
    read(ref: string): Promise<Uint8Array>;
  };
  export: {
    /** 弹出主进程的保存对话框并启动 FFmpeg；用户取消时 canceled 为真 */
    start(req: ExportStartRequest): Promise<ExportStartResult>;
    /** 写一帧直通 alpha 的 RGBA8；数据进了 FFmpeg（必要时等到 drain）才返回 */
    writeFrame(jobId: string, pixels: Uint8Array): Promise<ExportStepResult>;
    finish(jobId: string): Promise<ExportFinishResult>;
    cancel(jobId: string): Promise<void>;
    ffmpegInfo(): Promise<FfmpegInfo>;
  };
  resources: {
    /** 资源栈的完整状态（各层、原版层来源、下载进度、resourceStamp） */
    layers(): Promise<ResourceState>;
    stamp(): Promise<string>;
    /** 资源栈里的一个文件（例如 assets/minecraft/textures/block/stone.png）；没有时为 null */
    read(path: string): Promise<Uint8Array | null>;
    /** 贴图 PNG 和同一层的 .mcmeta */
    readTexture(id: string): Promise<{ png: Uint8Array; mcmeta: string | null } | null>;
    list(prefix: string): Promise<string[]>;
    fontProviders(fontId: string): Promise<FontProvidersResult | null>;
    /** 兜底像素字体 */
    fallbackFont(): Promise<BitmapFontTables | null>;
    /** 重新离线探测本机游戏和下载缓存 */
    detectMinecraft(): Promise<ResourceState>;
    setVanilla(patch: { consent?: boolean; enabled?: boolean }): Promise<ResourceState>;
    /** 弹出主进程的目录对话框选游戏目录 */
    chooseGameDir(): Promise<ChooseGameDirResult>;
    /** 联网：从 Mojang 官方服务器下载最新正式版客户端 jar。只在用户点了按钮后调用 */
    downloadVanilla(): Promise<DownloadResult>;
    cancelDownload(): Promise<void>;
    /** 弹出主进程的对话框添加资源包 */
    addPack(kind: 'zip' | 'folder'): Promise<AddPackResult>;
    /** 拖进窗口的资源包：只接收 File 对象，路径由 preload 取 */
    addDroppedPack(file: File): Promise<AddPackResult>;
    removeLayer(id: string): Promise<ResourceState>;
    /** 资源包从下往上的新顺序 */
    reorder(ids: string[]): Promise<ResourceState>;
    setEnabled(id: string, enabled: boolean): Promise<ResourceState>;
    onChanged(callback: (state: ResourceState) => void): () => void;
  };
  cache: {
    getThumb(stamp: string, key: string): Promise<Uint8Array | null>;
    putThumb(stamp: string, key: string, png: Uint8Array): Promise<void>;
    clear(): Promise<void>;
    usage(): Promise<CacheUsage>;
  };
}
