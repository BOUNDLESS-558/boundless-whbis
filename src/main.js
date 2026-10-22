import {
	createSSRApp
} from "vue";
import App from "./App.vue";
import { applyAmapConfig } from "./config.js";

// 页面渲染前把用户自定义高德 Key（BYOK）注入 uni-app 运行时配置，
// 使 <map> 组件用用户的 Key 加载高德 SDK；未配置时保持内置 Key
applyAmapConfig();

export function createApp() {
	const app = createSSRApp(App);
	return {
		app,
	};
}
