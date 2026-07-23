import { X } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { Button } from "@/components/ui/button";

interface TrainingVideoDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dontShowAgain: boolean;
  onDontShowAgainChange: (checked: boolean) => void;
  videoSrc: string;
}

export function TrainingVideoDialog({
  open,
  onOpenChange,
  dontShowAgain,
  onDontShowAgainChange,
  videoSrc,
}: TrainingVideoDialogProps) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/45 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content className="fixed left-1/2 top-1/2 z-50 grid h-[90vh] w-[90vw] max-w-none grid-rows-[auto_minmax(0,1fr)_auto] -translate-x-1/2 -translate-y-1/2 gap-4 overflow-hidden rounded-lg border bg-popover p-5 text-popover-foreground shadow-lg data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1">
              <DialogPrimitive.Title className="text-lg font-semibold">
                How to use the Policy Printer Dialer
              </DialogPrimitive.Title>
              <DialogPrimitive.Description className="text-sm text-muted-foreground">
                Watch this short walkthrough before taking calls.
              </DialogPrimitive.Description>
            </div>
            <DialogPrimitive.Close asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-8 shrink-0"
                aria-label="Close training video"
              >
                <X className="size-4" />
              </Button>
            </DialogPrimitive.Close>
          </div>

          <div className="relative min-h-0 overflow-hidden rounded-lg border bg-black">
            <iframe
              src={videoSrc}
              title="Policy Printer Dialer training video"
              frameBorder="0"
              allowFullScreen
              className="absolute inset-0 size-full"
            />
          </div>

          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={dontShowAgain}
                onChange={(event) =>
                  onDontShowAgainChange(event.currentTarget.checked)
                }
                className="size-4 rounded border-input accent-primary"
              />
              Don&apos;t show me this again
            </label>
            <DialogPrimitive.Close asChild>
              <Button type="button">Continue</Button>
            </DialogPrimitive.Close>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
