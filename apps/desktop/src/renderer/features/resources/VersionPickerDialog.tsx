import { matchesVersionQuery } from '@allay/assets';
import { Button } from '@allay/ui/components/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@allay/ui/components/dialog';
import { Badge, Input, ToggleGroup, ToggleGroupItem } from '@allay/ui/components/misc';
import { ICON } from '@allay/ui/lib/icons';
import { CheckCircle, CloudArrowDown, GameController, HardDrives, MagnifyingGlass, Warning } from '@phosphor-icons/react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { VersionCatalog, VersionEntry, VersionKind } from '../../../shared/resources';
import { notify } from '../../stores/noticeStore';
import { useResourceStore } from '../../stores/resourceStore';
import { DownloadProgress } from './DownloadProgress';

// 版本检索（docs/03-assets.md 3.12、2026-11 反馈）：本机游戏里带 jar 的版本、下载缓存里的版本，
// 以及（用户点了“获取版本列表”之后）Mojang 版本清单里的版本。可以按版本号、路径搜索，按来源和类型筛选；
// 选一个加进资源栈，放在原版层最上面（成为基底）。下载只在用户点按钮后发生，走 M2a 的下载例外。

type SourceFilter = 'all' | 'local' | 'downloaded' | 'remote';
type TypeFilter = 'release' | 'snapshot' | 'all';

interface Row {
  source: 'local' | 'downloaded' | 'remote';
  entry: VersionEntry;
}

function dateText(iso: string, locale: string): string {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? '' : new Date(t).toLocaleDateString(locale, { year: 'numeric', month: '2-digit', day: '2-digit' });
}

