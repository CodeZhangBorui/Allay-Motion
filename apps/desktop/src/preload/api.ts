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
}
