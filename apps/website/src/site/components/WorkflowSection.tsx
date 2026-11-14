import { CursorClick, Export, SlidersHorizontal } from '@phosphor-icons/react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { SECTION } from '../links';
import { PixelReveal } from '../motion/PixelReveal';
import { Section, SectionHead } from './Section';

const STEPS: { key: 'pick' | 'tune' | 'export'; icon: ReactNode }[] = [
  { key: 'pick', icon: <CursorClick size={18} weight="fill" /> },
  { key: 'tune', icon: <SlidersHorizontal size={18} weight="fill" /> },
  { key: 'export', icon: <Export size={18} weight="fill" /> },
];

export function WorkflowSection() {
  const { t } = useTranslation();
  return (
    <Section id={SECTION.workflow} tone="alt">
      <SectionHead tone="alt" kicker={t('site.workflow.kicker')} title={t('site.workflow.title')} lead={t('site.workflow.lead')} />
      <ol className="relative mt-14 grid gap-4 md:grid-cols-3">
        {STEPS.map((s, i) => (
          <li key={s.key}>
            <PixelReveal bg="--site-alt" cell={12} delay={i * 140} duration={760} className="h-full">
              <div className="site-card h-full p-6 sm:p-7">
                <div className="flex items-center justify-between">
                  <span className="num text-[13px] font-medium text-primary-text">{String(i + 1).padStart(2, '0')}</span>
                  <span className="flex size-9 items-center justify-center rounded-lg bg-control text-fg-muted">{s.icon}</span>
                </div>
                <h3 className="site-h3 mt-8">{t(`site.workflow.steps.${s.key}.title`)}</h3>
                <p className="site-body mt-2">{t(`site.workflow.steps.${s.key}.body`)}</p>
                {/* 阶段色的小条：三步依次是进入、停留、退出 */}
                <div className="mt-6 h-1.5 rounded-full" style={{ background: ['var(--stage-enter)', 'var(--stage-hold)', 'var(--stage-exit)'][i] }} aria-hidden="true" />
              </div>
            </PixelReveal>
          </li>
        ))}
      </ol>
    </Section>
  );
}
