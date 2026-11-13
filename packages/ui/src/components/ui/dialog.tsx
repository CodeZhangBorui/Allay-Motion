import { Dialog as DialogPrimitive } from '@base-ui/react/dialog';
import { X } from '@phosphor-icons/react';
import { cn } from 'cn';
import type { ComponentProps, ReactNode } from 'react';
import { ICON } from '../../lib/icons';

// shadcn 的 Dialog（Base UI）：浮起的面板，圆角 10、对话框阴影、无描边（6.2）；出现用 --dur-2 的淡入。

const Dialog = DialogPrimitive.Root;
const DialogTrigger = DialogPrimitive.Trigger;
const DialogClose = DialogPrimitive.Close;

function DialogContent({
  className,
  children,
  showClose = true,
  closeLabel,
  ...props
}: DialogPrimitive.Popup.Props & { showClose?: boolean; closeLabel?: string; children?: ReactNode }) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-scrim transition-opacity duration-(--dur-2) data-[ending-style]:opacity-0 data-[starting-style]:opacity-0" />
      <DialogPrimitive.Popup
        data-slot="dialog-content"
        className={cn(
          'fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100vh-48px)] w-[440px] max-w-[calc(100vw-48px)] -translate-x-1/2 -translate-y-1/2 flex-col gap-4 rounded-xl bg-surface-2 p-5 text-sm shadow-dialog outline-none',
          'transition-opacity duration-(--dur-2) ease-(--ease-out) data-[ending-style]:opacity-0 data-[starting-style]:opacity-0',
          className,
        )}
        {...props}
      >
        {children}
        {showClose && (
          <DialogPrimitive.Close
            aria-label={closeLabel}
            className="absolute top-3.5 right-3.5 inline-flex size-7 items-center justify-center rounded-md text-fg-subtle hover:bg-control hover:text-foreground"
          >
            <X size={ICON.sm} />
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Popup>
    </DialogPrimitive.Portal>
  );
}

function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return <DialogPrimitive.Title className={cn('pr-8 text-lg leading-tight font-semibold', className)} {...props} />;
}

function DialogDescription({ className, ...props }: DialogPrimitive.Description.Props) {
  return <DialogPrimitive.Description className={cn('text-sm text-fg-muted', className)} {...props} />;
}

function DialogFooter({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('mt-1 flex justify-end gap-2', className)} {...props} />;
}

export { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogTitle, DialogTrigger };
