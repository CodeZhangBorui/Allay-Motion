import type { ComponentType } from 'react';
import type { z } from 'zod';
import { create } from 'zustand';
import { withOrigin, type UndoOrigin } from '../stores/projectStore';

// 界面注册表（docs/code-editing-and-mcp-plan.md H1、H2；docs/decisions.md 界面重设计）。
// 界面从这里读取有哪些标签页/面板、菜单项、命令来渲染；核心功能自己也通过同一组接口注册（core.tsx）。
// 可选模块只能经这里接入：调用 register* 挂上自己的面板和命令，删掉模块时主界面的代码一行不用改。
// 每个 register* 返回一个注销函数。

// ---------------------------------------------------------------- 命令

/** 命令对工程的影响：只读、可撤销的修改、不可撤销的（删除、覆盖文件等） */
export type CommandEffect = 'read' | 'write' | 'destructive';

export interface CommandDef<I = void, O = void> {
  id: string;
  /** 标题的文案键（命令面板、菜单、快捷键表都用它） */
  titleKey: string;
  /** 显示用的快捷键（如 'Ctrl+Shift+Z'、'Space'、'L'）；快捷键处理也按它匹配 */
  shortcut?: string;
  /** 带参数的命令：参数的 schema（dispatcher 先校验再执行）；没有参数的命令不写 */
  input?: z.ZodType<I>;
  /** 有返回值的命令：返回值的 schema */
  output?: z.ZodType<O>;
  effect: CommandEffect;
  /** effect 为 write 时，撤销记录上显示的文案键（缺省用 titleKey） */
  undoLabelKey?: string;
  /** 不在命令面板里列出（例如“打开命令面板”自己） */
  hideInPalette?: boolean;
  enabled?(): boolean;
  run(input: I): O | Promise<O>;
}

/** 注册表里存的是擦除了参数类型的命令 */
export type AnyCommand = CommandDef<never, unknown>;

export class CommandError extends Error {
  constructor(
    readonly code: 'unknown-command' | 'disabled' | 'invalid-input' | 'invalid-output',
    message: string,
  ) {
    super(message);
  }
}

// ---------------------------------------------------------------- 面板与标签页

/** left / right 是左右面板的标签页；dock 是主区里可停靠的额外面板 */
export type PanelRegion = 'left' | 'right' | 'dock';

export interface PanelDef {
  id: string;
  titleKey: string;
  region: PanelRegion;
  /** 同一区域里的先后（小的在前） */
  order: number;
  component: ComponentType;
  /** 这个标签页激活时，放在面板标题行右侧的操作（可选） */
  actions?: ComponentType;
  testId?: string;
}

// ---------------------------------------------------------------- 菜单项

export type MenuId = 'file' | 'edit' | 'view' | 'help';

export interface MenuItemDef {
  id: string;
  menu: MenuId;
  /** 同一菜单里的分组（组之间画分隔线）与组内先后 */
  group: number;
  order: number;
  /** 执行哪个命令；标题和快捷键取自命令 */
  command?: string;
  /** 覆盖命令的标题（菜单里的说法和命令面板不同时） */
  titleKey?: string;
  /** 执行命令时带的参数（经 dispatch 校验） */
  input?: unknown;
  /** 不是一个命令的菜单项（子菜单、单选组）：直接给组件 */
  component?: ComponentType;
  testId?: string;
}

// ---------------------------------------------------------------- 存储与接口

interface RegistryState {
  commands: Record<string, AnyCommand>;
  panels: Record<string, PanelDef>;
  menuItems: Record<string, MenuItemDef>;
}

export const useRegistry = create<RegistryState>(() => ({ commands: {}, panels: {}, menuItems: {} }));

function add<K extends keyof RegistryState>(kind: K, id: string, value: RegistryState[K][string]): () => void {
  const state = useRegistry.getState();
  if (state[kind][id]) throw new Error(`${kind} “${id}” is already registered`);
  useRegistry.setState({ [kind]: { ...state[kind], [id]: value } } as Partial<RegistryState>);
  return () => {
    const cur = useRegistry.getState()[kind];
    if (cur[id] !== value) return;
    const next = { ...cur };
    delete next[id];
    useRegistry.setState({ [kind]: next } as Partial<RegistryState>);
  };
}

