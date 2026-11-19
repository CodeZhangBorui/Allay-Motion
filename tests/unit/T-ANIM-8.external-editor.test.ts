// T-ANIM-8：外部编辑器（docs/animation-editor.md 9.4）——文件写在应用自己的目录里、名字由键决定，
// 外部改了推回来、自己写的不回推，三种打开方式（指定程序时按参数数组启动）。
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defaultEditorAppSettings, type AnimationFileChange, type EditorAppSettings } from '../../apps/desktop/src/shared/code-window';
import { ExternalEditorService } from '../../apps/desktop/src/main/external-editor';
import { createLogger } from '../../apps/desktop/src/main/logger';
import type { SettingsStore } from '../../apps/desktop/src/main/settings-store';

describe('T-ANIM-8 外部编辑器', () => {
  let dir: string;
  let editor: EditorAppSettings;
  let changes: AnimationFileChange[];
  let opened: string[];
  let launched: [string, string][];
  let svc: ExternalEditorService;
  const KEY = 'user.abc123.animation';

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'allay-ext-'));
    editor = defaultEditorAppSettings();
    changes = [];
    opened = [];
    launched = [];
    const settings = {
      get editorSettings() {
        return editor;
      },
      updateEditor: async (patch: Partial<EditorAppSettings>) => void (editor = { ...editor, ...patch }),
    } as unknown as SettingsStore;
    svc = new ExternalEditorService({
      userDataDir: dir,
      settings,
      log: createLogger(null, false),
      openPath: async (f) => (opened.push(f), ''),
      pickProgram: async () => 'C:\\Tools\\Code.exe',
      onFileChanged: (c) => changes.push(c),
      launch: async (p, f) => (launched.push([p, f]), true),
    });
  });
  afterEach(() => {
    svc.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const waitFor = async (pred: () => boolean) => {
    for (let i = 0; i < 200 && !pred(); i++) await new Promise((r) => setTimeout(r, 20));
    expect(pred()).toBe(true);
  };

  it('文件在应用自己的目录里、名字由键决定；不合格式的键拒绝（不会拼出别的路径）', () => {
    expect(svc.fileOf(KEY)).toBe(join(dir, 'animations', `${KEY}.json`));
    expect(() => svc.fileOf('..\\..\\evil')).toThrow();
    expect(() => svc.fileOf('user.abc123.animation/../x')).toThrow();
  });

  it('默认（应用自带）和“系统默认”用 openPath 打开 .json；指定程序时按参数数组启动，只传这一个文件', async () => {
    expect(await svc.openExternal(KEY, '{}')).toEqual({ ok: true });
    expect(opened).toEqual([svc.fileOf(KEY)]);
    await svc.setKind('custom');
    // 还没选程序
    svc.close();
    editor = { kind: 'custom', program: null };
    expect(await svc.openExternal(KEY, '{}')).toEqual({ ok: false, error: 'no-program' });
    const chosen = await svc.chooseProgram();
    expect(chosen).toEqual({ kind: 'custom', programName: 'Code.exe', canceled: false });
    expect(await svc.openExternal(KEY, '{}')).toEqual({ ok: true });
    expect(launched).toEqual([['C:\\Tools\\Code.exe', svc.fileOf(KEY)]]);
  });

  it('外部改了文件推回来；应用自己写的（syncFile）不回推', async () => {
    await svc.openExternal(KEY, 'one');
    await svc.syncFile(KEY, 'two');
    expect(readFileSync(svc.fileOf(KEY), 'utf8')).toBe('two');
    await new Promise((r) => setTimeout(r, 400));
    expect(changes).toEqual([]);
    writeFileSync(svc.fileOf(KEY), 'three');
    await waitFor(() => changes.length === 1);
    expect(changes[0]).toEqual({ key: KEY, text: 'three' });
  });
});
