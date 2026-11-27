import { join } from "node:path";
import { reply } from "./agent.ts";
import { createApp } from "./app.ts";
import { createJsonTaskStore } from "./task-store.ts";

// 数据文件位置可覆盖：演示或联调时指到临时路径，就不会写进真实清单
const tasks = createJsonTaskStore(process.env.TASKS_FILE || join("data", "tasks.json"));
const app = createApp({ reply, tasks });
const port = Number(process.env.PORT || 3000);
app.listen(port, "127.0.0.1", () => console.log(`小明智能体已启动：http://127.0.0.1:${port}`));
