import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { writeZip } from '../../apps/desktop/src/main/templates/zip-writer';
import { ROOT } from './helpers';

// 测试时现拼的模板库（docs/decisions.md“模板库撑到一百个模板”）：把 resources/templates/ 里构建好的内置模板包原样放进去，
// 再复制若干份改 id、名字、分组和类别，凑够 count 个。分组和类别的分布照 docs/template-catalog.md 1.0 的总表
// （八个组 14/15/27/11/11/11/6/5，转场 39、叠加 53、标题 8）。不提交任何生成的包：每次测试在临时目录里重新拼。
// 复制品的画面和它的原件相同（代码不动），只有 manifest 的 id、name、tags、category 变了。标成“标题”的复制品都来自叠加层
// （没有剪辑点，和标题类别的约定一致）。

export const GROUP_TARGET: Readonly<Record<string, number>> = { blocks: 14, items: 15, ui: 27, particles: 11, text: 11, channel: 11, shader: 6, seasonal: 5 };

/** 每个组还缺的那些份，各用什么类别（总数凑成转场 39、叠加 53、标题 8） */
const COPY_PLAN: Readonly<Record<string, readonly ['transition' | 'overlay' | 'title', number][]>> = {
  blocks: [['transition', 12]],
  items: [
    ['transition', 8],
    ['overlay', 6],
  ],
  ui: [['overlay', 14]],
  particles: [
    ['transition', 6],
    ['overlay', 5],
  ],
  text: [
    ['overlay', 5],
    ['title', 6],
  ],
  channel: [
    ['overlay', 9],
    ['title', 2],
  ],
  shader: [['transition', 5]],
  seasonal: [
    ['transition', 3],
    ['overlay', 2],
  ],
};

interface Original {
  file: string;
  manifest: Record<string, unknown> & { id: string; category: string; name: unknown; tags?: string[] };
  entries: { path: string; data: Uint8Array }[];
}

export interface LibraryEntry {
  id: string;
  category: string;
  group: string;
  copyOf: string | null;
}

/**
 * 读构建脚本自己写出的包（zip-writer.ts：只有存储和 deflate 两种方法、没有数据描述符）。只给测试用，
 * 不做应用里 zip.ts 的那些防护：输入是本仓库刚构建出来的文件
 */
function readOwnZip(file: string): { path: string; data: Uint8Array }[] {
  const buf = readFileSync(file);
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (end < 0) throw new Error(`${file} 不是 zip`);
  const count = buf.readUInt16LE(end + 10);
  let p = buf.readUInt32LE(end + 16);
  const out: { path: string; data: Uint8Array }[] = [];
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error(`${file}：中央目录损坏`);
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const path = buf.toString('utf8', p + 46, p + 46 + nameLen);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const body = buf.subarray(start, start + size);
    out.push({ path, data: new Uint8Array(method === 8 ? inflateRawSync(body) : body) });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

function readOriginals(): Original[] {
  const dir = join(ROOT, 'resources', 'templates');
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.allaytpl'))
    .sort();
  if (files.length === 0) throw new Error('resources/templates 是空的：先 pnpm build（或 pnpm templates:build）');
  return files.map((f) => {
    const entries = readOwnZip(join(dir, f));
    const manifest = JSON.parse(new TextDecoder().decode(entries.find((e) => e.path === 'manifest.json')!.data)) as Original['manifest'];
    return { file: f, manifest, entries };
  });
}

const GROUPS = Object.keys(GROUP_TARGET);

/** 原件所在的组：tags 里第一个组名（和模板库的归组规则一致）；没有时归“其他” */
function groupOf(m: Original['manifest']): string {
  return (m.tags ?? []).find((t) => GROUPS.includes(t)) ?? 'other';
}

function localized(name: unknown, lang: 'zh-CN' | 'en'): string {
  if (typeof name === 'string') return name;
  const n = name as Record<string, string | undefined>;
  return n[lang] ?? n.en ?? n['zh-CN'] ?? '';
}

/**
 * 在 dir 里拼一个有 count 个内置模板包的目录（ALLAY_E2E_TEMPLATES_DIR 指向它）。返回每个模板的 id、类别、组。
 * count 小于原件数时只放前 count 个原件。
 */
export function makeTemplateLibrary(dir: string, count = 100): LibraryEntry[] {
  mkdirSync(dir, { recursive: true });
  const originals = readOriginals();
  const out: LibraryEntry[] = [];
  const write = (manifest: Original['manifest'], entries: Original['entries']) => {
    const files = entries.map((e) => (e.path === 'manifest.json' ? { path: e.path, data: Buffer.from(JSON.stringify(manifest, null, 2)) } : e));
    writeFileSync(join(dir, `${manifest.id}-${String(manifest.version)}.allaytpl`), writeZip(files));
  };
  for (const o of originals.slice(0, count)) {
    write(o.manifest, o.entries);
    out.push({ id: o.manifest.id, category: o.manifest.category, group: groupOf(o.manifest), copyOf: null });
  }
  // 按组、按类别轮流取原件来复制
  const byCategory = (c: string) => originals.filter((o) => o.manifest.category === (c === 'title' ? 'overlay' : c));
  const cursor = new Map<string, number>();
  let n = out.length;
  for (const group of GROUPS) {
    for (const [category, copies] of COPY_PLAN[group]!) {
      const pool = byCategory(category);
      for (let i = 0; i < copies && n < count; i++) {
        const k = cursor.get(category) ?? 0;
        cursor.set(category, k + 1);
        const src = pool[k % pool.length]!;
        n++;
        const num = String(n).padStart(3, '0');
        const id = `allay.builtin.lib-${num}`;
        const manifest = {
          ...src.manifest,
          id,
          name: { 'zh-CN': `${localized(src.manifest.name, 'zh-CN')} ${num}`, en: `${localized(src.manifest.name, 'en')} ${num}` },
          category,
          tags: [group, 'library-copy'],
        };
        write(manifest, src.entries);
        out.push({ id, category, group, copyOf: src.manifest.id });
      }
    }
  }
  return out;
}
