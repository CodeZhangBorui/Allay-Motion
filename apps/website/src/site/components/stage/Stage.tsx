// 首屏 + 分镜：一整段共享一个 sticky 的舞台（3D 方块场景 + 实时预览面板），文字在上面正常滚动。
// - 首屏：超大标题在左上，预览面板斜着躺在右下（3D 透视、跟鼠标微微转动），方块在四周悬浮；
// - 往下滚，面板立起来、移到右栏，进入分镜：①选模板（滚动换模板）②调参数（滚动拖“列数”，引擎 setParams 实时重画）
//   ③导出（滚动推进渲染到第几帧，预览的播放头跟着走；悦灵用应用的导出进度编排，封装、完成时跳舞）。
// 全部由滚动位置决定、可逆，不劫持滚动；减少动效时换成静态的排版（面板在文字下面，三步并列）。
import { localize, type ParamValues } from '@allay/template-sdk';
import { ArrowDown, GithubLogo } from '@phosphor-icons/react';
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { defaultDuration, showcaseEntries } from '../../../host/templates';
import { REPO_URL, SECTION } from '../../links';
import { clamp01, easeInOutCubic, lerp, onFrame, range, spring, track } from '../../motion/frame';
import { HeroCanvas } from '../../motion/HeroCanvas';
import { MagneticLink } from '../../motion/interactions';
import { usePrefs } from '../../prefs';
import { LiveViewer, type LiveViewerControl } from '../LiveViewer';
import { ExportPanel, TunePanel, type TuneValues } from './panels';
import type { AllayProgressPhase } from '@allay/mascot';

const TUNED = 'allay.builtin.block-wipe';
const STEPS = ['pick', 'tune', 'export'] as const;
type Step = (typeof STEPS)[number];
/** 第一步里滚过的模板个数（展示顺序的前几个；模板再多也只滚这几个，其余在模板一节和仿真器里） */
const PICK_COUNT = 4;

interface Story {
  /** -1 是首屏 */
  step: number;
  pick: number;
  tune: TuneValues;
  frame: number;
  phase: AllayProgressPhase;
}

const PATTERNS = ['centerOut', 'diagonal', 'bottomToTop'];

function storyAt(step: number, sub: number, total: number): Story {
  const base: Story = { step, pick: 0, tune: { cols: 12, inPattern: 'centerOut', spin: 'flipY' }, frame: 0, phase: 'rendering' };
  if (step === 0) base.pick = Math.min(PICK_COUNT - 1, Math.floor(sub * PICK_COUNT));
  if (step >= 1) {
    const k = step === 1 ? sub : 1;
    base.tune = { cols: Math.round(lerp(6, 24, clamp01(k / 0.9))), inPattern: PATTERNS[Math.min(2, Math.floor(clamp01(k) * 3))]!, spin: k < 0.7 ? 'flipY' : 'twist' };
  }
  if (step === 2) {
    const r = clamp01(sub / 0.7);
    base.frame = Math.round(r * total);
    base.phase = sub < 0.7 ? 'rendering' : sub < 0.8 ? 'muxing' : 'done';
  }
  return base;
}

function sameStory(a: Story, b: Story): boolean {
  return a.step === b.step && a.pick === b.pick && a.frame === b.frame && a.phase === b.phase && a.tune.cols === b.tune.cols && a.tune.inPattern === b.tune.inPattern && a.tune.spin === b.tune.spin;
}

