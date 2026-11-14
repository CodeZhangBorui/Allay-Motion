import { z } from 'zod';

// 快捷键的写法、保留键和冲突（docs/06-ui-design.md 6.7、6.11）。主进程（校验设置文件）和渲染进程（匹配按键、
// 设置页的录制）共用这一份；没有 React、没有 DOM，单元测试直接用。
//
// 写法：修饰键按 Ctrl、Alt、Shift 的顺序，最后是一个键名，用 + 连接，例如 'Ctrl+Shift+Z'、'Space'、'L'、'F5'、'Ctrl+,'。

/** 键名：字母、数字、F1–F24、标点，以及几个有名字的键 */
const NAMED_KEYS = ['Space', 'Home', 'End', 'PageUp', 'PageDown', 'Insert', 'Delete', 'Backspace', 'Enter', 'Tab', 'Esc', 'Up', 'Down', 'Left', 'Right'] as const;
const PUNCTUATION = [',', '.', '/', ';', "'", '[', ']', '\\', '-', '=', '`'] as const;
const MODIFIERS = ['Ctrl', 'Alt', 'Shift'] as const;

function isKeyName(k: string): boolean {
  return /^[A-Z0-9]$/.test(k) || /^F([1-9]|1\d|2[0-4])$/.test(k) || (NAMED_KEYS as readonly string[]).includes(k) || (PUNCTUATION as readonly string[]).includes(k);
}

/** 拆成修饰键和键名；写法不规范（顺序不对、重复、未知键）时返回 null */
export function parseShortcut(s: string): { ctrl: boolean; alt: boolean; shift: boolean; key: string } | null {
  if (s.length === 0 || s.length > 40) return null;
  // 键名本身可能是 '+' 以外的标点；按 '+' 切开时最后一段是键名
  const parts = s.split('+');
  const key = parts.pop() ?? '';
  if (!isKeyName(key)) return null;
  let last = -1;
  const mods = { ctrl: false, alt: false, shift: false };
  for (const p of parts) {
    const i = (MODIFIERS as readonly string[]).indexOf(p);
    if (i <= last) return null; // 未知、重复或顺序不对
    last = i;
    mods[p.toLowerCase() as 'ctrl' | 'alt' | 'shift'] = true;
  }
  return { ...mods, key };
}

export function isShortcut(s: string): boolean {
  return parseShortcut(s) !== null;
}

export const ShortcutSchema = z.string().refine(isShortcut, { message: 'not a shortcut' });
export const CommandIdSchema = z.string().regex(/^[A-Za-z][\w.-]{0,63}$/);

/** 设置里最多记多少条自定义 */
export const MAX_SHORTCUT_OVERRIDES = 256;

/** 自定义快捷键：命令 id → 新的按键；null 表示用户清除了这条命令的快捷键。没有列出的命令用默认值 */
export type ShortcutOverrides = Record<string, string | null>;

/** 渲染进程发来的修改：整张表替换，一条不合法就拒绝整个修改 */
export const ShortcutOverridesPatchSchema = z
  .record(CommandIdSchema, ShortcutSchema.refine((s) => reservedReason(s) === null, { message: 'reserved key' }).nullable())
  .refine((m) => Object.keys(m).length <= MAX_SHORTCUT_OVERRIDES, 'too many shortcut overrides');

/**
 * 从设置文件读：坏掉的条目各自丢掉（回到默认），整块不是对象时整块回到空表。其他设置不受影响。
 */
export function sanitizeShortcutOverrides(raw: unknown): ShortcutOverrides {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
  const out: ShortcutOverrides = {};
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    if (Object.keys(out).length >= MAX_SHORTCUT_OVERRIDES) break;
    if (!CommandIdSchema.safeParse(id).success) continue;
    if (value === null || (typeof value === 'string' && isShortcut(value) && reservedReason(value) === null)) out[id] = value;
  }
  return out;
}

// ---------------------------------------------------------------- 按键 → 写法

const CODE_NAMES: Record<string, string> = {
  Comma: ',',
  Period: '.',
  Slash: '/',
  Semicolon: ';',
  Quote: "'",
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Minus: '-',
  Equal: '=',
  Backquote: '`',
  Space: 'Space',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  Insert: 'Insert',
  Delete: 'Delete',
  Backspace: 'Backspace',
  Enter: 'Enter',
  NumpadEnter: 'Enter',
  Tab: 'Tab',
  Escape: 'Esc',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
};

