import type {
  ExportFinishResult,
  ExportStartRequest,
  ExportStartResult,
  ExportStepResult,
  FfmpegInfo,
} from '../shared/export';
import type { BitmapFontTables } from '@allay/assets';
import type { AppInfo, PickedFile, TitleBarColors } from '../shared/ipc-contract';
import type { HostCommandRequest, HostCommandResult } from '../shared/host-commands';
import type { AddPackResult, CacheUsage, ChooseGameDirResult, DownloadResult, FontProvidersResult, ResourceState } from '../shared/resources';
import type { ProjectData, ProjectOpenResult, ProjectSaveResult, RecentProject } from '../shared/project';
import type { UiSettings, UiSettingsPatch } from '../shared/settings';
import type {
  CommitResult,
  CopyBuiltinRequest,
  ExportFileResult,
  InstallReport,
  PresetEntry,
  PresetImportResult,
  SaveDerivedRequest,
  SavePresetRequest,
  StageResult,
  TemplateBundle,
  TemplateDevChange,
  TemplateDevResult,
  TemplateEntry,
} from '../shared/templates';

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
  templates: {
    /** 内置和已安装的全部模板 */
    list(): Promise<TemplateEntry[]>;
    /** 装载需要的 manifest（派生模板已套上 overrides）和代码；不存在或基模板缺失时为 null */
    read(id: string, version: string): Promise<TemplateBundle | null>;
    /** 模板包 assets/ 里的文件（asset: 引用） */
    readAsset(source: { id: string; version: string } | { stagingId: string }, path: string): Promise<Uint8Array | null>;
    /** 弹出主进程的对话框选 .allaytpl，做 4.8 的第 1–3 步并解压到暂存区 */
    install(): Promise<StageResult>;
    /** 拖进窗口的模板包：只接收 File 对象，路径由 preload 取 */
    installDropped(file: File): Promise<StageResult>;
    /** 试运行之后：把暂存的包装上，记下试运行的警告 */
    commitInstall(stagingId: string, report: InstallReport): Promise<CommitResult>;
    cancelInstall(stagingId: string): Promise<void>;
    /** 只能删用户模板 */
    remove(id: string, version: string): Promise<boolean>;
    /** 弹出主进程的保存对话框，导出成 .allaytpl */
    exportPackage(id: string, version: string): Promise<ExportFileResult>;
    /** 另存为派生模板（4.7） */
    saveDerived(req: SaveDerivedRequest): Promise<{ ok: true; entry: TemplateEntry } | { ok: false; error: string }>;
    // ---- 模板开发模式（MD）：界面接线在 MD-b ----
    /** 把内置模板复制成可编辑的用户模板（新 id，版本 1.0.0），并写好 template-api.d.ts 和 jsconfig.json */
    copyBuiltin(req: CopyBuiltinRequest): Promise<TemplateDevResult<{ entry: TemplateEntry }>>;
    /** 往用户模板的文件夹写 template-api.d.ts 和 jsconfig.json */
    writeDevFiles(id: string, version: string): Promise<TemplateDevResult>;
    /** 在系统文件管理器里打开用户模板的文件夹 */
    openFolder(id: string, version: string): Promise<TemplateDevResult>;
    /** 用户模板文件夹在应用之外被改动（应用自己的写入不触发）；返回取消订阅的函数 */
    onChanged(callback: (change: TemplateDevChange) => void): () => void;
  };
  presets: {
    list(): Promise<PresetEntry[]>;
    save(req: SavePresetRequest): Promise<PresetEntry>;
    remove(id: string): Promise<boolean>;
    /** 弹出主进程的对话框导入 .allaypreset */
    importFile(): Promise<PresetImportResult>;
    /** 弹出主进程的保存对话框导出 */
    exportFile(id: string): Promise<ExportFileResult>;
  };
  project: {
    /** 弹出主进程的打开对话框 */
    open(): Promise<ProjectOpenResult>;
    openRecent(id: string): Promise<ProjectOpenResult>;
    /** 保存到句柄对应的文件；句柄为 null 时弹出保存对话框 */
    save(handle: string | null, data: ProjectData): Promise<ProjectSaveResult>;
    /** 弹出保存对话框 */
    saveAs(data: ProjectData): Promise<ProjectSaveResult>;
    recents(): Promise<RecentProject[]>;
  };
  host: {
    /** 主进程请界面执行命令（H11）；请求在界面一侧再按 schema 校验。返回取消订阅的函数 */
    onCommand(callback: (request: HostCommandRequest) => void): () => void;
    /** 交回命令的结果；主进程按 schema 校验 */
    commandResult(result: HostCommandResult): Promise<boolean>;
  };
  cache: {
    getThumb(stamp: string, key: string): Promise<Uint8Array | null>;
    putThumb(stamp: string, key: string, png: Uint8Array): Promise<void>;
    clear(): Promise<void>;
    usage(): Promise<CacheUsage>;
  };
}
