import { useEffect } from 'react';
import { useNoticeStore } from '../stores/noticeStore';

// 窗口底部的临时提示：6 秒后自己消失。

export function NoticeBar() {
  const notice = useNoticeStore((s) => s.notice);
  useEffect(() => {
    if (!notice) return;
    const id = notice.id;
    const timer = setTimeout(() => useNoticeStore.getState().dismiss(id), 6000);
    return () => clearTimeout(timer);
  }, [notice]);
  if (!notice) return null;
  return (
    <div
      role={notice.kind === 'error' ? 'alert' : 'status'}
      data-testid="notice"
      data-kind={notice.kind}
      className={`fixed bottom-16 left-1/2 z-50 max-w-[560px] -translate-x-1/2 rounded-md border bg-surface-2 px-3 py-2 text-sm shadow-lg ${notice.kind === 'error' ? 'text-danger' : ''}`}
    >
      {notice.text}
    </div>
  );
}
