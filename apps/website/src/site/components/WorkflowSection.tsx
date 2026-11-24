// 工作流一节：左侧三步交互标签页完全由用户点击切换（不和用户抢状态），右侧懒加载真实引擎预览。
import { localize } from '@allay/template-sdk';
import { Badge } from '@allay/ui/components/misc';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@allay/ui/components/tabs';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { showcaseEntries } from '../../host/templates';
import { SECTION } from '../links';
import { usePrefs } from '../prefs';
import { LiveViewer, type LiveViewerControl } from './LiveViewer';
import { DEFAULT_TUNE, ExportPreviewPanel, TuneControls, type TuneValues } from './stage/panels';

const STEPS = ['pick', 'tune', 'export'] as const;
type Step = (typeof STEPS)[number];

const BLOCK_WIPE_ID = 'allay.builtin.block-wipe';

export function WorkflowSection() {
  const { t } = useTranslation();
  const { language } = usePrefs();
  const entries = useMemo(() => showcaseEntries(), []);
  const blockWipe = useMemo(() => entries.find((e) => e.id === BLOCK_WIPE_ID) ?? entries[0]!, [entries]);
  const [step, setStep] = useState<Step>('pick');
  const [pickedId, setPickedId] = useState<string>(entries[0]?.id ?? BLOCK_WIPE_ID);
  const [tune, setTune] = useState<TuneValues>(DEFAULT_TUNE);
  const [mountViewer, setMountViewer] = useState(false);
  const sectionRef = useRef<HTMLElement>(null);

  // 接近工作流这一节时才启动第二个引擎预览，节省首屏资源
  useEffect(() => {
    const el = sectionRef.current;
    if (!el || mountViewer) return;
    const io = new IntersectionObserver(
      (es) => {
        if (es.some((e) => e.isIntersecting)) {
          setMountViewer(true);
          io.disconnect();
        }
      },
      { rootMargin: '280px 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [mountViewer]);

  const control: LiveViewerControl = useMemo(() => {
    if (step === 'tune') {
      return {
        templateId: BLOCK_WIPE_ID,
        params: { cols: tune.cols, inPattern: tune.inPattern, spin: tune.spin },
      };
    }
    return { templateId: pickedId };
  }, [step, pickedId, tune]);

  return (
    <section ref={sectionRef} id={SECTION.workflow} aria-labelledby="workflow-title" className="relative border-t border-[var(--site-line)] py-20 lg:py-28">
      <div className="wrap">
        <div className="max-w-[44em]">
          <p className="t-mono text-fg-subtle">{t('site.workflow.kicker')}</p>
          <h2 id="workflow-title" className="t-h2 mt-3">
            {t('site.workflow.title')}
          </h2>
          <p className="t-lead mt-4">{t('site.workflow.lead')}</p>
        </div>

        <div className="mt-10 grid items-start gap-8 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)] lg:gap-12">
          <Tabs value={step} onValueChange={(v) => setStep(v as Step)} className="min-w-0">
            <TabsList aria-label={t('site.workflow.stepsLabel')} className="gap-1.5">
              {STEPS.map((s, i) => (
                <TabsTrigger key={s} value={s} data-testid={`workflow-tab-${s}`}>
                  <span className="t-mono text-[10px] opacity-70">{String(i + 1).padStart(2, '0')}</span>
                  {t(`site.workflow.steps.${s}.tab`)}
                </TabsTrigger>
              ))}
            </TabsList>

            <TabsContent value="pick" className="mt-6 space-y-4">
              <p className="t-mono text-primary-text">{t('site.workflow.steps.pick.kicker')}</p>
              <h3 className="t-h3">{t('site.workflow.steps.pick.title')}</h3>
              <p className="t-body">{t('site.workflow.steps.pick.body')}</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {entries.map((e) => {
                  const active = e.id === pickedId;
                  return (
                    <button
                      key={e.id}
                      type="button"
                      aria-pressed={active}
                      data-testid="workflow-pick"
                      data-template={e.id}
                      onClick={() => setPickedId(e.id)}
                      className={`link-focus flex items-center justify-between gap-2 rounded-lg border px-3.5 py-2.5 text-left transition-colors duration-150 ${
                        active ? 'border-primary bg-control-hi text-foreground' : 'border-[var(--site-line)] bg-[var(--site-card)] text-fg-muted hover:border-[var(--site-line-hi)] hover:text-foreground'
                      }`}
                    >
                      <span className="truncate text-[13.5px] font-medium">{localize(e.manifest.name, language)}</span>
                      <Badge>{t(`site.categories.${e.manifest.category}`)}</Badge>
                    </button>
                  );
                })}
              </div>
            </TabsContent>

            <TabsContent value="tune" className="mt-6 space-y-4">
              <p className="t-mono text-primary-text">{t('site.workflow.steps.tune.kicker')}</p>
              <h3 className="t-h3">{t('site.workflow.steps.tune.title')}</h3>
              <p className="t-body">{t('site.workflow.steps.tune.body')}</p>
              <TuneControls manifest={blockWipe.manifest} values={tune} onChange={setTune} onReset={() => setTune(DEFAULT_TUNE)} />
            </TabsContent>

            <TabsContent value="export" className="mt-6 space-y-4">
              <p className="t-mono text-primary-text">{t('site.workflow.steps.export.kicker')}</p>
              <h3 className="t-h3">{t('site.workflow.steps.export.title')}</h3>
              <p className="t-body">{t('site.workflow.steps.export.body')}</p>
              <ExportPreviewPanel active={step === 'export'} />
            </TabsContent>
          </Tabs>

          <div className="min-w-0">
            {mountViewer ? (
              <LiveViewer hidePicker noteHidden autoCycle={false} scrubbable control={control} initialId={pickedId} testId="workflow-viewer" />
            ) : (
              <div className="monitor aspect-video w-full" aria-hidden="true" />
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
