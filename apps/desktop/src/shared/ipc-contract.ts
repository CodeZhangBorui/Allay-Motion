import { z } from 'zod';
import { ExportJobIdSchema, ExportStartSchema, FramePixelsSchema } from './export';
import { IPC, type InvokeChannel } from './ipc-channels';
import {
  AddPackKindSchema,
  DroppedPathSchema,
  LayerIdSchema,
  ResourceIdSchema,
  ResourcePathSchema,
  ResourcePrefixSchema,
  ResourceStampSchema,
  ThumbKeySchema,
  ThumbPngSchema,
  VanillaPatchSchema,
} from './resources';
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
  [IPC.export.start]: z.tuple([ExportStartSchema]),
  [IPC.export.writeFrame]: z.tuple([ExportJobIdSchema, FramePixelsSchema]),
  [IPC.export.finish]: z.tuple([ExportJobIdSchema]),
  [IPC.export.cancel]: z.tuple([ExportJobIdSchema]),
  [IPC.export.ffmpegInfo]: z.tuple([]),
  [IPC.resources.layers]: z.tuple([]),
  [IPC.resources.stamp]: z.tuple([]),
  [IPC.resources.read]: z.tuple([ResourcePathSchema]),
  [IPC.resources.readTexture]: z.tuple([ResourceIdSchema]),
  [IPC.resources.list]: z.tuple([ResourcePrefixSchema]),
  [IPC.resources.fontProviders]: z.tuple([ResourceIdSchema]),
  [IPC.resources.fallbackFont]: z.tuple([]),
  [IPC.resources.detectMinecraft]: z.tuple([]),
  [IPC.resources.setVanilla]: z.tuple([VanillaPatchSchema]),
  [IPC.resources.chooseGameDir]: z.tuple([]),
  [IPC.resources.downloadVanilla]: z.tuple([]),
  [IPC.resources.cancelDownload]: z.tuple([]),
  [IPC.resources.addPack]: z.tuple([AddPackKindSchema]),
  [IPC.resources.addDroppedPack]: z.tuple([DroppedPathSchema]),
  [IPC.resources.removeLayer]: z.tuple([LayerIdSchema]),
  [IPC.resources.reorder]: z.tuple([z.array(LayerIdSchema).max(256)]),
  [IPC.resources.setEnabled]: z.tuple([LayerIdSchema, z.boolean()]),
  [IPC.cache.getThumb]: z.tuple([ResourceStampSchema, ThumbKeySchema]),
  [IPC.cache.putThumb]: z.tuple([ResourceStampSchema, ThumbKeySchema, ThumbPngSchema]),
  [IPC.cache.clear]: z.tuple([]),
  [IPC.cache.usage]: z.tuple([]),
} as const satisfies Record<InvokeChannel, z.ZodTuple>;

export type IpcArgs<C extends InvokeChannel> = z.infer<(typeof IPC_ARGS)[C]>;

export interface AppInfo {
  version: string;
  platform: string;
  userDataDir: string;
  /** 只在未打包且设置了 ALLAY_E2E_HOOKS 时为真：渲染进程据此装上测试钩子（docs/decisions.md M1） */
  testHooks: boolean;
  /** 系统首选语言（BCP 47），用于“跟随系统” */
  systemLocale: string;
}

export interface PickedFile {
  ref: string;
  name: string;
}
