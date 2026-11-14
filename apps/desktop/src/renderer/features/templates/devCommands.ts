// 模板开发模式的入口（docs/08-milestones.md MD）：“打开模板文件夹”“复制当前内置模板来修改”。
// 经注册表注册成命令（命令面板、菜单都从注册表读）；文件夹的路径由主进程按 id 和版本决定，渲染进程碰不到路径。
import { localize } from '@allay/template-sdk';
import { Copy, FolderUser } from '@phosphor-icons/react';
import i18next from 'i18next';
import { z } from 'zod';
import { defineCommand, type AnyCommand } from '../../app/registry';
import type { TemplateDevError, TemplateEntry } from '../../../shared/templates';
import { notify } from '../../stores/noticeStore';
import { useProjectStore } from '../../stores/projectStore';
import { useTemplateStore } from '../../stores/templateStore';
import { selectTemplate } from './actions';

const RefInput = z.strictObject({ id: z.string().min(1).max(128), version: z.string().min(1).max(64) }).optional();
const RefOutput = z.strictObject({ id: z.string(), version: z.string() }).nullable();

function entryOf(ref: { id: string; version: string } | undefined): TemplateEntry | undefined {
  if (!ref) return undefined;
  return useTemplateStore.getState().entries.find((e) => e.id === ref.id && e.version === ref.version);
}

const currentRef = () => useProjectStore.getState().template?.ref;
const currentIsUser = () => entryOf(currentRef())?.source === 'user';
const currentIsBuiltinScript = () => {
  const e = entryOf(currentRef());
  return e?.source === 'builtin' && e.kind === 'script';
};

function failed(error: TemplateDevError): void {
  notify('error', i18next.t('dev.failed', { reason: i18next.t(`dev.errors.${error}`) }));
}

/** 在系统的文件管理器里打开用户模板的文件夹（只开文件夹，不打开任何文件） */
export async function openTemplateFolder(ref = currentRef()): Promise<boolean> {
  if (!ref) return false;
  const r = await window.allay.templates.openFolder(ref.id, ref.version);
  if (!r.ok) failed(r.error);
  return r.ok;
}

/**
 * 把内置模板复制成用户模板（主进程同时写好 template-api.d.ts 和 jsconfig.json），然后选中它，参数沿用当前的取值。
 * 名字是“原名（副本）”，按当前界面语言取一次。
 */
export async function copyBuiltinTemplate(ref = currentRef()): Promise<{ id: string; version: string } | null> {
  const entry = entryOf(ref);
  if (!ref || !entry) return null;
  const locale = i18next.language;
  const name = i18next.t('dev.copyName', { name: localize(entry.manifest.name, locale) }).slice(0, 60);
  const r = await window.allay.templates.copyBuiltin({ id: ref.id, version: ref.version, name });
  if (!r.ok) {
    failed(r.error);
    return null;
  }
  await useTemplateStore.getState().refresh();
  const cur = useProjectStore.getState();
  const params = cur.template && cur.template.ref.id === ref.id && cur.template.ref.version === ref.version ? cur.params : {};
  await selectTemplate(r.entry.id, r.entry.version, locale, params);
  notify('info', i18next.t('dev.copied'));
  return { id: r.entry.id, version: r.entry.version };
}

const key = (id: string) => `command.items.${id}`;

export const DEV_COMMANDS: AnyCommand[] = [
  defineCommand({
    id: 'openTemplateFolder',
    titleKey: key('openTemplateFolder'),
    icon: FolderUser,
    effect: 'read',
    input: RefInput,
    output: z.boolean(),
    enabled: currentIsUser,
    run: (input) => openTemplateFolder(input ?? currentRef()),
  }),
  defineCommand({
    id: 'copyBuiltinTemplate',
    titleKey: key('copyBuiltinTemplate'),
    icon: Copy,
    effect: 'write',
    undoLabelKey: 'history.template',
    input: RefInput,
    output: RefOutput,
    enabled: currentIsBuiltinScript,
    run: (input) => copyBuiltinTemplate(input ?? currentRef()),
  }),
];
