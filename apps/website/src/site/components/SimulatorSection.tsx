// 仿真器一节：一个仿 Electron 的窗口外框，里面是 iframe（simulator.html），挂着桌面版渲染进程的真实界面。
// - 懒加载：滚动到附近（或点“启动编辑器”）才设置 iframe 的地址，首屏不下载编辑器的代码；
// - 窗口按 1280×800 的逻辑尺寸渲染，容器窄于它时整体等比缩小（应用的最小窗口是 1120×700）；
// - 窄屏（< 900 px）放不下完整编辑器：降级成实时预览 + 模板切换 + 可拖的时间轴；
// - 主题、语言两边同步；需要本机文件的操作和导出结束时，在窗口上给出下载桌面版的引导。
import { buttonVariants, Button } from '@allay/ui/components/button';
import type { EXPORT_PRESETS } from '../../../../desktop/src/shared/export';
import { ArrowSquareOut, Monitor, X } from '@phosphor-icons/react';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { FromSimulatorSchema, readMessage, type DesktopOnlyFeature, type ToSimulator } from '../../host/bridge';
import { REPO_URL, SECTION } from '../links';
import { setLanguage, setTheme, usePrefs } from '../prefs';
import { LiveViewer } from './LiveViewer';
import { Section, SectionHead } from './Section';

const LOGICAL_W = 1280;
const LOGICAL_H = 800;
const WIDE_QUERY = '(min-width: 900px)';

function useWide(): boolean {
  return useSyncExternalStore(
    (fn) => {
      const mq = window.matchMedia(WIDE_QUERY);
      mq.addEventListener('change', fn);
      return () => mq.removeEventListener('change', fn);
    },
    () => window.matchMedia(WIDE_QUERY).matches,
    () => true,
  );
}

/** 页面上别处（模板卡片）请仿真器打开某个模板 */
export const OPEN_TEMPLATE_EVENT = 'site:open-template';
export function requestOpenTemplate(id: string, version: string): void {
  window.dispatchEvent(new CustomEvent(OPEN_TEMPLATE_EVENT, { detail: { id, version } }));
}

const PRESET_KEY: Record<(typeof EXPORT_PRESETS)[number], string> = {
  prores4444: 'prores',
  'png-sequence': 'png',
  'webm-vp9': 'webm',
  'greenscreen-mp4': 'greenscreen',
};

type Notice = { kind: 'desktop-only'; feature: DesktopOnlyFeature } | { kind: 'export'; frames: number; preset: string };

function simulatorUrl(theme: string, language: string): string {
  const q = new URLSearchParams({ theme, lang: language });
  if (new URLSearchParams(window.location.search).has('e2e')) q.set('e2e', '1');
  return `./simulator.html?${q.toString()}`;
}

