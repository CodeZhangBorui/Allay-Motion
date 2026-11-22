// 封面的键和取帧（纯函数，covers.ts 和单元测试共用；docs/decisions.md“模板库撑到一百个模板”）。
import { CONTENT_HASH_RE, type TemplateEntry } from '../../../shared/templates';

export const COVER_W = 320;
export const COVER_H = 180;
export const COVER_FPS = 30;

/** 内存里（useCoverStore.covers）的键：一个模板（id、版本）一项，官网也按它找 */
export function coverKey(id: string, version: string): string {
  return `cover_${`${id}_${version}`.toLowerCase().replace(/[^a-z0-9_.~-]/g, '_')}`.slice(0, 190);
}

const safe = (s: string, max: number) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9_.~-]/g, '_')
    .slice(0, max);

/**
 * 磁盘缓存的键：id、版本、内容哈希、界面语言（目录是 resourceStamp，所以资源栈也在键里）。
 * 加上 ~sheet 也不超过 ThumbKeySchema 的 200 字，只有它允许的字符
 */
export function coverDiskKey(entry: Pick<TemplateEntry, 'id' | 'version' | 'contentHash'>, locale: string): string {
  const hash = CONTENT_HASH_RE.test(entry.contentHash) ? entry.contentHash : 'nohash';
  return `cover2_${safe(entry.id, 120)}_${safe(entry.version, 24)}_${hash}_${safe(locale, 8)}`;
}

/** 封面取哪一帧：剪辑点那一帧；没有剪辑点取（前 4 秒的）中间一帧 */
export function coverFrame(cutTime: number | null, total: number): number {
  return cutTime === null ? Math.floor(total / 2) : Math.max(0, Math.min(total - 1, Math.round(cutTime * COVER_FPS)));
}
