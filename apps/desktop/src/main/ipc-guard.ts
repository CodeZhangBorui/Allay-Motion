import { isTrustedPageUrl } from './security-policy';

// 1.6 第 5 条：每个 IPC 调用都要确认来自主窗口的主框架。纯逻辑，便于单元测试。
// 2026-11 起多一个代码窗口：它只能调 CODE_WINDOW_CHANNELS 里的通道（同样要求来自它自己的主框架、页面是应用的页面），
// 其余通道只认主窗口；只给代码窗口用的通道（CODE_WINDOW_ONLY）反过来不收主窗口的调用。

export interface FrameLike {
  readonly url: string;
}

export interface SenderEventLike {
  readonly sender: unknown;
  readonly senderFrame: FrameLike | null;
}

export interface MainWindowLike {
  readonly webContents: unknown;
  readonly mainFrame: FrameLike;
}

export type SenderCheck = { ok: true } | { ok: false; reason: string };

export function checkSender(event: SenderEventLike, main: MainWindowLike | null, devOrigin: string | null): SenderCheck {
  if (!main) return { ok: false, reason: 'no main window' };
  if (event.sender !== main.webContents) return { ok: false, reason: 'sender is not the main window' };
  const frame = event.senderFrame;
  if (!frame) return { ok: false, reason: 'sender frame is gone' };
  if (frame !== main.mainFrame) return { ok: false, reason: 'sender is not the main frame' };
  if (!isTrustedPageUrl(frame.url, devOrigin)) return { ok: false, reason: 'sender page is not the app' };
  return { ok: true };
}

/**
 * 代码窗口能调的通道：只有交回消息这一个（它的页面不调别的 IPC）。其余一律拒绝（docs/decisions.md“动画编辑器的第二轮反馈”）。
 * codeWindow:send 同时也只收代码窗口的调用。
 */
export const CODE_WINDOW_CHANNELS: ReadonlySet<string> = new Set(['codeWindow:send']);
/** 只收代码窗口的调用的通道 */
export const CODE_WINDOW_ONLY: ReadonlySet<string> = new Set(['codeWindow:send']);
/** 代码窗口的页面（应用自己的 origin 下，路径必须正好是它） */
export const CODE_WINDOW_PATH = '/code.html';

/** 应用自己创建的那个代码窗口：创建时按 webContents id 登记，关闭时注销（code-window.ts） */
export interface RegisteredWindowLike extends MainWindowLike {
  /** 登记的 webContents id */
  readonly id: number;
}

function senderId(event: SenderEventLike): number | null {
  const id = (event.sender as { id?: unknown } | null)?.id;
  return typeof id === 'number' ? id : null;
}

/**
 * 代码窗口的来源：必须是登记过的那个 webContents（对象相同、id 相同），来自它的主框架，页面是应用 origin 下的 code.html。
 * 不按 URL 前缀放行：别的窗口即使加载了同一个页面也不算。
 */
export function checkCodeWindowSender(event: SenderEventLike, code: RegisteredWindowLike | null, devOrigin: string | null): SenderCheck {
  if (!code) return { ok: false, reason: 'no code window' };
  if (senderId(event) !== code.id) return { ok: false, reason: 'sender is not the registered code window' };
  const base = checkSender(event, code, devOrigin);
  if (!base.ok) return base;
  try {
    if (new URL(event.senderFrame!.url).pathname !== CODE_WINDOW_PATH) return { ok: false, reason: 'sender page is not the code window page' };
  } catch {
    return { ok: false, reason: 'sender page is not the code window page' };
  }
  return { ok: true };
}

/**
 * 按通道判断来源：主窗口可以调除 CODE_WINDOW_ONLY 以外的全部通道；登记过的代码窗口只能调 CODE_WINDOW_CHANNELS。
 */
export function checkSenderFor(channel: string, event: SenderEventLike, main: MainWindowLike | null, code: RegisteredWindowLike | null, devOrigin: string | null): SenderCheck {
  const fromMain = checkSender(event, main, devOrigin);
  if (fromMain.ok) return CODE_WINDOW_ONLY.has(channel) ? { ok: false, reason: 'channel is only for the code window' } : fromMain;
  if (!code || !CODE_WINDOW_CHANNELS.has(channel)) return fromMain;
  const fromCode = checkCodeWindowSender(event, code, devOrigin);
  return fromCode.ok ? fromCode : fromMain;
}
