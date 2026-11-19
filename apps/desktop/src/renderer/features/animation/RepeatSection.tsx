// 检查器里的“复制器”一组（docs/animation-editor.md 10.10）：开关、方式（网格 / 一条线 / 一圈）、份数和间距、错开与名次、种子、
// 随机抖动；方块图层还有方块列表和方块排列（同方块擦除模板的“方块排列”）。改动都经 animSetRepeat 命令。
import { Switch } from '@allay/ui/components/switch';
import { BlockListField, BooleanField, EnumField, ParamGroup, ScrubNumberField, SeedField } from '@allay/ui/editor';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ARRANGEMENT_NAMES, REPEAT_MODES, REPEAT_ORDERS, type Layer, type Repeat } from '../../../shared/animation/schema';
import { trigger } from '../../app/registry';

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid min-h-row grid-cols-[minmax(72px,30%)_1fr] items-center gap-2.5">
      <span className="min-w-0 truncate text-fg-muted">{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

const DEFAULT: Repeat = { mode: 'grid', count: 8, cols: 4, rows: 3, spacing: { x: 200, y: 200 }, radius: 300, arc: 360, orient: true, stagger: 0.05, order: 'index', seed: 1 };

export function RepeatSection({ layer }: { layer: Layer }) {
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState(false);
  if (layer.type === 'group') return null;
  const r = layer.repeat;
  const set = (patch: Partial<Repeat> | null) => trigger('animSetRepeat', { layer: layer.id, repeat: patch === null ? null : { ...(r ?? DEFAULT), ...patch } });
  const copies = r ? (r.mode === 'grid' ? r.cols * r.rows : r.count) : 1;
  return (
    <ParamGroup id="anim-repeat" title={t('anim.repeat.title')} collapsed={collapsed} onToggle={setCollapsed} extra={r ? t('anim.repeat.copies', { count: copies }) : undefined}>
      <Row label={t('anim.repeat.on')}>
        <Switch checked={!!r} onCheckedChange={(on) => set(on ? {} : null)} aria-label={t('anim.repeat.on')} data-testid="anim-repeat-on" />
      </Row>
      {r && (
        <>
          <Row label={t('anim.repeat.mode')}>
            <EnumField value={r.mode} label={t('anim.repeat.mode')} testId="anim-repeat-mode" options={REPEAT_MODES.map((m) => ({ value: m, label: t(`anim.repeat.modes.${m}`) }))} onChange={(v) => set({ mode: v as Repeat['mode'] })} />
          </Row>
          {r.mode === 'grid' ? (
            <Row label={t('anim.repeat.grid')}>
              <div className="grid grid-cols-2 gap-[5px]">
                <ScrubNumberField value={r.cols} min={1} max={64} step={1} lead={t('anim.repeat.cols')} label={t('anim.repeat.cols')} testId="anim-repeat-cols" onChange={(v) => set({ cols: Math.round(v), rows: Math.min(r.rows, Math.floor(256 / Math.max(1, Math.round(v)))) })} />
                <ScrubNumberField value={r.rows} min={1} max={64} step={1} lead={t('anim.repeat.rows')} label={t('anim.repeat.rows')} testId="anim-repeat-rows" onChange={(v) => set({ rows: Math.round(v), cols: Math.min(r.cols, Math.floor(256 / Math.max(1, Math.round(v)))) })} />
              </div>
            </Row>
          ) : (
            <Row label={t('anim.repeat.count')}>
              <ScrubNumberField value={r.count} min={1} max={256} step={1} label={t('anim.repeat.count')} testId="anim-repeat-count" onChange={(v) => set({ count: Math.round(v) })} />
            </Row>
          )}
          {r.mode === 'radial' ? (
            <>
              <Row label={t('anim.repeat.radius')}>
                <ScrubNumberField value={r.radius} min={0} max={4000} step={1} label={t('anim.repeat.radius')} onChange={(v) => set({ radius: v })} />
              </Row>
              <Row label={t('anim.repeat.arc')}>
                <ScrubNumberField value={r.arc} min={1} max={360} step={1} unit="°" label={t('anim.repeat.arc')} onChange={(v) => set({ arc: v })} />
              </Row>
              <Row label={t('anim.repeat.orient')}>
                <BooleanField value={r.orient} onChange={(v) => set({ orient: v })} label={t('anim.repeat.orient')} />
              </Row>
            </>
          ) : (
            <Row label={t(r.mode === 'grid' ? 'anim.repeat.spacing' : 'anim.repeat.step')}>
              <div className="grid grid-cols-2 gap-[5px]">
                <ScrubNumberField value={r.spacing.x} min={-4000} max={4000} step={1} lead="X" label={`${t('anim.repeat.spacing')} X`} testId="anim-repeat-spacing-x" onChange={(v) => set({ spacing: { ...r.spacing, x: v } })} />
                <ScrubNumberField value={r.spacing.y} min={-4000} max={4000} step={1} lead="Y" label={`${t('anim.repeat.spacing')} Y`} onChange={(v) => set({ spacing: { ...r.spacing, y: v } })} />
              </div>
            </Row>
          )}
          <Row label={t('anim.repeat.stagger')}>
            <ScrubNumberField value={r.stagger} min={0} max={5} step={0.01} minDecimals={2} unit="s" label={t('anim.repeat.stagger')} testId="anim-repeat-stagger" onChange={(v) => set({ stagger: v })} />
          </Row>
          <Row label={t('anim.repeat.order')}>
            <EnumField value={r.order} label={t('anim.repeat.order')} testId="anim-repeat-order" options={REPEAT_ORDERS.map((o) => ({ value: o, label: t(`anim.repeat.orders.${o}`) }))} onChange={(v) => set({ order: v as Repeat['order'] })} />
          </Row>
          <Row label={t('anim.repeat.seed')}>
            <SeedField value={r.seed} onChange={(v) => set({ seed: v })} label={t('anim.repeat.seed')} testId="anim-repeat-seed" />
          </Row>
          <Row label={t('anim.repeat.jitter')}>
            <Switch checked={!!r.jitter} onCheckedChange={(on) => set(on ? { jitter: { x: 20, y: 20, rot: 10, scale: 0.1 } } : { jitter: undefined } as Partial<Repeat>)} aria-label={t('anim.repeat.jitter')} data-testid="anim-repeat-jitter" />
          </Row>
          {r.jitter && (
            <Row label={t('anim.repeat.jitterAmount')}>
              <div className="grid grid-cols-2 gap-[5px]">
                <ScrubNumberField value={r.jitter.x} min={0} max={4000} step={1} lead="X" label={`${t('anim.repeat.jitter')} X`} onChange={(v) => set({ jitter: { ...r.jitter!, x: v } })} />
                <ScrubNumberField value={r.jitter.y} min={0} max={4000} step={1} lead="Y" label={`${t('anim.repeat.jitter')} Y`} onChange={(v) => set({ jitter: { ...r.jitter!, y: v } })} />
                <ScrubNumberField value={r.jitter.rot} min={0} max={180} step={1} unit="°" lead={t('anim.repeat.rot')} label={`${t('anim.repeat.jitter')} ${t('anim.repeat.rot')}`} onChange={(v) => set({ jitter: { ...r.jitter!, rot: v } })} />
                <ScrubNumberField value={r.jitter.scale} min={0} max={1} step={0.01} lead={t('anim.repeat.scale')} label={`${t('anim.repeat.jitter')} ${t('anim.repeat.scale')}`} onChange={(v) => set({ jitter: { ...r.jitter!, scale: v } })} />
              </div>
            </Row>
          )}
          {layer.type === 'block' && (
            <>
              <Row label={t('anim.repeat.blocks')}>
                <Switch
                  checked={!!r.blocks}
                  onCheckedChange={(on) => set(on ? { blocks: [{ id: typeof layer.block === 'string' ? layer.block : 'minecraft:stone', weight: 1 }], arrangement: 'random' } : ({ blocks: undefined, arrangement: undefined } as Partial<Repeat>))}
                  aria-label={t('anim.repeat.blocks')}
                  data-testid="anim-repeat-blocks-on"
                />
              </Row>
              {r.blocks && (
                <>
                  <BlockListField value={r.blocks} max={16} onChange={(v) => set({ blocks: v.length > 0 ? v : r.blocks })} label={t('anim.repeat.blocks')} testId="anim-repeat-blocks" />
                  <Row label={t('anim.repeat.arrangement')}>
                    <EnumField value={r.arrangement ?? 'random'} label={t('anim.repeat.arrangement')} testId="anim-repeat-arrangement" options={ARRANGEMENT_NAMES.map((a) => ({ value: a, label: t(`anim.repeat.arrangements.${a}`) }))} onChange={(v) => set({ arrangement: v as Repeat['arrangement'] })} />
                  </Row>
                </>
              )}
            </>
          )}
          <p className="pt-1 text-xs leading-snug text-fg-subtle">{t('anim.repeat.hint')}</p>
        </>
      )}
    </ParamGroup>
  );
}
