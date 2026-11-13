import { isTrustedPageUrl } from './security-policy';

// 1.6 第 5 条：每个 IPC 调用都要确认来自主窗口的主框架。纯逻辑，便于单元测试。

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