export function VersionPickerDialog({ open, onOpenChange }: { open: boolean; onOpenChange(open: boolean): void }) {
  const { t, i18n } = useTranslation();
  const download = useResourceStore((s) => s.state?.download ?? null);
  const stamp = useResourceStore((s) => s.state?.stamp ?? '');
  const [catalog, setCatalog] = useState<VersionCatalog | null>(null);
  const [q, setQ] = useState('');
  const [source, setSource] = useState<SourceFilter>('all');
  const [kind, setKind] = useState<TypeFilter>('release');
  const [fetching, setFetching] = useState(false);

  // 打开时、资源栈变了（加入、下载完成）时重新取一次（离线）
  useEffect(() => {
    if (!open) return;
    let live = true;
    void window.allay.resources.versions().then((c) => live && setCatalog(c));
    return () => {
      live = false;
    };
  }, [open, stamp]);

  const rows = useMemo<Row[]>(() => {
    if (!catalog) return [];
    const out: Row[] = [];
    const known = new Set<string>();
    const push = (src: Row['source'], list: readonly VersionEntry[]) => {
      for (const e of list) {
        if (kind !== 'all' && e.type !== kind) continue;
        if (source !== 'all' && source !== src) continue;
        // Mojang 清单里已经下载过的版本只列在“已下载”里
        if (src === 'remote' && known.has(e.versionId)) continue;
        if (src === 'downloaded') known.add(e.versionId);
        if (!matchesVersionQuery(q, e.versionId, e.gameVersion, e.gameDir, t(`resources.versions.sources.${src}`))) continue;
        out.push({ source: src, entry: e });
      }
    };
    push('local', catalog.local);
    push('downloaded', catalog.downloaded);
    if (catalog.remote) push('remote', catalog.remote.versions);
    return out;
  }, [catalog, q, source, kind, t]);

  const fetchRemote = async () => {
    setFetching(true);
    const r = await window.allay.resources.fetchRemoteVersions().catch(() => null);
    setFetching(false);
    if (r?.ok) setCatalog(r.catalog);
    else notify('error', t(`resources.download.errors.${r && !r.ok ? r.error : 'unknown'}`));
  };

  const add = async (row: Row) => {
    if (row.source === 'remote') {
      // 结果（进度、失败）经 resources:changed 推过来；成功后这一版在原版层最上面
      void window.allay.resources.downloadVanillaVersion(row.entry.versionId);
      return;
    }
    const state = await window.allay.resources.addVanillaSource(
      row.source === 'local' ? { kind: 'local', gameDir: row.entry.gameDir ?? '', versionId: row.entry.versionId } : { kind: 'downloaded', versionId: row.entry.versionId },
    );
    useResourceStore.getState().replace(state);
    // 加不进来的（jar 不完整或打不开）资源栈不变：重新取一次列表，把原因标在那一行上
    const next = await window.allay.resources.versions().catch(() => null);
    if (next) setCatalog(next);
  };

  const running = download?.status === 'running';
  const Icon = { local: GameController, downloaded: HardDrives, remote: CloudArrowDown } as const;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[min(80vh,640px)] w-[560px] flex-col gap-3" data-testid="version-picker">
        <DialogTitle>{t('resources.versions.title')}</DialogTitle>
        <DialogDescription className="text-xs leading-relaxed">{t('resources.versions.rules')}</DialogDescription>
        <div className="relative">
          <MagnifyingGlass size={ICON.sm} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-fg-subtle" aria-hidden="true" />
          <Input autoFocus value={q} onChange={(e) => setQ(e.currentTarget.value)} placeholder={t('resources.versions.search')} aria-label={t('resources.versions.search')} className="pl-8" data-testid="version-search" />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ToggleGroup value={[source]} onValueChange={(v) => v[0] && setSource(v[0] as SourceFilter)} aria-label={t('resources.versions.sourceFilter')} data-testid="version-source-filter">
            {(['all', 'local', 'downloaded', 'remote'] as const).map((s) => (
              <ToggleGroupItem key={s} value={s} data-testid={`version-source-${s}`}>
                {t(`resources.versions.sources.${s}`)}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <ToggleGroup value={[kind]} onValueChange={(v) => v[0] && setKind(v[0] as TypeFilter)} aria-label={t('resources.versions.typeFilter')} data-testid="version-type-filter">
            {(['release', 'snapshot', 'all'] as const).map((k) => (
              <ToggleGroupItem key={k} value={k} data-testid={`version-type-${k}`}>
                {t(`resources.versions.types.${k}`)}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
        {running && download && <DownloadProgress state={download} />}
        <ul className="min-h-0 flex-1 overflow-y-auto" data-testid="version-list">
          {catalog && rows.length === 0 && <li className="py-6 text-center text-xs text-fg-muted">{t('resources.versions.empty')}</li>}
          {rows.map((row) => {
            const e = row.entry;
            const SrcIcon = Icon[row.source];
            const latest = row.source === 'remote' && catalog?.remote?.latest === e.versionId;
            return (
              <li key={`${row.source}:${e.gameDir ?? ''}:${e.versionId}`} className="flex items-center gap-2 rounded-md px-1.5 py-1.5 hover:bg-control" data-testid="version-row" data-source={row.source} data-version={e.versionId}>
                <SrcIcon size={ICON.md} className="shrink-0 text-fg-subtle" aria-label={t(`resources.versions.sources.${row.source}`)} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    {/* 本机的是目录名（模组版本、整合包的名字原样显示），真实的游戏版本另外标出来 */}
                    <span className="num truncate text-sm" title={e.versionId}>
                      {e.versionId}
                    </span>
                    {e.gameVersion && (
                      <Badge className="shrink-0" data-testid="version-game">
                        {t('resources.versions.gameVersion', { version: e.gameVersion })}
                      </Badge>
                    )}
                    {e.type !== 'release' && <Badge className="shrink-0">{t(`resources.versions.types.${e.type satisfies VersionKind}`)}</Badge>}
                    {latest && <Badge className="shrink-0">{t('resources.versions.latest')}</Badge>}
                  </div>
                  <p className="truncate text-xs text-fg-subtle" title={e.gameDir}>
                    {[dateText(e.releaseTime, i18n.language), row.source === 'local' ? e.gameDir : t(`resources.versions.sources.${row.source}`)].filter(Boolean).join(' · ')}
                  </p>
                  {e.problem && (
                    <p className="flex items-start gap-1 text-xs leading-relaxed text-warning" data-testid="version-jar-problem" data-problem={e.problem}>
                      <Warning size={ICON.sm} className="mt-0.5 shrink-0" aria-hidden="true" />
                      {t(e.problem === 'not-client' ? 'resources.versions.notClient' : 'resources.versions.unreadable')}
                    </p>
                  )}
                </div>
                {e.layerId ? (
                  <span className="inline-flex shrink-0 items-center gap-1 text-xs text-fg-muted" data-testid="version-added">
                    <CheckCircle size={ICON.sm} />
                    {t('resources.versions.added')}
                  </span>
                ) : e.problem ? null : (
                  <Button size="sm" variant="secondary" disabled={running} data-testid="version-add" onClick={() => void add(row)}>
                    {t(row.source === 'remote' ? 'resources.versions.download' : 'resources.versions.add')}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
        <div className="flex flex-col gap-1.5 border-t border-divider pt-3">
          <Button variant="ghost" className="self-start" disabled={fetching} data-testid="version-fetch-remote" onClick={() => void fetchRemote()}>
            <CloudArrowDown size={ICON.sm} />
            {t(fetching ? 'resources.versions.fetching' : catalog?.remote ? 'resources.versions.refetch' : 'resources.versions.fetch')}
          </Button>
          <p className="text-xs leading-relaxed text-fg-muted">{t('resources.versions.fetchNote')}</p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
