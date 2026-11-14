import { CursorClick, Export, SlidersHorizontal } from '@phosphor-icons/react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { SECTION } from '../links';
import { useEffect, useRef } from 'react';
import { PixelReveal } from '../motion/PixelReveal';
import { usePrefs } from '../prefs';
import { Section, SectionHead } from './Section';

const STEPS: { key: 'pick' | 'tune' | 'export'; icon: ReactNode }[] = [
  { key: 'pick', icon: <CursorClick size={18} weight="fill" /> },
  { key: 'tune', icon: <SlidersHorizontal size={18} weight="fill" /> },
  { key: 'export', icon: <Export size={18} weight="fill" /> },
];

/**
 * 三步的阶段条随滚动推进：滚过这一节时，进入、停留、退出三段依次填满，走到的那一步点亮。
 * 纯由滚动位置决定（可逆），每帧只写 CSS 变量和 data 属性，不触发 React 重渲染；减少动效时直接是填满的终态。
 */
function useStepProgress(list: React.RefObject<HTMLOListElement | null>) {
  const { reducedMotion } = usePrefs();
  useEffect(() => {
    const ol = list.current;
    if (!ol) return;
    const items = [...ol.querySelectorAll<HTMLElement>('.site-step')];
    const set = (p: number) =>
      items.forEach((el, k) => {
        const fill = Math.min(1, Math.max(0, p * items.length - k));
        el.style.setProperty('--fill', fill.toFixed(3));
        el.dataset.active = String(fill > 0);
      });
    if (reducedMotion) {
      set(1);
      return;
    }
    let raf = 0;
    const update = () => {
      raf = 0;
      const r = ol.getBoundingClientRect();
      const vh = window.innerHeight;
      // 列表上沿到视口 85% 处开始，走到视口 30% 处填满
      set(Math.min(1, Math.max(0, (vh * 0.85 - r.top) / (vh * 0.55))));
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [list, reducedMotion]);
}

export function WorkflowSection() {
  const { t } = useTranslation();
  const list = useRef<HTMLOListElement>(null);
  useStepProgress(list);
  return (
    <Section id={SECTION.workflow} tone="alt" label={`04  ${t('site.workflow.kicker')}`}>
      <SectionHead tone="alt" kicker={t('site.workflow.kicker')} title={t('site.workflow.title')} lead={t('site.workflow.lead')} />
      <ol ref={list} className="relative mt-14 grid gap-4 md:grid-cols-3">
        {STEPS.map((s, i) => (
          <li key={s.key}>
            <PixelReveal bg="--site-alt" cell={12} delay={i * 140} duration={760} className="h-full">
              <div className="site-card site-step site-lift h-full p-6 sm:p-7">
                <div className="flex items-center justify-between">
                  <span className="site-step-num num text-[13px] font-medium text-primary-text">{String(i + 1).padStart(2, '0')}</span>
                  <span className="site-step-icon flex size-9 items-center justify-center rounded-lg bg-control text-fg-muted">{s.icon}</span>
                </div>
                <h3 className="site-h3 mt-8">{t(`site.workflow.steps.${s.key}.title`)}</h3>
                <p className="site-body mt-2">{t(`site.workflow.steps.${s.key}.body`)}</p>
                {/* 阶段色的小条：三步依次是进入、停留、退出 */}
                <div className="site-steps-bar mt-6 h-1.5 overflow-hidden rounded-full bg-well" aria-hidden="true">
                  <span className="block h-full rounded-full" style={{ background: ['var(--stage-enter)', 'var(--stage-hold)', 'var(--stage-exit)'][i] }} />
                </div>
              </div>
            </PixelReveal>
          </li>
        ))}
      </ol>
    </Section>
  );
}