function SimulatorWindow() {
  const { t } = useTranslation();
  const prefs = usePrefs();
  const outer = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const [started, setStarted] = useState(false);
  const [ready, setReady] = useState(false);
  const [box, setBox] = useState({ scale: 1, width: LOGICAL_W });
  const [notice, setNotice] = useState<Notice | null>(null);
  const pending = useRef<ToSimulator | null>(null);
  // 第一次启动时的主题和语言写进地址（免得先闪一下默认主题）；之后的变化走消息
  const [src, setSrc] = useState<string | null>(null);

  const post = (msg: ToSimulator) => frame.current?.contentWindow?.postMessage(msg, window.location.origin);

  // 滚动到附近就启动
  useEffect(() => {
    const el = outer.current;
    if (!el || started) return;
    const io = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && setStarted(true), { rootMargin: '300px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [started]);

  useEffect(() => {
    if (started && src === null) setSrc(simulatorUrl(prefs.theme, prefs.language));
  }, [started, src, prefs.theme, prefs.language]);

  // 等比缩放
  useEffect(() => {
    const el = outer.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth;
      if (w >= LOGICAL_W) setBox({ scale: 1, width: Math.min(w, 1440) });
      else setBox({ scale: w / LOGICAL_W, width: LOGICAL_W });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 仿真器发来的消息
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow) return;
      const msg = readMessage(event, FromSimulatorSchema);
      if (!msg) return;
      if (msg.type === 'ready') {
        setReady(true);
        if (pending.current) post(pending.current);
        pending.current = null;
      } else if (msg.type === 'settings') {
        // 在编辑器里切了主题或语言：官网跟着切
        if (msg.theme !== document.documentElement.dataset.theme) setTheme(msg.theme);
        if (msg.language !== 'system' && msg.language !== document.documentElement.lang) setLanguage(msg.language);
      } else if (msg.type === 'desktop-only') {
        setNotice({ kind: 'desktop-only', feature: msg.feature });
      } else if (msg.type === 'export-finished') {
        // 先让应用自己的完成页和悦灵的送达演完一小段，再盖上下载引导
        const delay = document.documentElement.dataset.reducedMotion === 'true' ? 0 : 1600;
        window.setTimeout(() => setNotice({ kind: 'export', frames: msg.frames, preset: msg.preset }), delay);
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  // 官网的主题、语言变了：告诉仿真器
  useEffect(() => {
    if (ready) post({ channel: 'allay-site', type: 'settings', theme: prefs.theme, language: prefs.language, reducedMotion: prefs.reducedMotion });
  }, [ready, prefs.theme, prefs.language, prefs.reducedMotion]);

  // 模板卡片上的“在仿真器里打开”
  useEffect(() => {
    const onOpen = (e: Event) => {
      const detail = (e as CustomEvent<{ id: string; version: string }>).detail;
      const msg: ToSimulator = { channel: 'allay-site', type: 'select', id: detail.id, version: detail.version };
      setStarted(true);
      if (ready) post(msg);
      else pending.current = msg;
      document.getElementById(SECTION.try)?.scrollIntoView({ behavior: prefs.reducedMotion ? 'auto' : 'smooth', block: 'start' });
    };
    window.addEventListener(OPEN_TEMPLATE_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_TEMPLATE_EVENT, onOpen);
  }, [ready, prefs.reducedMotion]);

  // 提示条几秒后自己收起；导出完成的卡片要用户自己关
  useEffect(() => {
    if (notice?.kind !== 'desktop-only') return;
    const id = window.setTimeout(() => setNotice(null), 6000);
    return () => window.clearTimeout(id);
  }, [notice]);

  const height = LOGICAL_H * box.scale;
  const presetName = (preset: string) => {
    const key = PRESET_KEY[preset as keyof typeof PRESET_KEY];
    return key ? t(`export.presets.${key}`) : preset;
  };

  return (
    <div ref={outer} className="mt-12 w-full">
      <div className="site-window relative mx-auto" style={{ height, width: box.width * box.scale }} data-testid="sim-window" aria-label={t('site.sim.frameLabel')}>
        {src ? (
          <div style={{ width: box.width, height: LOGICAL_H, transform: `scale(${box.scale})`, transformOrigin: '0 0' }}>
            <iframe
              ref={frame}
              src={src}
              title={t('site.sim.frameLabel')}
              data-testid="sim-frame"
              className="block size-full border-0"
              style={{ colorScheme: 'normal' }}
            />
          </div>
        ) : (
          <div className="flex size-full flex-col items-center justify-center gap-4 bg-background p-6 text-center">
            <Monitor size={28} className="text-fg-faint" />
            <Button className="site-btn" onClick={() => setStarted(true)} data-testid="sim-start">
              {t('site.sim.start')}
            </Button>
            <p className="text-[13px] text-fg-subtle">{t('site.sim.autoStart')}</p>
          </div>
        )}

        {notice?.kind === 'desktop-only' && (
          <div className="absolute inset-x-0 bottom-10 z-10 flex justify-center px-4" role="status" data-testid="sim-desktop-only">
            <div className="site-float flex max-w-[560px] items-center gap-3 py-2.5 pr-2 pl-4 text-[13px]">
              <span>
                <span className="font-medium">{t(`site.sim.desktopOnly.${notice.feature}`)}</span> <span className="text-fg-muted">{t('site.sim.desktopOnlyHint')}</span>
              </span>
              <a href={REPO_URL} target="_blank" rel="noreferrer noopener" className={buttonVariants({ variant: 'secondary', className: 'h-8 shrink-0 px-3 text-[12.5px]' })}>
                {t('site.sim.getDesktop')}
              </a>
              <Button variant="ghost" size="icon-sm" aria-label={t('site.sim.dismiss')} onClick={() => setNotice(null)}>
                <X size={14} />
              </Button>
            </div>
          </div>
        )}

        {notice?.kind === 'export' && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-scrim p-4" data-testid="sim-export-done">
            <div role="dialog" aria-modal="true" aria-labelledby="sim-export-title" className="float w-full max-w-[460px] p-6 shadow-dialog">
              <h3 id="sim-export-title" className="site-h3">
                {t('site.sim.exportDoneTitle', { frames: notice.frames })}
              </h3>
              <p className="site-body mt-2">{t('site.sim.exportDone', { format: presetName(notice.preset) })}</p>
              <div className="mt-5 flex justify-end gap-2">
                <Button variant="ghost" className="site-btn" onClick={() => setNotice(null)}>
                  {t('site.sim.keepTrying')}
                </Button>
                <a href={REPO_URL} target="_blank" rel="noreferrer noopener" className={buttonVariants({ className: 'site-btn' })}>
                  {t('site.sim.getDesktop')}
                  <ArrowSquareOut size={16} />
                </a>
              </div>
            </div>
          </div>
        )}
      </div>
      <p className="mt-4 text-center text-[12.5px] text-fg-subtle">{t('site.sim.exportNote')}</p>
    </div>
  );
}

export function SimulatorSection() {
  const { t } = useTranslation();
  const wide = useWide();
  return (
    <Section id={SECTION.try}>
      <SectionHead kicker={t('site.sim.kicker')} title={t('site.sim.title')} lead={t('site.sim.lead')} />
      {wide ? (
        <SimulatorWindow />
      ) : (
        <div className="mt-10" data-testid="sim-compact">
          <div className="site-card mb-4 p-4">
            <p className="text-[14px] font-semibold">{t('site.sim.compactTitle')}</p>
            <p className="site-body mt-1">{t('site.sim.compact')}</p>
          </div>
          <LiveViewer scrubbable testId="compact-viewer" />
        </div>
      )}
    </Section>
  );
}
