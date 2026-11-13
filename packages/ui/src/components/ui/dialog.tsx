import { Dialog as DialogPrimitive } from '@base-ui/react/dialog';
import { cn } from 'cn';
import { X } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';

// shadcn 的 Dialog（Base UI）：圆角 12、对话框阴影加 1 px 边框（6.2）；出现用 --dur-3 的淡入加轻微缩放。

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
      <DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-black/50 transition-opacity duration-(--dur-3) data-[ending-style]:opacity-0 data-[starting-style]:opacity-0" />
      <DialogPrimitive.Popup
        data-slot="dialog-content"
        className={cn(
          'fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100vh-48px)] w-[440px] max-w-[calc(100vw-48px)] -translate-x-1/2 -translate-y-1/2 flex-col gap-4 rounded-xl border bg-surface-2 p-5 text-sm shadow-(--shadow-dialog) outline-none',
          'transition-[opacity,scale] duration-(--dur-3) ease-(--ease-out) data-[ending-style]:scale-[.98] data-[ending-style]:opacity-0 data-[starting-style]:scale-[.98] data-[starting-style]:opacity-0',
          className,
        )}
        {...props}
      >
        {children}
        {showClose && (
          <DialogPrimitive.Close
            aria-label={closeLabel}
            className="absolute top-3 right-3 inline-flex size-7 items-center justify-center rounded-md text-fg-muted hover:bg-surface-3 hover:text-foreground"
          >
            <X className="size-4" />
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
