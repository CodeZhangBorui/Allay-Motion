import { diffFromDefaults, isDerived, localize } from '@allay/template-sdk';
import { Button } from '@allay/ui/components/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '@allay/ui/components/dialog';
import { Input } from '@allay/ui/components/misc';
import { Switch } from '@allay/ui/components/switch';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { notify } from '../../stores/noticeStore';
import { useProjectStore } from '../../stores/projectStore';
import { useTemplateStore } from '../../stores/templateStore';
import { useUiStore } from '../../stores/uiStore';
import { selectTemplate } from '../templates/actions';
import { saveCurrentPreset } from '../templates/presets';

// “保存为预设”和“另存为模板”两个弹窗（4.7）。

function close() {
  useUiStore.getState().openDialog(null);
}

export function SavePresetDialog({ onSaved }: { onSaved(): void }) {
  const { t, i18n } = useTranslation();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    const saved = await saveCurrentPreset(name.trim(), i18n.language).catch(() => null);
    setBusy(false);
    if (!saved) {
      notify('error', t('params.presets.saveFailed'));
      return;
    }
    notify('info', t('params.presets.saved', { name: saved.name }));
    onSaved();
    close();
  };
  return (
    <Dialog open onOpenChange={(open) => !open && close()}>
      <DialogContent closeLabel={t('common.close')} data-testid="save-preset-dialog">
        <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-4">
          <DialogTitle>{t('params.presets.saveTitle')}</DialogTitle>
          <DialogDescription>{t('params.presets.saveBody')}</DialogDescription>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-fg-muted">{t('common.name')}</span>
            <Input autoFocus value={name} maxLength={100} onChange={(e) => setName(e.currentTarget.value)} data-testid="preset-name" />
          </label>
          <DialogFooter>
            <Button type="button" variant="secondary" size="lg" onClick={close}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" size="lg" disabled={!name.trim() || busy} data-testid="preset-save-confirm">
              {t('common.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * 另存为模板（4.7）：填名称、勾选要保留在属性面板里的参数（没勾的隐藏，取当前值作为默认值）。
 * 当前改过的参数都成为派生模板的默认值；texture 参数里用户选的图片（file:）由主进程复制进派生模板的 assets/。
 */
export function SaveTemplateDialog() {
  const { t, i18n } = useTranslation();
  const template = useProjectStore((s) => s.template);
  const params = useProjectStore((s) => s.params);
  const locale = i18n.language;
  const base = template && !isDerived(template.manifest) ? template : null;
  const [name, setName] = useState(() => (template ? `${localize(template.manifest.name, locale)} 2` : ''));
  const visible = template ? template.params.filter((p) => !template.hidden.includes(p.key)) : [];
  const [keep, setKeep] = useState<Record<string, boolean>>(() => Object.fromEntries(visible.map((p) => [p.key, true])));
  const [busy, setBusy] = useState(false);
  if (!template) return null;
  // 派生模板只能派生一层：从派生模板另存时，基模板是它的基模板，当前的默认值和隐藏项一并带上
  const entries = useTemplateStore.getState().entries;
  const baseRef = base ? base.ref : (() => {
    const e = entries.find((x) => x.id === template.ref.id && x.version === template.ref.version);
    const ext = e?.manifest.extends;
    if (!ext) return null;
    const cands = entries.filter((x) => x.id === ext.id && x.kind === 'script').map((x) => x.version);
    return cands.length > 0 ? { id: ext.id, version: cands[cands.length - 1]! } : null;
  })();
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!baseRef || !name.trim() || busy) return;
    setBusy(true);
    // 从脚本模板另存：只记改过的；从派生模板另存：它自己的默认值是覆盖过的，全部当前值都记下
    const defaults = base ? diffFromDefaults(template.params, params, { locale }) : { ...params };
    // 被隐藏的参数也要把当前值记成默认值（隐藏后用户就改不了了）
    for (const p of visible) if (!keep[p.key]) defaults[p.key] = params[p.key]!;
    const hidden = [...template.hidden, ...visible.filter((p) => !keep[p.key]).map((p) => p.key)];
    const r = await window.allay.templates.saveDerived({ base: baseRef, name: name.trim(), defaults, hidden }).catch(() => ({ ok: false as const, error: 'internal' }));
    setBusy(false);
    if (!r.ok) {
      notify('error', t('params.saveTemplate.failed', { reason: r.error === 'image-unreadable' ? t('params.saveTemplate.imageUnreadable') : r.error }));
      return;
    }
    await useTemplateStore.getState().refresh();
    await selectTemplate(r.entry.id, r.entry.version, locale);
    notify('info', t('params.saveTemplate.saved', { name: name.trim() }));
    close();
  };
  return (
    <Dialog open onOpenChange={(open) => !open && close()}>
      <DialogContent closeLabel={t('common.close')} className="w-[480px]" data-testid="save-template-dialog">
        <form onSubmit={(e) => void submit(e)} className="flex min-h-0 flex-col gap-4">
          <DialogTitle>{t('params.saveTemplate.title')}</DialogTitle>
          <DialogDescription>{t('params.saveTemplate.body')}</DialogDescription>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-fg-muted">{t('common.name')}</span>
            <Input autoFocus value={name} maxLength={60} onChange={(e) => setName(e.currentTarget.value)} data-testid="template-name" />
          </label>
          <fieldset className="flex min-h-0 flex-col gap-1">
            <legend className="mb-1 text-xs text-fg-muted">{t('params.saveTemplate.keep')}</legend>
            <div className="max-h-[260px] overflow-y-auto rounded-md border">
              {visible.map((p) => {
                const label = localize(p.label, locale);
                return (
                  <label key={p.key} className="flex h-8 items-center justify-between gap-2 border-b px-2 last:border-b-0">
                    <span className="truncate text-sm">{label}</span>
                    <Switch checked={keep[p.key] ?? true} onCheckedChange={(v) => setKeep((k) => ({ ...k, [p.key]: v }))} aria-label={t('params.saveTemplate.keepOne', { name: label })} />
                  </label>
                );
              })}
            </div>
          </fieldset>
          {!baseRef && <p className="text-xs text-danger">{t('params.saveTemplate.noBase')}</p>}
          <DialogFooter>
            <Button type="button" variant="secondary" size="lg" onClick={close}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" size="lg" disabled={!baseRef || !name.trim() || busy} data-testid="template-save-confirm">
              {t('common.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
