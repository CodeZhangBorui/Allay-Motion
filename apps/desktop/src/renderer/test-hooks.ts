// 只给自动化测试用的钩子（docs/decisions.md M1“测试钩子”）。只有主进程在未打包、且设置了 ALLAY_E2E_HOOKS 时
// 才在 app.info 里返回 testHooks: true，渲染进程据此装上 window.__allayTest。打包后的应用永远不会装。
// 钩子只调用界面自己也会走的路径（换模板、设时间、读预览），不碰任何安全设置。
import { TemplateManifestSchema, type ParamValues } from '@allay/template-sdk';
import { setExportGate } from './features/export/exportRunner';
import { previewEngine } from './features/preview/previewEngine';
import { thumbnails, type ThumbKind, type ThumbSize } from './features/thumbnails/thumbnails';
import type { ResourceState } from '../shared/resources';
import { useResourceStore } from './stores/resourceStore';
import { usePreviewStore, type PreviewStatus } from './stores/previewStore';
import { useProjectStore } from './stores/projectStore';
import { useTransportStore } from './stores/transportStore';
import { M1_BLOCK_WIPE } from './templates/builtin';

export interface AllayTestHooks {
  /** 换成一段测试模板（不含 import 的 ESM 源码） */
  loadTemplate(code: string, params?: ParamValues): void;
  /** 换回内置的临时模板 */
  loadBuiltin(): void;
  status(): PreviewStatus;
  workerGeneration(): number;
  transport(): { time: number; playing: boolean; duration: number; cutTime: number | null };
  setTime(t: number): void;
  /** 读回预览画布（预乘 alpha，顶部在前）的像素统计 */
  previewStats(t: number): Promise<{ width: number; height: number; maxAlpha: number; minAlpha: number }>;
  /** 预览画布上 (fx, fy)（0–1 的相对位置，左上为原点）的像素，预乘 alpha */
  previewPixel(t: number, fx: number, fy: number): Promise<[number, number, number, number]>;
  /** 渲染进程当前看到的资源栈状态 */
  resourceState(): ResourceState | null;
  /** 取一张缩略图（3.10）：来源（内存、磁盘缓存、新画的）和尺寸 */
  thumbnail(kind: ThumbKind, id: string, size: ThumbSize): Promise<{ source: string; width: number; height: number; stamp: string } | null>;
  /** 预览看门狗的时限（毫秒），测试可以调短 */
  setPreviewTimeouts(t: { load?: number; previewFrame?: number }): void;
  /** 下一次导出写完第 n 帧后停住（FFmpeg 仍在运行），直到 resumeExport 或取消；null 取消这个设置 */
  pauseExportAfter(n: number | null): void;
  /** 导出当前停在第几帧（已写入的帧数）；没有停住时为 null */
  exportPausedAt(): number | null;
  resumeExport(): void;
}

declare global {
  interface Window {
    __allayTest?: AllayTestHooks;
  }
}

export function installTestHooks(): void {
  let pausedAt: number | null = null;
  let release: () => void = () => undefined;
  const hooks: AllayTestHooks = {
    loadTemplate(code, params = {}) {
      const manifest = TemplateManifestSchema.parse({ formatVersion: 1, id: 'test.e2e.template', version: '0.0.0', name: 'test', category: 'transition' });
      useProjectStore.getState().setTemplate({ manifest, code }, params);
      previewEngine.retry();
    },
    loadBuiltin() {
      useProjectStore.getState().setTemplate(M1_BLOCK_WIPE);
      previewEngine.retry();
    },
    status: () => usePreviewStore.getState().status,
    workerGeneration: () => previewEngine.workerGeneration,
    transport: () => {
      const s = useTransportStore.getState();
      return { time: s.time, playing: s.playing, duration: s.duration, cutTime: s.cutTime };
    },
    setTime: (t) => useTransportStore.getState().setTime(t),
    async previewStats(t) {
      const px = await previewEngine.readPreview(t);
      let maxAlpha = 0;
      let minAlpha = 255;
      for (let i = 3; i < px.length; i += 4) {
        const a = px[i]!;
        if (a > maxAlpha) maxAlpha = a;
        if (a < minAlpha) minAlpha = a;
      }
      const size = previewEngine.pixelSize;
      return { width: size?.width ?? 0, height: size?.height ?? 0, maxAlpha, minAlpha };
    },
    async previewPixel(t, fx, fy) {
      const px = await previewEngine.readPreview(t);
      const size = previewEngine.pixelSize;
      if (!size) throw new Error('preview has no size');
      const x = Math.min(size.width - 1, Math.max(0, Math.floor(fx * size.width)));
      const y = Math.min(size.height - 1, Math.max(0, Math.floor(fy * size.height)));
      const o = (y * size.width + x) * 4;
      return [px[o]!, px[o + 1]!, px[o + 2]!, px[o + 3]!];
    },
    resourceState: () => useResourceStore.getState().state,
    async thumbnail(kind, id, size) {
      const stamp = useResourceStore.getState().state?.stamp ?? '';
      const thumb = await thumbnails.get(kind, id, size);
      if (!thumb) return null;
      const img = new Image();
      img.src = thumb.url;
      await img.decode();
      return { source: thumb.source, width: img.naturalWidth, height: img.naturalHeight, stamp };
    },
    setPreviewTimeouts(t) {
      previewEngine.timeouts = { ...previewEngine.timeouts, ...t };
    },
    pauseExportAfter(n) {
      pausedAt = null;
      setExportGate(
        n === null
          ? null
          : (written) => {
              if (written !== n) return Promise.resolve();
              pausedAt = written;
              return new Promise<void>((resolve) => {
                release = () => {
                  pausedAt = null;
                  resolve();
                };
              });
            },
      );
    },
    exportPausedAt: () => pausedAt,
    resumeExport() {
      release();
    },
  };
  Object.defineProperty(window, '__allayTest', { value: Object.freeze(hooks), configurable: false, writable: false });
}
