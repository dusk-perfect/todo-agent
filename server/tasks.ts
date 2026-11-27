import { Router, type Request } from "express";
import { z } from "zod";
import type { TaskStore } from "./task-store.ts";

const createTaskSchema = z.strictObject({ title: z.string().trim().min(1).max(200) });
const updateTaskSchema = createTaskSchema
  .partial()
  .extend({ done: z.boolean().optional() })
  .refine((changes) => Object.keys(changes).length > 0);

const taskNotFound = { error: "找不到这条任务。" };

// 既能接单个 store（单用户、测试），也能按请求解析出对应用户的 store
export function taskRouter(source: TaskStore | ((request: Request) => TaskStore)) {
  const storeOf = typeof source === "function" ? source : () => source;
  const router = Router();

  router.get("/", (req, res) => {
    res.json(storeOf(req).list());
  });

  router.post("/", (req, res) => {
    const input = createTaskSchema.safeParse(req.body);
    if (!input.success) {
      return res.status(400).json({ error: "请提供 1 至 200 个字符的任务标题。" });
    }
    res.status(201).json(storeOf(req).create(input.data.title));
  });

  router.patch("/:id", (req, res) => {
    const input = updateTaskSchema.safeParse(req.body);
    if (!input.success) {
      return res.status(400).json({ error: "请提供有效的 title 或 done 字段。" });
    }

    const updated = storeOf(req).update(req.params.id, input.data);
    if (!updated) return res.status(404).json(taskNotFound);
    res.json(updated);
  });

  router.delete("/:id", (req, res) => {
    if (!storeOf(req).remove(req.params.id)) return res.status(404).json(taskNotFound);
    res.sendStatus(204);
  });

  return router;
}
