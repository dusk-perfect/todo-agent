import { resolve } from "node:path";
import express, { type ErrorRequestHandler, type Request } from "express";
import { chatRequestSchema, type ChatMessage } from "../shared/chat.ts";
import type { TaskStore } from "./task-store.ts";
import { taskRouter } from "./tasks.ts";
import { buildReminders } from "./reminders.ts";
import { normalizeSessionId, type ConversationStore } from "./conversations.ts";
import { normalizeUserId } from "./users.ts";

interface AppDependencies {
  reply(messages: ChatMessage[], tasks: TaskStore): Promise<string>;
  tasks: TaskStore;
  /** 按匿名用户 id 取各自的清单；不传时所有人都用同一个 tasks（单用户模式） */
  storeFor?(userId: string): TaskStore;
  /** 对话落盘；不传时对话只活在请求里，不持久化 */
  conversations?: ConversationStore;
}

export function createApp({ reply, tasks, storeFor, conversations }: AppDependencies) {
  const app = express();
  app.use(express.json({ limit: "1mb" }));

  const storeOf = (request: Request): TaskStore =>
    storeFor ? storeFor(normalizeUserId(request.get("x-user-id"))) : tasks;

  app.post("/api/chat", async (request, response) => {
    const input = chatRequestSchema.safeParse(request.body);
    if (!input.success) {
      return response.status(400).json({ error: "请提供对话记录，并以用户消息结尾。" });
    }

    const userId = normalizeUserId(request.get("x-user-id"));
    const sessionId = normalizeSessionId(request.get("x-session-id"));
    const messages = input.data.messages;

    // 先把用户这句落盘，模型挂了也不丢
    if (sessionId && conversations) conversations.save(userId, sessionId, messages);

    const answer = await reply(messages, storeFor ? storeFor(userId) : tasks);

    if (sessionId && conversations) {
      conversations.save(userId, sessionId, [...messages, { role: "assistant", content: answer }]);
    }
    response.json({ reply: answer });
  });

  // 刷新页面后从这里把最近若干轮捞回来
  app.get("/api/conversations/:sessionId", (request, response) => {
    const sessionId = normalizeSessionId(request.params.sessionId);
    if (!sessionId || !conversations) return response.json({ messages: [] });

    const userId = normalizeUserId(request.get("x-user-id"));
    response.json({ messages: conversations.recent(userId, sessionId) });
  });

  app.delete("/api/conversations/:sessionId", (request, response) => {
    const sessionId = normalizeSessionId(request.params.sessionId);
    if (sessionId && conversations) {
      conversations.clear(normalizeUserId(request.get("x-user-id")), sessionId);
    }
    response.sendStatus(204);
  });

  // 提醒条和浏览器通知的数据源：逾期、今天、一小时内到点
  app.get("/api/reminders", (request, response) => {
    response.json(buildReminders(storeOf(request).list()));
  });

  app.use(
    "/api/tasks",
    taskRouter((request) => storeOf(request)),
  );
  app.use("/api", (_req, res) => res.status(404).json({ error: "接口不存在。" }));
  app.use(handleApiError);

  app.use(express.static(resolve("public")));
  app.get("/assets/chat.js", (_req, res) => res.sendFile(resolve("dist/chat.js")));
  return app;
}

const handleApiError: ErrorRequestHandler = (error, _req, res, _next) => {
  if (error.type === "entity.parse.failed") {
    return res.status(400).json({ error: "请求需要使用有效的 JSON。" });
  }
  if (error.type === "entity.too.large") {
    return res.status(413).json({ error: "对话太长，请刷新后开始新的对话。" });
  }
  console.error(error);
  res.status(500).json({ error: "服务暂时无法处理请求，请稍后重试。" });
};
