// 检查器里的“路径”一组（docs/animation-editor.md 10.11）：打开时给一条缓弧，并让 progress 在整段里从 0 走到 1；
// 首尾相接、自动朝向；加点、删点。点和手柄在预览里拖（StageOverlay）。改动都经 animSetPath 命令。
import { Button } from '@allay/ui/components/button';
import { Switch } from '@allay/ui/components/switch';
import { BooleanField, ParamGroup } from '@allay/ui/editor';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { defaultPath, type AnimPath } from '../../../shared/animation/path';
import { docDuration } from '../../../shared/animation/resolve';
import type { AnimationDoc, Layer } from '../../../shared/animation/schema';
import { trigger } from '../../app/registry';

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid min-h-row grid-cols-[minmax(72px,30%)_1fr] items-center gap-2.5">
      <span className="min-w-0 truncate text-fg-muted">{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function PathSection({ doc, layer }: { doc: AnimationDoc; layer: Layer }) {
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState(false);
  const p = layer.path;
  const set = (path: AnimPath | null, progress?: unknown) => trigger('animSetPath', { layer: layer.id, path, ...(progress !== undefined ? { progress } : {}) });
  const addPoint = () => {
    if (!p) return;
    const last = p.points.at(-1)!;
    const prev = p.points.at(-2)!;
    // 沿最后一段的方向再延长一段
    set({ ...p, points: [...p.points, { x: last.x + (last.x - prev.x), y: last.y + (last.y - prev.y) }] });
  };
  return (
    <ParamGroup id="anim-path" title={t('anim.path.title')} collapsed={collapsed} onToggle={setCollapsed} extra={p ? t('anim.path.points', { count: p.points.length }) : undefined}>
      <Row label={t('anim.path.on')}>
        <Switch
          checked={!!p}
          onCheckedChange={(on) => (on ? set(defaultPath(0, 0), { keys: [{ t: 0, v: 0, ease: 'cubicInOut' }, { t: docDuration(doc), v: 1 }] }) : set(null))}
          aria-label={t('anim.path.on')}
          data-testid="anim-path-on"
        />
      </Row>
      {p && (
        <>
          <Row label={t('anim.path.closed')}>
            <BooleanField value={p.closed} onChange={(v) => set({ ...p, closed: v })} label={t('anim.path.closed')} testId="anim-path-closed" />
          </Row>
          <Row label={t('anim.path.orient')}>
            <BooleanField value={p.orient} onChange={(v) => set({ ...p, orient: v })} label={t('anim.path.orient')} testId="anim-path-orient" />
          </Row>
          <div className="flex gap-[5px] py-1">
            <Button variant="secondary" size="sm" onClick={addPoint} disabled={p.points.length >= 64} data-testid="anim-path-add">
              {t('anim.path.addPoint')}
            </Button>
            <Button variant="secondary" size="sm" onClick={() => set({ ...p, points: p.points.slice(0, -1) })} disabled={p.points.length <= 2} data-testid="anim-path-remove">
              {t('anim.path.removePoint')}
            </Button>
          </div>
          <p className="pt-1 text-xs leading-snug text-fg-subtle">{t('anim.path.hint')}</p>
        </>
      )}
    </ParamGroup>
  );
}
