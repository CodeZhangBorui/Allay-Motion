import { Allay, AllayLoader } from '@allay/mascot';
import { Button } from '@allay/ui/components/button';
import { Popover, PopoverContent, PopoverTrigger } from '@allay/ui/components/popover';
import { Skeleton, ToggleGroup, ToggleGroupItem } from '@allay/ui/components/misc';
import { Tooltip, TooltipContent, TooltipTrigger } from '@allay/ui/components/tooltip';
import { PreviewViewport, type PreviewBackground } from '@allay/ui/editor';
import { Grid2x2, Image, Maximize, PaintBucket, Scan, SquareDashed } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { HexColorPicker } from 'react-colorful';
import { useTranslation } from 'react-i18next';
import { notify } from '../../stores/noticeStore';
import { usePreviewStore } from '../../stores/previewStore';
import { useProjectStore } from '../../stores/projectStore';
import { useResourceStore } from '../../stores/resourceStore';
import { useTransportStore } from '../../stores/transportStore';
import { useUiStore } from '../../stores/uiStore';
import { ResourceOnboarding, useShowOnboarding } from '../resources/ResourceOnboarding';
import { previewEngine } from './previewEngine';
import { useDebugLoading } from './debugLoading';

// 中间：预览视口（6.4）。四周是中性灰 --viewport；画布按输出比例等比缩放、居中，四周留 24 px。
// 右上角：背景模式（棋盘格、示例素材、纯色）、安全框参考线、缩放（适应、100%）。
// 引擎装载超过 180 ms 时出现悦灵的加载编排；模板出错时显示错误卡片（一句说明、“重置参数”、“复制诊断信息”）。

const PADDING = 24;

/** 按输出比例在可用区域里取最大的矩形；设备像素不超过输出分辨率（2.7） */
function fit(availW: number, availH: number, outW: number, outH: number, dpr: number) {
  const scale = Math.min(availW / outW, availH / outH);
  const cssWidth = Math.max(1, Math.floor(outW * scale));
  const cssHeight = Math.max(1, Math.floor(outH * scale));
  const k = Math.min(1, (cssWidth * dpr) / outW);
  return { cssWidth, cssHeight, pixelWidth: Math.max(1, Math.round(outW * k)), pixelHeight: Math.max(1, Math.round(outH * k)) };
}

/** “复制诊断信息”：Electron 拒绝一切权限请求（1.6 第 4 条），不用异步剪贴板 API，用一次性的选区复制 */
function copyText(text: string): boolean {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  const ok = document.execCommand('copy');
  ta.remove();
  return ok;
}

