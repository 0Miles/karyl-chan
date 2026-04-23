import { createApp } from 'vue';
import App from './App.vue';
import { router } from './router';
import './styles/global.css';
import 'vue-virtual-scroller/dist/vue-virtual-scroller.css';

createApp(App).use(router).mount('#app');