export interface KeyLike {
  code: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

/** 按键 → 快捷键写法（按物理键位，和键盘布局、输入法无关）；单独的修饰键和认不出的键返回 null */
export function shortcutFromEvent(e: KeyLike): string | null {
  let k: string | undefined;
  if (/^Key[A-Z]$/.test(e.code)) k = e.code.slice(3);
  else if (/^Digit\d$/.test(e.code)) k = e.code.slice(5);
  else if (/^Numpad\d$/.test(e.code)) k = e.code.slice(6);
  else if (/^F([1-9]|1\d|2[0-4])$/.test(e.code)) k = e.code;
  else k = CODE_NAMES[e.code];
  if (!k) return null;
  return [e.ctrlKey || e.metaKey ? 'Ctrl' : '', e.altKey ? 'Alt' : '', e.shiftKey ? 'Shift' : '', k].filter(Boolean).join('+');
}

// ---------------------------------------------------------------- 保留键

export type ReservedReason = 'system' | 'text' | 'navigation';

/** 系统级的组合：Windows 自己处理，或者应用根本收不到 */
const SYSTEM = new Set(['Alt+F4', 'Alt+Tab', 'Alt+Shift+Tab', 'Alt+Esc', 'Alt+Space', 'Ctrl+Esc', 'Ctrl+Shift+Esc', 'Ctrl+Alt+Delete', 'F11', 'F12']);
/** 文本输入框必需的：全选、复制、粘贴、剪切、删除、确认、焦点移动、按词移动 */
const TEXT = new Set([
  'Ctrl+A',
  'Ctrl+C',
  'Ctrl+V',
  'Ctrl+X',
  'Ctrl+Shift+V',
  'Ctrl+Insert',
  'Shift+Insert',
  'Shift+Delete',
  'Backspace',
  'Ctrl+Backspace',
  'Delete',
  'Ctrl+Delete',
  'Enter',
  'Shift+Enter',
  'Tab',
  'Shift+Tab',
  'Esc',
  'Ctrl+Left',
  'Ctrl+Right',
  'Ctrl+Shift+Left',
  'Ctrl+Shift+Right',
]);
/** 方向键：逐帧、列表和滑块的键盘操作（不是命令，6.7） */
const NAVIGATION = new Set(['Left', 'Right', 'Up', 'Down', 'Shift+Left', 'Shift+Right', 'Shift+Up', 'Shift+Down']);

/** 不允许绑定的键及原因；可以绑定时返回 null */
export function reservedReason(s: string): ReservedReason | null {
  if (SYSTEM.has(s)) return 'system';
  if (TEXT.has(s)) return 'text';
  if (NAVIGATION.has(s)) return 'navigation';
  return null;
}

// ---------------------------------------------------------------- 生效的快捷键与冲突

export interface ShortcutCommand {
  id: string;
  /** 默认快捷键（命令定义里的 shortcut） */
  shortcut?: string;
}

/** 一条命令现在生效的快捷键：自定义优先（null 表示清除），否则默认值；没有时为 null */
export function effectiveShortcut(cmd: ShortcutCommand, overrides: ShortcutOverrides): string | null {
  if (Object.hasOwn(overrides, cmd.id)) return overrides[cmd.id] ?? null;
  return cmd.shortcut ?? null;
}

/**
 * 快捷键 → 命令 id。两条命令生效的键相同（只会出现在手改的设置文件里）时，按命令的先后取第一条，
 * 其余的记在 conflicts 里，设置页据此提示。
 */
export function resolveShortcuts(commands: readonly ShortcutCommand[], overrides: ShortcutOverrides): { byKey: Map<string, string>; conflicts: Set<string> } {
  const byKey = new Map<string, string>();
  const conflicts = new Set<string>();
  for (const cmd of commands) {
    const s = effectiveShortcut(cmd, overrides);
    if (!s) continue;
    const owner = byKey.get(s);
    if (owner) {
      conflicts.add(owner);
      conflicts.add(cmd.id);
    } else byKey.set(s, cmd.id);
  }
  return { byKey, conflicts };
}

/** 给 id 绑上 key 时会和哪条命令冲突（同一条命令不算） */
export function conflictFor(commands: readonly ShortcutCommand[], overrides: ShortcutOverrides, id: string, key: string): string | null {
  for (const cmd of commands) if (cmd.id !== id && effectiveShortcut(cmd, overrides) === key) return cmd.id;
  return null;
}

/**
 * 绑定：给 id 设 key。和别的命令冲突时，replace 为真就把那条命令清除（记成 null），否则不改、返回冲突的命令。
 * key 等于默认值时去掉自定义（表保持最短）。
 */
export function bindShortcut(
  commands: readonly ShortcutCommand[],
  overrides: ShortcutOverrides,
  id: string,
  key: string,
  replace: boolean,
): { ok: true; overrides: ShortcutOverrides } | { ok: false; conflict: string } | { ok: false; reserved: ReservedReason } {
  const reserved = reservedReason(key);
  if (reserved) return { ok: false, reserved };
  const conflict = conflictFor(commands, overrides, id, key);
  if (conflict && !replace) return { ok: false, conflict };
  let next = setOverride(commands, overrides, id, key);
  if (conflict) next = setOverride(commands, next, conflict, null);
  return { ok: true, overrides: next };
}

/** 设一条命令的快捷键（null 为清除）；等于默认值时去掉这条自定义 */
export function setOverride(commands: readonly ShortcutCommand[], overrides: ShortcutOverrides, id: string, key: string | null): ShortcutOverrides {
  const next = { ...overrides };
  const def = commands.find((c) => c.id === id)?.shortcut ?? null;
  if (key === def) delete next[id];
  else next[id] = key;
  return next;
}

/** 恢复一条命令的默认快捷键。默认键已被别的命令占用时，那条命令被清除（返回它的 id） */
export function resetShortcut(commands: readonly ShortcutCommand[], overrides: ShortcutOverrides, id: string): { overrides: ShortcutOverrides; cleared: string | null } {
  const next = { ...overrides };
  delete next[id];
  const def = commands.find((c) => c.id === id)?.shortcut;
  if (!def) return { overrides: next, cleared: null };
  const conflict = conflictFor(commands, next, id, def);
  return conflict ? { overrides: setOverride(commands, next, conflict, null), cleared: conflict } : { overrides: next, cleared: null };
}