function Toolbar() {
  const { t } = useTranslation();
  const editor = useUiStore((s) => s.settings.editor);
  const set = useUiStore.getState().setEditor;
  return (
    <div className="flex items-center gap-1 rounded-lg border bg-surface-1/90 p-0.5 shadow-sm" data-testid="preview-toolbar">
      <ToggleGroup
        value={[editor.background]}
        onValueChange={(v) => {
          const next = v[0] as PreviewBackground | undefined;
          if (next && next !== 'sample') set({ background: next });
        }}
        aria-label={t('preview.background')}
        className="bg-transparent"
      >
        <ToggleGroupItem value="checker" aria-label={t('preview.backgrounds.checker')} title={t('preview.backgrounds.checker')} data-testid="bg-checker">
          <Grid2x2 />
        </ToggleGroupItem>
        <Tooltip>
          <TooltipTrigger render={<span className="inline-flex" />}>
            {/* 示例素材的两张原创示意图原属 M6，范围变更后不自己画（decisions.md M4），先禁用 */}
            <ToggleGroupItem value="sample" disabled aria-label={t('preview.backgrounds.sample')} data-testid="bg-sample">
              <Image />
            </ToggleGroupItem>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="max-w-56">
            {t('preview.sampleUnavailable')}
          </TooltipContent>
        </Tooltip>
        <ToggleGroupItem value="solid" aria-label={t('preview.backgrounds.solid')} title={t('preview.backgrounds.solid')} data-testid="bg-solid">
          <PaintBucket />
        </ToggleGroupItem>
      </ToggleGroup>
      {editor.background === 'solid' && (
        <Popover>
          <PopoverTrigger aria-label={t('preview.solidColor')} className="inline-flex size-6 items-center justify-center rounded-md hover:bg-surface-3">
            <span className="size-3.5 rounded-sm border border-border-strong" style={{ background: editor.solidColor }} />
          </PopoverTrigger>
          <PopoverContent side="bottom" align="end" className="allay-colorful w-[200px]">
            <HexColorPicker color={editor.solidColor} onChange={(c) => set({ solidColor: c.toUpperCase() })} />
          </PopoverContent>
        </Popover>
      )}
      <span className="mx-0.5 h-4 w-px bg-border" aria-hidden="true" />
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={t('preview.guides')}
        title={t('preview.guides')}
        aria-pressed={editor.guides}
        className={editor.guides ? 'text-primary-text' : 'text-fg-muted'}
        data-testid="preview-guides-toggle"
        onClick={() => set({ guides: !editor.guides })}
      >
        <SquareDashed />
      </Button>
      <ToggleGroup value={[editor.zoom]} onValueChange={(v) => v[0] && set({ zoom: v[0] as 'fit' | '100' })} aria-label={t('preview.zoom')} className="bg-transparent">
        <ToggleGroupItem value="fit" aria-label={t('preview.zoomFit')} title={t('preview.zoomFit')}>
          <Maximize />
        </ToggleGroupItem>
        <ToggleGroupItem value="100" aria-label={t('preview.zoom100')} title={t('preview.zoom100')}>
          <Scan />
        </ToggleGroupItem>
      </ToggleGroup>
    </div>
  );
}

