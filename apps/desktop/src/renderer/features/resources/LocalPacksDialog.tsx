import { matchesVersionQuery } from '@allay/assets';
import { Button } from '@allay/ui/components/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@allay/ui/components/dialog';
import { Input, Spinner } from '@allay/ui/components/misc';
import { ICON } from '@allay/ui/lib/icons';
import { CheckCircle, FileZip, Folder, MagnifyingGlass, Warning } from '@phosphor-icons/react';
import type { TFunction } from 'i18next';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { LocalPackFolderInfo } from '../../../shared/resources';
import { notify } from '../../stores/noticeStore';
import { useResourceStore } from '../../stores/resourceStore';
import { compatText } from './compat';

// “本机 Minecraft 的资源包”（2026-11 反馈）：列出主进程探测到的 resourcepacks 文件夹（官方启动器、版本隔离、
// Prism、CurseForge、Modrinth），写明对应的游戏版本和完整路径；用户挑其中的资源包加进资源栈。
// 只读本机文件、不联网；zip 原地只读引用，不复制。

function folderTitle(t: TFunction, f: LocalPackFolderInfo): string {
  const launcher = t(`resources.localPacks.launchers.${f.launcher}`, { instance: f.instance ?? '' });
  const version = f.gameVersion ? t('resources.vanillaName', { version: f.gameVersion }) : f.launcher === 'official' ? t('resources.localPacks.shared') : t('resources.localPacks.unknownVersion');
  return `${launcher} · ${version}`;
}

export function LocalPacksDialog({ open, onOpenChange }: { open: boolean; onOpenChange(open: boolean): void }) {
  const { t } = useTranslation();
  const stamp = useResourceStore((s) => s.state?.stamp ?? '');
  const base = useResourceStore((s) => s.state?.vanilla.baseVersion ?? null);
  const [folders, setFolders] = useState<LocalPackFolderInfo[] | null>(null);
  const [q, setQ] = useState('');

  useEffect(() => {
    if (!open) return;
    let live = true;
    void window.allay.resources.localPacks().then(
      (f) => live && setFolders(f),
      () => live && setFolders([]),
    );
    return () => {
      live = false;
    };
  }, [open, stamp]);

  const shown = useMemo(
    () =>
      (folders ?? [])
        .map((f) => ({ ...f, packs: f.packs.filter((p) => matchesVersionQuery(q, p.name, p.description, f.gameVersion, f.path, f.instance, p.madeFor)) }))
        .filter((f) => f.packs.length > 0 || (!q && f.packs.length === 0)),
    [folders, q],
  );

  const add = async (path: string) => {
    const r = await window.allay.resources.addLocalPack(path).catch(() => null);
    if (!r || 'canceled' in r) return;
    if (r.ok) notify('info', t('resources.added'));
    else notify('error', t(`resources.addErrors.${r.error}`));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[min(80vh,640px)] w-[600px] flex-col gap-3" data-testid="local-packs">
        <DialogTitle>{t('resources.localPacks.title')}</DialogTitle>
        <DialogDescription className="text-xs leading-relaxed">{t('resources.localPacks.rules')}</DialogDescription>
        <div className="relative">
          <MagnifyingGlass size={ICON.sm} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-fg-subtle" aria-hidden="true" />
          <Input autoFocus value={q} onChange={(e) => setQ(e.currentTarget.value)} placeholder={t('resources.localPacks.search')} aria-label={t('resources.localPacks.search')} className="pl-8" data-testid="local-packs-search" />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto" data-testid="local-packs-list">
          {folders === null && (
            <div className="flex justify-center py-6">
              <Spinner label={t('resources.localPacks.scanning')} />
            </div>
          )}
          {folders !== null && folders.length === 0 && <p className="py-6 text-center text-xs text-fg-muted">{t('resources.localPacks.none')}</p>}
          {shown.map((f) => (
            <section key={f.path} className="flex flex-col gap-0.5 border-b border-divider py-2 last:border-b-0" data-testid="local-pack-folder" data-launcher={f.launcher}>
              <p className="text-sm font-medium">{folderTitle(t, f)}</p>
              <p className="truncate text-xs text-fg-subtle" title={f.path}>
                {f.path}
              </p>
              {f.packs.length === 0 && <p className="py-1 text-xs text-fg-muted">{t('resources.localPacks.empty')}</p>}
              <ul className="mt-1 flex flex-col">
                {f.packs.map((p) => {
                  const compat = compatText(t, p, base);
                  return (
                    <li key={p.path} className="flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-control" data-testid="local-pack" data-path={p.path}>
                      {p.kind === 'zip' ? <FileZip size={ICON.md} className="shrink-0 text-fg-subtle" aria-hidden="true" /> : <Folder size={ICON.md} className="shrink-0 text-fg-subtle" aria-hidden="true" />}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm" title={p.name}>
                          {p.name}
                        </p>
                        {p.description && (
                          <p className="truncate text-xs text-fg-subtle" title={p.description}>
                            {p.description}
                          </p>
                        )}
                        {compat && (
                          <p className={`flex items-center gap-1 text-xs ${compat.warn ? 'text-warning' : 'text-fg-subtle'}`}>
                            {compat.warn && <Warning size={ICON.sm} className="shrink-0" aria-hidden="true" />}
                            <span className="truncate" title={compat.text}>
                              {compat.text}
                            </span>
                          </p>
                        )}
                      </div>
                      {p.added ? (
                        <span className="inline-flex shrink-0 items-center gap-1 text-xs text-fg-muted">
                          <CheckCircle size={ICON.sm} />
                          {t('resources.versions.added')}
                        </span>
                      ) : (
                        <Button size="sm" variant="secondary" data-testid="local-pack-add" onClick={() => void add(p.path)}>
                          {t('resources.versions.add')}
                        </Button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
