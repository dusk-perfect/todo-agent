import { join } from "node:path";
import { createJsonTaskStore, type TaskStore } from "./task-store.ts";

// 匿名身份：前端首次打开生成一个 id 存在浏览器，服务端按它分目录。
// 请求没带 id 时（curl、评测脚本、刷新前的老页面）一律落到 default，行为与单用户时一致。
export const DEFAULT_USER = "default";
const USER_ID_RE = /^[a-zA-Z0-9_-]{1,40}$/;

export function normalizeUserId(raw: unknown): string {
  if (typeof raw !== "string") return DEFAULT_USER;
  const value = raw.trim();
  return USER_ID_RE.test(value) ? value : DEFAULT_USER;
}

export interface UserStores {
  tasks(userId: string): TaskStore;
  directory(userId: string): string;
}

export function createUserStores(root = "data"): UserStores {
  const cache = new Map<string, TaskStore>();

  function directory(userId: string): string {
    // default 继续用 data/tasks.json，老数据不用搬家
    return userId === DEFAULT_USER ? root : join(root, "users", userId);
  }

  return {
    directory,
    tasks(userId) {
      const cached = cache.get(userId);
      if (cached) return cached;
      const store = createJsonTaskStore(join(directory(userId), "tasks.json"));
      cache.set(userId, store);
      return store;
    },
  };
}
