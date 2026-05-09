import { defineStore } from "pinia";
import { ref } from "vue";

export interface ToastItem {
  id: number;
  message: string;
  type: "error" | "info";
}

let nextId = 0;

export const useToastStore = defineStore("toast", () => {
  const items = ref<ToastItem[]>([]);

  function show(message: string, type: ToastItem["type"] = "error") {
    const id = nextId++;
    items.value = [...items.value, { id, message, type }];
    setTimeout(() => dismiss(id), 4000);
  }

  function dismiss(id: number) {
    items.value = items.value.filter((t) => t.id !== id);
  }

  return { items, show, dismiss };
});
