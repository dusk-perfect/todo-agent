import { reply } from "./agent.ts";
import { createApp } from "./app.ts";
import { createConversationStore } from "./conversations.ts";
import { createJsonTaskStore } from "./task-store.ts";
import { createUserStores, DEFAULT_USER } from "./users.ts";

// 数据根目录可用 DATA_DIR 覆盖；演示或联调时指到临时目录，就不会写进真实清单。
// TASKS_FILE 只影响 default 用户，保留它是为了方便单用户场景做隔离验证。
const root = process.env.DATA_DIR || "data";
const stores = createUserStores(root);
const defaultTasks = process.env.TASKS_FILE
  ? createJsonTaskStore(process.env.TASKS_FILE)
  : stores.tasks(DEFAULT_USER);

const app = createApp({
  reply,
  tasks: defaultTasks,
  storeFor: (userId) => (userId === DEFAULT_USER ? defaultTasks : stores.tasks(userId)),
  conversations: createConversationStore(root),
});

const port = Number(process.env.PORT || 3000);
app.listen(port, "127.0.0.1", () => console.log(`小明智能体已启动：http://127.0.0.1:${port}`));
