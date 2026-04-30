import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import { router } from "./router";
import { i18n } from "./i18n";
import "./styles/global.css";
import "./composables/use-drawer.css";
import "./composables/use-popover.css";
import "vue-virtual-scroller/dist/vue-virtual-scroller.css";

createApp(App).use(createPinia()).use(router).use(i18n).mount("#app");
