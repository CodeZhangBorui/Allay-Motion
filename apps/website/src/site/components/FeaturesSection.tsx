// 特性一节。格式清单来自应用的 EXPORT_PRESETS 和应用自己的文案（export.presets.* 等），
// “模板可扩展”里的代码片段取自内置模板 manifest 里真实的一条参数定义。
import { FilmStrip, Stack, PlugsConnected, WifiSlash, PuzzlePiece, X } from '@phosphor-icons/react';
import { useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { EXPORT_PRESETS, PRESET_EXTENSION } from '../../../../desktop/src/shared/export';
import { REMOVED_GLOBALS } from '../../../../../packages/engine/src/harden';
import { builtinEntries } from '../../host/templates';
import { SECTION } from '../links';
import { PixelReveal } from '../motion/PixelReveal';
import { Section, SectionHead } from './Section';

const PRESET_KEY: Record<(typeof EXPORT_PRESETS)[number], string> = {
  prores4444: 'prores',
  'png-sequence': 'png',
  'webm-vp9': 'webm',
  'greenscreen-mp4': 'greenscreen',
};

function Card({ icon, title, body, children, className, testId }: { icon: ReactNode; title: string; body: string; children?: ReactNode; className?: string; testId?: string }) {
  return (
    <PixelReveal bg="--site-bg" variant="wipe" cell={24} duration={760} className={className}>
      <div className="site-card flex h-full flex-col p-6 sm:p-7" data-testid={testId}>
        <div className="flex size-9 items-center justify-center rounded-lg bg-control text-primary-text">{icon}</div>
        <h3 className="site-h3 mt-5">{title}</h3>
        <p className="site-body mt-2">{body}</p>
        {children}
      </div>
    </PixelReveal>
  );
}

/** 一条真实的参数定义（第一个带范围的整数参数），给“manifest 自动生成属性面板”做例子 */
function useParamSnippet(): string {
  return useMemo(() => {
    for (const e of builtinEntries()) {
      const p = (e.manifest.params ?? []).find((x) => x.type === 'integer' && 'min' in x && 'max' in x);
      if (p) {
        const { key, type } = p;
        const rest = p as unknown as { default: number; min: number; max: number; ui?: string };
        return JSON.stringify({ key, type, default: rest.default, min: rest.min, max: rest.max, ...(rest.ui ? { ui: rest.ui } : {}) }, null, 2);
      }
    }
    return '';
  }, []);
}

export function FeaturesSection() {
  const { t } = useTranslation();
  const snippet = useParamSnippet();
  const layers = t('site.features.stack.layers', { returnObjects: true }) as string[];
  return (
    <Section id={SECTION.features}>
      <SectionHead kicker={t('site.features.kicker')} title={t('site.features.title')} />
      <div className="mt-12 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <Card icon={<FilmStrip size={18} weight="fill" />} title={t('site.features.alpha.title')} body={t('site.features.alpha.body')} className="md:col-span-2" testId="feature-alpha">
          <ul className="mt-5 grid gap-2 sm:grid-cols-2" data-testid="format-list">
            {EXPORT_PRESETS.map((p) => (
              <li key={p} className="rounded-lg bg-control/60 px-4 py-3" data-preset={p}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[13.5px] font-medium">{t(`export.presets.${PRESET_KEY[p]}`)}</span>
                  <span className="num text-[11.5px] text-fg-subtle">.{PRESET_EXTENSION[p]}</span>
                </div>
                <p className="mt-1 text-[12.5px] text-fg-muted">{t(`export.presetDesc.${PRESET_KEY[p]}`)}</p>
                <p className="mt-1 text-[12px] text-fg-subtle">{t('export.worksWith', { apps: t(`export.presetFor.${PRESET_KEY[p]}`) })}</p>
              </li>
            ))}
          </ul>
        </Card>
        <Card icon={<PlugsConnected size={18} weight="fill" />} title={t('site.features.frames.title')} body={t('site.features.frames.body')}>
          <div className="mt-auto pt-6" aria-hidden="true">
            {['preview', 'export'].map((row) => (
              <div key={row} className="mb-1.5 flex items-center gap-2">
                <span className="num w-14 text-[11px] text-fg-subtle">{row === 'preview' ? 'preview' : 'export'}</span>
                <div className="flex flex-1 gap-[3px]">
                  {Array.from({ length: 12 }, (_, i) => (
                    <span key={i} className="h-5 flex-1 rounded-[3px]" style={{ background: i < 4 ? 'var(--stage-enter)' : i < 8 ? 'var(--stage-hold)' : 'var(--stage-exit)', opacity: 0.35 + (i % 4) * 0.2 }} />
                  ))}
                </div>
              </div>
            ))}
            <p className="num mt-2 text-[11px] text-fg-subtle">frame(t) = update(t)</p>
          </div>
        </Card>
        <Card icon={<Stack size={18} weight="fill" />} title={t('site.features.stack.title')} body={t('site.features.stack.body')}>
          <div className="mt-auto flex flex-col gap-1.5 pt-6" aria-hidden="true">
            {layers.map((l, i) => (
              <div key={l} className="flex h-8 items-center rounded-md px-3 text-[12px]" style={{ background: i === 0 ? 'var(--primary-soft)' : i === 1 ? 'var(--control-hi)' : 'var(--control)' }}>
                <span className="num mr-3 text-fg-subtle">{layers.length - i}</span>
                {l}
              </div>
            ))}
          </div>
        </Card>
        <Card icon={<WifiSlash size={18} weight="fill" />} title={t('site.features.offline.title')} body={t('site.features.offline.body')}>
          {/* 引擎 Worker 在装载模板前删掉的全局：直接取引擎的 REMOVED_GLOBALS（docs/02-engine.md 2.4） */}
          <div className="mt-auto pt-6">
            <p className="text-[12px] text-fg-subtle">{t('site.features.offline.sandbox')}</p>
            <ul className="mt-2 grid grid-cols-2 gap-1.5">
              {REMOVED_GLOBALS.map((g) => (
                <li key={g} className="num flex items-center justify-between rounded-md bg-well px-2.5 py-1.5 text-[11.5px] text-fg-muted">
                  {g}
                  <X size={11} className="text-fg-faint" aria-hidden="true" />
                </li>
              ))}
            </ul>
          </div>
        </Card>
        <Card icon={<PuzzlePiece size={18} weight="fill" />} title={t('site.features.extend.title')} body={t('site.features.extend.body')}>
          {snippet && (
            <pre className="num mt-auto overflow-x-auto rounded-lg bg-well p-4 text-[11.5px] leading-[1.55] text-fg-muted" aria-label="manifest.json">
              {snippet}
            </pre>
          )}
        </Card>
      </div>
    </Section>
  );
}
