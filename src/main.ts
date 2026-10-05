import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import { router } from "./ui/router";
import "./ui/styles/tokens.css";
import "./ui/styles/base.css";

const app = createApp(App);
app.use(createPinia());
app.use(router);
app.mount("#app");
