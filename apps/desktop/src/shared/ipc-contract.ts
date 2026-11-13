import { z } from 'zod';
import { IPC, type InvokeChannel } from './ipc-channels';
import { UiSettingsPatchSchema } from './settings';

// 每个 invoke 通道的入参 schema（整个参数列表是一个 tuple，多一个参数也拒绝）。
// 主进程的处理函数只接收经过这里校验的参数。

const HexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/);

export const TitleBarColorsSchema = z.strictObject({
  color: HexColor,
  symbolColor: HexColor,
});
export type TitleBarColors = z.infer<typeof TitleBarColorsSchema>;

/** 文件引用：主进程发给渲染进程的不透明 ID，不是路径 */
export const FileRefSchema = z.uuid();

export const IPC_ARGS = {
  [IPC.app.info]: z.tuple([]),
  [IPC.settings.get]: z.tuple([]),
  [IPC.settings.set]: z.tuple([UiSettingsPatchSchema]),
  [IPC.window.setTitleBarColors]: z.tuple([TitleBarColorsSchema]),
  [IPC.files.pickImage]: z.tuple([]),
  [IPC.files.read]: z.tuple([FileRefSchema]),
} as const satisfies Record<InvokeChannel, z.ZodTuple>;

export type IpcArgs<C extends InvokeChannel> = z.infer<(typeof IPC_ARGS)[C]>;

export interface AppInfo {
  version: string;
  platform: string;
  userDataDir: string;
  /** 系统首选语言（BCP 47），用于“跟随系统” */
  systemLocale: string;
}

export interface PickedFile {
  ref: string;
  name: string;
}
