import { createElement } from 'react';
import { toast } from 'sonner';

// 通知（Sonner，6.5）。同一时刻只保留一条：新的替换旧的（同一个 toast id），
// 结果一眼能看清，测试也不用猜是第几条。错误通知用 role="alert"。

export interface Notice {
  kind: 'info' | 'error';
  /** 已经翻译好的文字 */
  text: string;
}

const NOTICE_ID = 'notice';

function NoticeToast({ kind, text }: Notice) {
  return createElement(
    'div',
    {
      role: kind === 'error' ? 'alert' : 'status',
      'data-testid': 'notice',
      'data-kind': kind,
      className: `w-[min(420px,calc(100vw-32px))] rounded-lg border bg-surface-2 px-3 py-2 text-sm shadow-(--shadow-popover) ${kind === 'error' ? 'text-danger' : ''}`,
    },
    text,
  );
}

export const useNoticeStore = {
  getState: () => ({
    show(kind: Notice['kind'], text: string): void {
      toast.custom(() => createElement(NoticeToast, { kind, text }), { id: NOTICE_ID, duration: 6000 });
    },
    dismiss(): void {
      toast.dismiss(NOTICE_ID);
    },
  }),
};

export function notify(kind: Notice['kind'], text: string): void {
  useNoticeStore.getState().show(kind, text);
}