function ErrorCard() {
  const { t, i18n } = useTranslation();
  const status = usePreviewStore((s) => s.status);
  if (status.kind !== 'error' && status.kind !== 'unresponsive' && status.kind !== 'crashed') return null;
  const title = status.kind === 'unresponsive' ? t('preview.unresponsive') : status.kind === 'crashed' ? t('preview.crashed') : t('preview.templateError');
  const detail = status.kind === 'unresponsive' ? t('preview.unresponsiveHint') : status.message;
  const resetParams = () => {
    const s = useProjectStore.getState();
    if (s.template) s.setTemplate(s.template, {}, i18n.language);
    previewEngine.retry();
  };
  const copy = () => {
    const s = useProjectStore.getState();
    const info = {
      status,
      template: s.template?.ref ?? null,
      params: s.params,
      output: s.output,
      resourceStamp: useResourceStore.getState().state?.stamp ?? null,
      userAgent: navigator.userAgent,
      time: new Date().toISOString(),
    };
    const ok = copyText(JSON.stringify(info, null, 2));
    notify(ok ? 'info' : 'error', ok ? t('preview.diagnosticsCopied') : t('preview.diagnosticsFailed'));
  };
  return (
    <div
      role="alert"
      data-testid="preview-error"
      data-kind={status.kind}
      className="absolute inset-x-6 top-1/2 z-20 mx-auto flex max-w-md -translate-y-1/2 items-start gap-3 rounded-lg border bg-surface-2 p-4 text-sm shadow-(--shadow-popover)"
    >
      <Allay clip="sad" size={48} />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <p className="font-semibold text-danger">{title}</p>
        <p className="line-clamp-4 text-xs break-words text-fg-muted">{detail}</p>
        <div className="mt-1 flex flex-wrap gap-2">
          {status.kind === 'error' ? (
            <Button variant="secondary" onClick={resetParams} data-testid="preview-reset-params">
              {t('preview.resetParams')}
            </Button>
          ) : (
            <Button variant="secondary" onClick={() => previewEngine.retry()} data-testid="preview-retry">
              {t('preview.retry')}
            </Button>
          )}
          <Button variant="ghost" onClick={copy} data-testid="preview-copy-diagnostics">
            {t('preview.copyDiagnostics')}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function PreviewArea() {
  const { t } = useTranslation();
  const areaRef = useRef<HTMLElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const output = useProjectStore((s) => s.output);
  const revision = useProjectStore((s) => s.revision);
  const status = usePreviewStore((s) => s.status);
  const editor = useUiStore((s) => s.settings.editor);
  const onboarding = useShowOnboarding();
  const debugLoading = useDebugLoading();
  const [size, setSize] = useState({ width: 0, height: 0 });

  // 画布由 previewEngine 创建并放进这个容器
  useLayoutEffect(() => {
    previewEngine.mount(stageRef.current);
    return () => previewEngine.mount(null);
  }, []);

  // 区域大小或缩放变化 → 画布尺寸
  useLayoutEffect(() => {
    const area = areaRef.current;
    if (!area) return;
    const update = () => {
      const dpr = window.devicePixelRatio || 1;
      if (editor.zoom === '100') {
        const vp = { cssWidth: Math.round(output.width / dpr), cssHeight: Math.round(output.height / dpr), pixelWidth: output.width, pixelHeight: output.height };
        setSize({ width: vp.cssWidth, height: vp.cssHeight });
        previewEngine.setViewport(vp);
        return;
      }
      const w = area.clientWidth - PADDING * 2;
      const h = area.clientHeight - PADDING * 2;
      if (w <= 0 || h <= 0) return;
      const vp = fit(w, h, output.width, output.height, dpr);
      setSize({ width: vp.cssWidth, height: vp.cssHeight });
      previewEngine.setViewport(vp);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(area);
    return () => ro.disconnect();
  }, [output.width, output.height, editor.zoom]);

  // 模板或参数变了 → 重新装载或改参数（首次由 mount 触发）
  useEffect(() => {
    if (revision > 0) previewEngine.reload();
  }, [revision]);

  // 高质量预览：预览也做子帧累积（标准画质）
  useEffect(() => {
    previewEngine.setQuality(editor.hqPreview ? { subframes: 8, shutterAngle: 180 } : undefined);
  }, [editor.hqPreview]);

  // 资源栈变了 → 重新装载（引擎按新的 resourceStamp 清空贴图缓存）
  useEffect(
    () =>
      useResourceStore.subscribe((s, prev) => {
        if (s.state?.stamp !== prev.state?.stamp) previewEngine.reload();
      }),
    [],
  );

  // 时间变了 → 重画
  useEffect(
    () =>
      useTransportStore.subscribe((s, prev) => {
        if (s.time !== prev.time) previewEngine.requestRender(s.time);
      }),
    [],
  );

  const failed = status.kind === 'error' || status.kind === 'unresponsive' || status.kind === 'crashed';
  const loading = status.kind === 'loading' || status.kind === 'starting' || debugLoading;
  return (
    <PreviewViewport
      ref={areaRef}
      label={t('preview.region')}
      stageLabel={t('preview.canvas')}
      stageRef={stageRef}
      background={editor.background === 'sample' ? 'checker' : editor.background}
      solidColor={editor.solidColor}
      guides={editor.guides}
      width={size.width}
      height={size.height}
      scrollable={editor.zoom === '100'}
      toolbar={<Toolbar />}
    >
      {/* 加载编排：视口中央的骨架块 + 飞舞，下方一行状态字（7.5 第 3 项）。整层不接收指针（T-ALY-5） */}
      <div className="pointer-events-none absolute inset-0 z-10" data-testid="preview-loading-layer">
        <AllayLoader loading={loading && !failed} label={t('preview.loading')} className="size-full" testId="preview-loader">
          {loading && !failed ? (
            <div className="flex size-full flex-col items-center justify-center gap-3">
              <Skeleton className="rounded-sm" style={{ width: size.width * 0.6, height: size.height * 0.6 }} />
              <span className="text-xs text-fg-muted">{t('preview.loading')}</span>
            </div>
          ) : null}
        </AllayLoader>
      </div>
      {onboarding && !failed && <ResourceOnboarding />}
      <ErrorCard />
    </PreviewViewport>
  );
}
