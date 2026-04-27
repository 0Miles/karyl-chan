import { describe, it, expect, vi, beforeEach } from "vitest";
import { nextTick, computed, defineComponent } from "vue";
import { mount, flushPromises } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";

vi.mock("../api/discord", () => ({
  fetchUserSummaries: vi.fn(),
}));

import { fetchUserSummaries } from "../api/discord";
import { useUserSummaries } from "./use-user-summaries";
import { useUserSummaryStore } from "../modules/discord-chat/stores/userSummaryStore";

const mockFetch = vi.mocked(fetchUserSummaries);

interface AdminLike {
  userId: string;
  role: string;
}

const RealisticComponent = defineComponent({
  template:
    '<div><span v-for="a in admins" :key="a.userId" class="name">{{ display(a.userId) }}</span></div>',
  props: {
    admins: { type: Array as () => AdminLike[], required: true },
  },
  setup(props) {
    const store = useUserSummaryStore();
    const userIds = computed(() => props.admins.map((a) => a.userId));
    useUserSummaries(userIds);
    function display(id: string): string {
      return store.getDisplayName(id) ?? `[${id}]`;
    }
    return { display };
  },
});

describe("useUserSummaries reactivity (Pinia store)", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    mockFetch.mockReset();
  });

  it("updates display name after props.admins changes from empty to populated", async () => {
    mockFetch.mockResolvedValue({
      id1: {
        id: "id1",
        username: "alice",
        globalName: "Alice",
        avatarUrl: "",
        bot: false,
      },
      id2: {
        id: "id2",
        username: "bob",
        globalName: null,
        avatarUrl: "",
        bot: false,
      },
    });

    const wrapper = mount(RealisticComponent, {
      props: { admins: [] },
      global: { plugins: [createPinia()] },
    });
    expect(wrapper.findAll(".name").length).toBe(0);
    expect(mockFetch).not.toHaveBeenCalled();

    await wrapper.setProps({
      admins: [
        { userId: "id1", role: "admin" },
        { userId: "id2", role: "admin" },
      ],
    });

    expect(wrapper.findAll(".name").map((el) => el.text())).toEqual([
      "[id1]",
      "[id2]",
    ]);
    expect(mockFetch).toHaveBeenCalledWith(["id1", "id2"]);

    await flushPromises();
    await nextTick();

    expect(wrapper.findAll(".name").map((el) => el.text())).toEqual([
      "Alice",
      "bob",
    ]);
  });
});
