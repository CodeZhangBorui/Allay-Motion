import { Button } from '@allay/ui/components/button';
import { useEffect, useLayoutEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { usePreviewStore } from '../../stores/previewStore';
import { useProjectStore } from '../../stores/projectStore';
import { useTransportStore } from '../../stores/transportStore';
import { previewEngine } from './previewEngine';

// 中间：预览视口（6.4）。四周是中性灰 --viewport；画布按输出比例居中，四周留 24 px。
// M1：引擎画布 + 棋盘格底 + 错误卡片。背景模式、参考线在 M4。

const PADDING = 24;

/** 按输出比例在可用区域里取最大的矩形；设备像素不超过输出分辨率（2.7） */
function fit(availW: number, availH: number, outW: number, outH: number, dpr: number) {
  const scale = Math.min(availW / outW, availH / outH);
  const cssWidth = Math.max(1, Math.floor(outW * scale));
  const cssHeight = Math.max(1, Math.floor(outH * scale));
  const k = Math.min(1, (cssWidth * dpr) / outW);
  return { cssWidth, cssHeight, pixelWidth: Math.max(1, Math.round(outW * k)), pixelHeight: Math.max(1, Math.round(outH * k)) };
}

export function PreviewArea() {
  const { t } = useTranslation();
  const areaRef = useRef<HTMLElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const output = useProjectStore((s) => s.output);
  const revision = useProjectStore((s) => s.revision);
  const status = usePreviewStore((s) => s.status);

  // 画布由 previewEngine 创建并放进这个容器
  useLayoutEffect(() => {
    previewEngine.mount(stageRef.current);
    return () => previewEngine.mount(null);
  }, []);

  // 区域大小变化 → 画布尺寸
  useLayoutEffect(() => {
    const area = areaRef.current;
    if (!area) return;
    const update = () => {
      const w = area.clientWidth - PADDING * 2;
      const h = area.clientHeight - PADDING * 2;
      if (w <= 0 || h <= 0) return;
      previewEngine.setViewport(fit(w, h, output.width, output.height, window.devicePixelRatio || 1));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(area);
    return () => ro.disconnect();
  }, [output.width, output.height]);

  // 模板或参数变了 → 重新装载（首次由 mount 触发）
  useEffect(() => {
    if (revision > 0) previewEngine.reload();
  }, [revision]);

  // 时间变了 → 重画
  useEffect(
    () =>
      useTransportStore.subscribe((s, prev) => {
        if (s.time !== prev.time) previewEngine.requestRender(s.time);
      }),
    [],
  );

  const failed = status.kind === 'error' || status.kind === 'unresponsive' || status.kind === 'crashed';
  return (
    <section ref={areaRef} aria-label={t('preview.region')} className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-viewport">
      <div
        ref={stageRef}
        data-testid="preview-stage"
        className="preview-checker shadow-md"
        aria-label={t('preview.canvas')}
        role="img"
      />
      {failed && (
        <div
          role="alert"
          data-testid="preview-error"
          data-kind={status.kind}
          className="absolute inset-x-6 top-1/2 mx-auto flex max-w-sm -translate-y-1/2 flex-col gap-2 rounded-md border bg-surface-2 p-4 text-sm shadow-lg"
        >
          <p className="font-medium text-danger">
            {status.kind === 'unresponsive' ? t('preview.unresponsive') : status.kind === 'crashed' ? t('preview.crashed') : t('preview.templateError')}
          </p>
          <p className="text-xs text-fg-muted">
            {status.kind === 'unresponsive' ? t('preview.unresponsiveHint') : status.kind === 'error' || status.kind === 'crashed' ? status.message : ''}
          </p>
          <Button variant="secondary" className="self-start" onClick={() => previewEngine.retry()}>
            {t('preview.retry')}
          </Button>
        </div>
      )}
    </section>
  );
}