function useWide(): boolean {
  const query = '(min-width: 1024px)';
  const [wide, setWide] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setWide(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return wide;
}

/** 首屏的文字 */
function HeroCopy({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation();
  const name = t('brand.name');
  return (
    <div className="intro relative">
      <p className="t-mono intro-fade flex items-center gap-2.5 text-fg-muted" style={{ '--i': 0 } as CSSProperties}>
        <span className="inline-block h-px w-8 bg-primary" aria-hidden="true" />
        {t('site.hero.eyebrow')}
      </p>
      <h1 className="t-display mt-6 sm:mt-8">
        <span className="line-mask">
          <span style={{ '--i': 0 } as CSSProperties}>{t('site.hero.titleA')}</span>
        </span>
        <span className="line-mask">
          <span style={{ '--i': 1 } as CSSProperties}>
            {t('site.hero.titleB')}
            <span className="t-glow">{t('site.hero.titleC')}</span>
          </span>
        </span>
      </h1>
      <p className={`t-lead intro-fade mt-7 max-w-[34em] ${compact ? '' : 'lg:max-w-[30em]'}`} style={{ '--i': 1 } as CSSProperties}>
        {t('site.hero.lead', { name })}
      </p>
      <div className="intro-fade mt-9 flex flex-wrap items-center gap-3" style={{ '--i': 2 } as CSSProperties}>
        <MagneticLink href={REPO_URL} external className="btn btn-primary link-focus" testId="cta-github">
          <GithubLogo size={19} weight="fill" />
          {t('site.hero.primary')}
        </MagneticLink>
        <MagneticLink href={`#${SECTION.try}`} className="btn btn-ghost link-focus" testId="cta-try">
          {t('site.hero.secondary')}
          <ArrowDown size={16} />
        </MagneticLink>
      </div>
      <ul className="intro-fade mt-8 flex flex-wrap gap-x-5 gap-y-2" style={{ '--i': 3 } as CSSProperties} aria-label={t('site.hero.factsLabel')}>
        {(t('site.hero.facts', { returnObjects: true }) as string[]).map((f) => (
          <li key={f} className="t-mono flex items-center gap-2 text-[11px] text-fg-subtle">
            <span className="size-1 rounded-full bg-fg-faint" aria-hidden="true" />
            {f}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** 一步的文字：描边大编号、等宽标注、标题、正文，以及这一步自己的小读数 */
function StepCopy({ step, index, story, anchor = false, panel }: { step: Step; index: number; story: Story; anchor?: boolean; panel?: ReactNode }) {
  const { t } = useTranslation();
  const { language } = usePrefs();
  const entries = useMemo(() => showcaseEntries().slice(0, PICK_COUNT), []);
  const active = story.step === index;
  return (
    <div className="relative" data-step={step} data-active={active}>
      <div className="flex items-end gap-5">
        <span className="t-tab t-outline text-[clamp(72px,8.4vw,136px)] leading-[.8] font-medium tracking-[-0.06em] select-none" aria-hidden="true">
          {String(index + 1).padStart(2, '0')}
        </span>
        {anchor && <span data-allay-anchor={`step-${index}`} className="mb-6 inline-block size-1" aria-hidden="true" />}
      </div>
      <p className="t-mono mt-5 text-primary-text">{t(`site.story.steps.${step}.kicker`)}</p>
      <h3 className="t-h2 mt-3 !text-[clamp(32px,3.6vw,58px)]">{t(`site.story.steps.${step}.title`)}</h3>
      <p className="t-lead mt-4 max-w-[26em] !text-[clamp(16px,1.15vw,18px)]">{t(`site.story.steps.${step}.body`)}</p>
      {panel && <div className="relative z-10 mt-7 lg:w-[calc(100%+48px)]">{panel}</div>}
      {step === 'pick' && (
        <ol className="mt-7 space-y-1.5">
          {entries.map((e, i) => (
            <li key={e.id} className={`flex items-center gap-3 text-[15px] transition-colors duration-300 ${active && story.pick === i ? 'text-foreground' : 'text-fg-subtle'}`}>
              <span className={`h-px transition-all duration-500 ease-(--ease-expo) ${active && story.pick === i ? 'w-8 bg-primary' : 'w-3 bg-fg-faint'}`} aria-hidden="true" />
              {localize(e.manifest.name, language)}
            </li>
          ))}
          <li className="t-mono pt-2 text-[10.5px] text-fg-faint">{t('site.story.steps.pick.more')}</li>
        </ol>
      )}
    </div>
  );
}

export function Stage() {
  const { reducedMotion } = usePrefs();
  return reducedMotion ? <StaticStage /> : <ScrollStage />;
}

/** 正常（有动效）的版本 */
function ScrollStage() {
  const { t } = useTranslation();
  const wide = useWide();
  const rootRef = useRef<HTMLDivElement>(null);
  const heroRef = useRef<HTMLElement>(null);
  const stepRefs = useRef<(HTMLDivElement | null)[]>([]);
  const monitorRef = useRef<HTMLDivElement>(null);
  const sceneWrapRef = useRef<HTMLDivElement>(null);
  const progress = useRef(0);
  const visible = useRef(true);
  const entries = useMemo(() => showcaseEntries(), []);
  const tuned = entries.find((e) => e.id === TUNED) ?? entries[0]!;
  const total = Math.round((defaultDuration(tuned.manifest) ?? 1.1) * 60);
  const [story, setStory] = useState<Story>(() => storyAt(-1, 0, total));
  const storyRef = useRef(story);

  // 滚动 → 分镜状态（只在离散的值变了时才 setState）、主视觉的位姿（每帧写 transform）
  useEffect(() => {
    const root = rootRef.current;
    const hero = heroRef.current;
    const monitor = monitorRef.current;
    if (!root || !hero || !monitor) return;
    const rootT = track(root);
    const heroT = track(hero);
    const stepT = stepRefs.current.map((el) => (el ? track(el) : null));
    let rx = 0;
    let ry = 0;
    let vrx = 0;
    let vry = 0;
    const off = onFrame((s) => {
      const g = rootT.geometry;
      visible.current = s.y < g.top + g.height && s.y + s.vh > g.top;
      if (!visible.current) return;
      const heroH = heroT.geometry.height;
      const k = easeInOutCubic(range(s.y, heroT.geometry.top, heroT.geometry.top + heroH * 0.8));
      progress.current = k;
      // 当前一步：视口中线落在哪一步的块里
      const mid = s.y + s.vh * 0.5;
      let step = -1;
      let sub = 0;
      stepT.forEach((st, i) => {
        if (!st) return;
        const a = st.geometry.top;
        const b = a + st.geometry.height;
        if (mid >= a) {
          step = i;
          sub = clamp01((mid - a) / (b - a));
        }
      });
      if (k < 0.5) step = -1;
      const next = storyAt(step, sub, total);
      if (!sameStory(next, storyRef.current)) {
        storyRef.current = next;
        setStory(next);
      }
      // 面板的位姿：首屏斜躺在右下 → 分镜里立起来；指针让它微微转动
      const pointer = s.pointer;
      const tx = pointer ? ((pointer.y / s.vh) * 2 - 1) * (wide ? 3 - k * 1.8 : 0) : 0;
      const ty = pointer ? ((pointer.x / s.vw) * 2 - 1) * (wide ? 4 - k * 2.6 : 0) : 0;
      [rx, vrx] = spring(rx, vrx, -tx, 9, s.dt);
      [ry, vry] = spring(ry, vry, ty, 9, s.dt);
      const inv = 1 - k;
      if (wide) {
        monitor.style.transform = `translate3d(${(inv * s.vw * 0.04).toFixed(1)}px, ${(inv * s.vh * 0.36).toFixed(1)}px, 0) rotateX(${(inv * 22 + rx).toFixed(2)}deg) rotateY(${(inv * -18 + ry).toFixed(2)}deg) rotateZ(${(inv * 3).toFixed(2)}deg) scale(${(0.86 + k * 0.14).toFixed(4)})`;
      } else {
        monitor.style.transform = `translate3d(0, ${(inv * s.vh * 0.62).toFixed(1)}px, 0) scale(${(0.94 + k * 0.06).toFixed(4)})`;
      }
      const sw = sceneWrapRef.current;
      if (sw) sw.style.opacity = (1 - k * 0.55).toFixed(3);
    });
    return () => {
      off();
      rootT.untrack();
      heroT.untrack();
      stepT.forEach((st) => st?.untrack());
    };
  }, [wide, total]);

  const pickIds = useMemo(() => entries.slice(0, PICK_COUNT).map((e) => e.id), [entries]);
  const control: LiveViewerControl = useMemo(() => {
    if (story.step === 0) return { templateId: pickIds[story.pick] ?? null };
    if (story.step >= 1) {
      const params: ParamValues = { cols: story.tune.cols, inPattern: story.tune.inPattern, spin: story.tune.spin };
      return { templateId: TUNED, params, scrub: story.step === 2 ? (total > 0 ? story.frame / total : 0) : null };
    }
    return {};
  }, [story, pickIds, total]);

  const cutFrame = Math.round(((defaultDuration(tuned.manifest) ?? 1.1) - 0.5) * 60);

  return (
    <div ref={rootRef} className="relative">
      {/* sticky 的舞台：3D 场景 + 预览面板 */}
      <div className="sticky top-0 z-0 h-[100svh] overflow-hidden" style={{ perspective: '1600px' }}>
        <div className="pointer-events-none absolute inset-0 bg-dots fade-mask opacity-70" aria-hidden="true" />
        <div className="halo -top-[20%] left-[30%] h-[90vh] w-[90vh]" aria-hidden="true" />
        <div ref={sceneWrapRef} className="absolute inset-0">
          <HeroCanvas progress={progress} visible={visible} className="absolute inset-0 size-full" />
        </div>
        <div
          className={`absolute ${wide ? 'top-1/2 right-[var(--gutter)] w-[min(56vw,960px)] -translate-y-1/2' : 'inset-x-[var(--gutter)] top-[calc(var(--nav-h)+12px)]'}`}
          style={{ transformStyle: 'preserve-3d' }}
        >
          <div ref={monitorRef} className="relative will-change-transform" style={{ transformStyle: 'preserve-3d', transformOrigin: '60% 50%' }}>
            <span data-allay-anchor="hero" className="absolute top-[-9%] left-[-4%] size-1" aria-hidden="true" />
            <LiveViewer autoCycle testId="hero-viewer" control={control} />
          </div>
        </div>
      </div>

      {/* 正常滚动的文字（盖在舞台上；只有文字和按钮接收指针，面板照常可点） */}
      <div className="pointer-events-none relative z-10 -mt-[100svh]">
        <section ref={heroRef} id={SECTION.top} data-clip="intro" data-clip-color="var(--allay)" className="flex min-h-[100svh] flex-col">
          <div className={`wrap pointer-events-auto flex-1 pt-[calc(var(--nav-h)+7vh)] ${wide ? 'pb-[14vh]' : 'pb-[46vh]'}`}>
            <div className={wide ? 'max-w-[60vw]' : ''}>
              <HeroCopy />
            </div>
          </div>
          <div className="wrap pointer-events-none hidden pb-8 lg:block">
            <p className="t-mono flex items-center gap-3 text-[10.5px] text-fg-subtle">
              <span className="relative h-8 w-px overflow-hidden bg-[var(--site-line-hi)]" aria-hidden="true">
                <span className="absolute inset-x-0 top-0 h-3 animate-[scroll-cue_1.8s_var(--ease-in-out)_infinite] bg-primary" />
              </span>
              {t('site.hero.scrollCue')}
            </p>
          </div>
        </section>

        <section id={SECTION.workflow} data-clip="workflow" data-clip-color="var(--stage-enter)" aria-labelledby="story-title" className="relative">
          <div className="wrap pointer-events-auto pt-[12vh]">
            <p className="t-mono text-fg-subtle">{t('site.story.kicker')}</p>
            <h2 id="story-title" className="t-h2 mt-4 max-w-[12em]">
              {t('site.story.title')}
            </h2>
            <p className="t-lead mt-5 max-w-[30em]">{t('site.story.lead')}</p>
          </div>
          {STEPS.map((s, i) => (
            <div
              key={s}
              ref={(el) => {
                stepRefs.current[i] = el;
              }}
              className={wide ? 'h-[125vh]' : 'min-h-[110vh]'}
            >
              <div className={`wrap pointer-events-auto sticky ${wide ? 'top-[calc(var(--nav-h)+5vh)]' : 'top-[calc(var(--nav-h)+56.25vw+150px)]'}`}>
                <div className={wide ? 'max-w-[min(34vw,520px)]' : ''}>
                  <StepCopy
                    step={s}
                    index={i}
                    story={story}
                    anchor={wide}
                    panel={
                      s === 'tune' ? (
                        <TunePanel manifest={tuned.manifest} values={story.tune} className="max-w-full" />
                      ) : s === 'export' ? (
                        <ExportPanel frame={story.step === 2 ? story.frame : 0} total={total} phase={story.step === 2 ? story.phase : 'rendering'} live={story.step === 2} cutFrame={cutFrame} className="max-w-full" />
                      ) : undefined
                    }
                  />
                </div>
              </div>
            </div>
          ))}
          <div className="h-[20vh]" aria-hidden="true" />
        </section>
      </div>
    </div>
  );
}

/** 减少动效：没有 sticky 的编排，所有内容按顺序排好、一开始就是终态 */
function StaticStage() {
  const { t } = useTranslation();
  const entries = useMemo(() => showcaseEntries(), []);
  const tuned = entries.find((e) => e.id === TUNED) ?? entries[0]!;
  const total = Math.round((defaultDuration(tuned.manifest) ?? 1.1) * 60);
  const cutFrame = Math.round(((defaultDuration(tuned.manifest) ?? 1.1) - 0.5) * 60);
  const story = storyAt(2, 1, total);
  const progress = useRef(0) as RefObject<number>;
  const visible = useRef(true) as RefObject<boolean>;
  return (
    <>
      <section id={SECTION.top} data-clip="intro" data-clip-color="var(--allay)" className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0" aria-hidden="true">
          <div className="absolute inset-0 bg-dots fade-mask opacity-70" />
          <HeroCanvas progress={progress} visible={visible} className="absolute inset-0 size-full" />
        </div>
        <div className="wrap relative pt-[calc(var(--nav-h)+8vh)] pb-16">
          <HeroCopy compact />
          <div className="relative mt-14 max-w-[960px]">
            <span data-allay-anchor="hero" className="absolute top-[-8%] left-[-3%] size-1" aria-hidden="true" />
            <LiveViewer autoCycle testId="hero-viewer" />
          </div>
        </div>
      </section>
      <section id={SECTION.workflow} data-clip="workflow" data-clip-color="var(--stage-enter)" aria-labelledby="story-title" className="relative">
        <div className="wrap py-24">
          <p className="t-mono text-fg-subtle">{t('site.story.kicker')}</p>
          <h2 id="story-title" className="t-h2 mt-4 max-w-[12em]">
            {t('site.story.title')}
          </h2>
          <p className="t-lead mt-5 max-w-[30em]">{t('site.story.lead')}</p>
          <div className="mt-16 grid gap-16 lg:grid-cols-3 lg:gap-10">
            {STEPS.map((s, i) => (
              <div key={s}>
                <StepCopy
                  step={s}
                  index={i}
                  story={{ ...story, step: i }}
                  panel={
                    s === 'tune' ? (
                      <TunePanel manifest={tuned.manifest} values={story.tune} className="max-w-full" />
                    ) : s === 'export' ? (
                      <ExportPanel frame={total} total={total} phase="done" live cutFrame={cutFrame} className="max-w-full" />
                    ) : undefined
                  }
                />
              </div>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
