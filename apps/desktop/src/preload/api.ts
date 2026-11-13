import type {
  ExportFinishResult,
  ExportStartRequest,
  ExportStartResult,
  ExportStepResult,
  FfmpegInfo,
} from '../shared/export';
import type { AppInfo, PickedFile, TitleBarColors } from '../shared/ipc-contract';
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
}
