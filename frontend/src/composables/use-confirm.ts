import { ref } from "vue";

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  confirmVariant?: "primary" | "danger";
  cancelLabel?: string;
}

interface PendingConfirm {
  options: ConfirmOptions;
  resolve: (confirmed: boolean) => void;
}

const pending = ref<PendingConfirm | null>(null);

export function useConfirm() {
  function confirm(opts: ConfirmOptions): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      pending.value = { options: opts, resolve };
    });
  }

  function handleConfirm() {
    pending.value?.resolve(true);
    pending.value = null;
  }

  function handleClose() {
    pending.value?.resolve(false);
    pending.value = null;
  }

  return { pending, confirm, handleConfirm, handleClose };
}
