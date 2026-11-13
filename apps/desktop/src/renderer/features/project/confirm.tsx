import { Button } from '@allay/ui/components/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '@allay/ui/components/dialog';
import { useTranslation } from 'react-i18next';
import { create } from 'zustand';

// 一个简单的确认对话框（未保存的改动等）。askConfirm 返回用户的选择。

interface ConfirmRequest {
  title: string;
  body: string;
  confirm: string;
  resolve(ok: boolean): void;
}

const useConfirmStore = create<{ request: ConfirmRequest | null }>(() => ({ request: null }));

export function askConfirm(opts: Omit<ConfirmRequest, 'resolve'>): Promise<boolean> {
  return new Promise((resolve) => {
    useConfirmStore.getState().request?.resolve(false);
    useConfirmStore.setState({ request: { ...opts, resolve } });
  });
}

function answer(ok: boolean) {
  const r = useConfirmStore.getState().request;
  useConfirmStore.setState({ request: null });
  r?.resolve(ok);
}

export function ConfirmHost() {
  const { t } = useTranslation();
  const request = useConfirmStore((s) => s.request);
  if (!request) return null;
  return (
    <Dialog open onOpenChange={(open) => !open && answer(false)}>
      <DialogContent closeLabel={t('common.close')} data-testid="confirm-dialog">
        <DialogTitle>{request.title}</DialogTitle>
        <DialogDescription>{request.body}</DialogDescription>
        <DialogFooter>
          <Button variant="secondary" size="lg" onClick={() => answer(false)}>
            {t('common.cancel')}
          </Button>
          <Button variant="destructive" size="lg" data-testid="confirm-ok" onClick={() => answer(true)}>
            {request.confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
