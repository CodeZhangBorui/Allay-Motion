// 用户自己导入的音效文件（decisions.md“2026-11 反馈：素材与音效”）。
//
// 存在 userData/imported-sounds/，按资源包的结构摆放，作为资源栈最上面的一层（id 为 imported）：
//   assets/allay_user/sounds.json                    事件 imported.<slug> → 音效 allay_user:imported/<slug>
//   assets/allay_user/sounds/imported/<slug>.ogg|wav  复制进来的文件
//   names.json                                       slug → 原文件名（选择器里显示）
// 命名空间 allay_user 是本应用自有的，不会和原版或资源包的事件撞名。只收 .ogg、.wav，单个文件不超过 32 MB。
import { copyFile, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';

export const IMPORTED_LAYER_ID = 'imported';
export const IMPORTED_NAMESPACE = 'allay_user';
export const IMPORTED_DIR = 'imported-sounds';
const MAX_SOUND_BYTES = 32 * 1024 * 1024;
const MAX_SOUNDS = 500;

const NamesSchema = z.record(z.string().regex(/^[a-z0-9_]{1,64}$/), z.string().max(200));

export function importedRoot(userDataDir: string): string {
  return join(userDataDir, IMPORTED_DIR);
}

/** 文件名 → slug：小写字母、数字、下划线，最长 48；和已有的重名时加 _2、_3… */
export function soundSlug(fileName: string, taken: ReadonlySet<string>): string {
  const base =
    basename(fileName, extname(fileName))
      .normalize('NFKD')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 48) || 'sound';
  let slug = base;
  for (let i = 2; taken.has(slug); i++) slug = `${base}_${i}`;
  return slug;
}

export async function readImportedNames(root: string): Promise<Record<string, string>> {
  const raw = await readFile(join(root, 'names.json'), 'utf8').catch(() => null);
  if (raw === null) return {};
  try {
    const parsed = NamesSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : {};
  } catch {
    return {};
  }
}

async function writeAtomic(file: string, text: string): Promise<void> {
  const tmp = `${file}.${randomUUID()}.part`;
  await writeFile(tmp, text, 'utf8');
  await rename(tmp, file);
}

async function writeIndex(root: string, names: Record<string, string>, exts: Record<string, string>): Promise<void> {
  const sounds: Record<string, { sounds: { name: string }[] }> = {};
  for (const slug of Object.keys(names).sort()) {
    if (!exts[slug]) continue;
    sounds[`imported.${slug}`] = { sounds: [{ name: `${IMPORTED_NAMESPACE}:imported/${slug}` }] };
  }
  await mkdir(join(root, 'assets', IMPORTED_NAMESPACE), { recursive: true });
  await writeAtomic(join(root, 'assets', IMPORTED_NAMESPACE, 'sounds.json'), JSON.stringify(sounds, null, 2));
  await writeAtomic(join(root, 'names.json'), JSON.stringify(names, null, 2));
}

async function existingExts(root: string, names: Record<string, string>): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const slug of Object.keys(names)) {
    for (const ext of ['.ogg', '.wav']) {
      const st = await stat(join(root, 'assets', IMPORTED_NAMESPACE, 'sounds', 'imported', `${slug}${ext}`)).catch(() => null);
      if (st?.isFile()) {
        out[slug] = ext;
        break;
      }
    }
  }
  return out;
}

/** 复制文件进来，返回新事件的 ID 和跳过的个数（格式不对、过大、超过总数） */
export async function importSoundFiles(root: string, paths: readonly string[]): Promise<{ ids: string[]; skipped: number }> {
  const names = await readImportedNames(root);
  const exts = await existingExts(root, names);
  const taken = new Set(Object.keys(names));
  const ids: string[] = [];
  let skipped = 0;
  const dir = join(root, 'assets', IMPORTED_NAMESPACE, 'sounds', 'imported');
  await mkdir(dir, { recursive: true });
  for (const path of paths) {
    const ext = extname(path).toLowerCase();
    const st = await stat(path).catch(() => null);
    if ((ext !== '.ogg' && ext !== '.wav') || !st?.isFile() || st.size === 0 || st.size > MAX_SOUND_BYTES || taken.size >= MAX_SOUNDS) {
      skipped++;
      continue;
    }
    const slug = soundSlug(path, taken);
    taken.add(slug);
    const dest = join(dir, `${slug}${ext}`);
    const tmp = `${dest}.${randomUUID()}.part`;
    try {
      await copyFile(path, tmp);
      await rename(tmp, dest);
    } catch {
      await rm(tmp, { force: true });
      skipped++;
      continue;
    }
    names[slug] = basename(path).slice(0, 200);
    exts[slug] = ext;
    ids.push(`${IMPORTED_NAMESPACE}:imported.${slug}`);
  }
  if (ids.length > 0) await writeIndex(root, names, exts);
  return { ids, skipped };
}

/** 删掉一个导入的音效（事件 ID allay_user:imported.<slug>） */
export async function removeImportedSound(root: string, eventId: string): Promise<boolean> {
  const m = /^allay_user:imported\.([a-z0-9_]{1,64})$/.exec(eventId);
  if (!m) return false;
  const slug = m[1]!;
  const names = await readImportedNames(root);
  if (!(slug in names)) return false;
  delete names[slug];
  for (const ext of ['.ogg', '.wav']) await rm(join(root, 'assets', IMPORTED_NAMESPACE, 'sounds', 'imported', `${slug}${ext}`), { force: true });
  await writeIndex(root, names, await existingExts(root, names));
  return true;
}