/** 把带具体参数类型的命令定义放进一张表里（类型在定义处检查，表里擦除） */
export function defineCommand<I = void, O = void>(def: CommandDef<I, O>): AnyCommand {
  return def as unknown as AnyCommand;
}

export function registerCommand<I, O>(def: CommandDef<I, O>): () => void {
  return add('commands', def.id, def as unknown as AnyCommand);
}

export function registerPanel(def: PanelDef): () => void {
  return add('panels', def.id, def);
}

export function registerMenuItem(def: MenuItemDef): () => void {
  return add('menuItems', def.id, def);
}

export function getCommand(id: string): AnyCommand | undefined {
  return useRegistry.getState().commands[id];
}

export function commandEnabled(cmd: AnyCommand): boolean {
  return !cmd.enabled || cmd.enabled();
}

export interface DispatchOptions {
  /** 谁发起的（写进撤销记录的来源，H6）：缺省是 command（菜单、快捷键、命令面板） */
  source?: UndoOrigin['source'];
}

/**
 * 执行命令的唯一入口（命令面板、快捷键、菜单、主进程的命令通道、可选模块都经它）：找命令、看可用条件、
 * 带参数的先过 zod 校验，有 output schema 的再校验返回值。write 命令同步产生的改动在撤销记录上标明命令和来源。
 */
export async function dispatch(id: string, input?: unknown, options: DispatchOptions = {}): Promise<unknown> {
  const cmd = getCommand(id);
  if (!cmd) throw new CommandError('unknown-command', `unknown command: ${id}`);
  if (!commandEnabled(cmd)) throw new CommandError('disabled', `command is not available now: ${id}`);
  let arg: unknown = undefined;
  if (cmd.input) {
    const parsed = cmd.input.safeParse(input);
    if (!parsed.success) throw new CommandError('invalid-input', `invalid input for ${id}: ${parsed.error.message}`);
    arg = parsed.data;
  }
  const run = () => (cmd.run as (i: unknown) => unknown)(arg);
  const out = await (cmd.effect === 'write' ? withOrigin({ labelKey: cmd.undoLabelKey ?? cmd.titleKey, source: options.source ?? 'command' }, run) : run());
  if (cmd.output) {
    const parsed = cmd.output.safeParse(out);
    if (!parsed.success) throw new CommandError('invalid-output', `invalid output from ${id}: ${parsed.error.message}`);
    return parsed.data;
  }
  return out;
}

/** 界面上的触发（菜单、按钮、快捷键）：不关心返回值，出错只记日志 */
export function trigger(id: string, input?: unknown): void {
  dispatch(id, input).catch((error: unknown) => {
    if (error instanceof CommandError && error.code === 'disabled') return;
    console.error(`[command] ${id}`, error);
  });
}

// ---------------------------------------------------------------- 读取（界面用）

const byOrder = <T extends { order: number; id: string }>(a: T, b: T) => a.order - b.order || a.id.localeCompare(b.id);

export function sortedPanels(panels: Record<string, PanelDef>, region: PanelRegion): PanelDef[] {
  return Object.values(panels)
    .filter((p) => p.region === region)
    .sort(byOrder);
}

export function usePanels(region: PanelRegion): PanelDef[] {
  const panels = useRegistry((s) => s.panels);
  return sortedPanels(panels, region);
}

/** 一个菜单的各组（按 group 分组、组内按 order 排序） */
export function useMenuGroups(menu: MenuId): MenuItemDef[][] {
  const items = useRegistry((s) => s.menuItems);
  const list = Object.values(items)
    .filter((m) => m.menu === menu)
    .sort((a, b) => a.group - b.group || byOrder(a, b));
  const groups: MenuItemDef[][] = [];
  for (const m of list) {
    const last = groups.at(-1);
    if (last && last[0]!.group === m.group) last.push(m);
    else groups.push([m]);
  }
  return groups;
}

/** 全部命令，按注册顺序 */
export function useCommands(): AnyCommand[] {
  const commands = useRegistry((s) => s.commands);
  return Object.values(commands);
}
