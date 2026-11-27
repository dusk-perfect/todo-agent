import type { Task } from "../task-store.ts";
import type { ActionResult } from "./actions.ts";
import { dayName, dueLabel } from "./date.ts";

const PRIORITY_LABEL = { high: "高优先级", medium: "中优先级", low: "低优先级" } as const;
const ESTIMATE_LABEL = { large: "大工作量", medium: "中工作量", small: "小工作量" } as const;

function tagText(task: Task): string {
  const tags: string[] = [];
  const priority = task.priority;
  const estimate = task.estimate;
  if (typeof priority === "string") {
    tags.push(PRIORITY_LABEL[priority as keyof typeof PRIORITY_LABEL] ?? priority);
  }
  if (typeof estimate === "string") {
    tags.push(ESTIMATE_LABEL[estimate as keyof typeof ESTIMATE_LABEL] ?? estimate);
  }
  if (typeof task.dueAt === "string") tags.push(dueLabel(task.dueAt));
  if (typeof task.detail === "string") tags.push(task.detail);
  return tags.length > 0 ? ` [${tags.join(" · ")}]` : "";
}

function renderRows(tasks: Task[]): string {
  return tasks
    .map((task, index) => `${task.done ? "☑" : "☐"} ${index + 1}. ${task.title}${tagText(task)}`)
    .join("\n");
}

export function renderList(tasks: Task[]): string {
  if (tasks.length === 0) return "清单是空的，还没有待办。";
  const pending = tasks.filter((task) => !task.done).length;
  return [`共 ${tasks.length} 项，其中 ${pending} 项待办：`, renderRows(tasks)].join("\n");
}

export function formatResults(results: ActionResult[], tasks: Task[]): string {
  for (const result of results) {
    if (result.action.type === "ask") return result.action.question;
  }

  const dueResult = results.find((result) => result.action.type === "due");
  if (dueResult?.action.type === "due") {
    const dueTasks = dueResult.tasks ?? [];
    const day = dayName(dueResult.action.date);
    if (dueTasks.length === 0) return `${day}没有到期待办。`;
    return [`${day}有 ${dueTasks.length} 项待办到期：`, renderRows(dueTasks)].join("\n");
  }

  const parts: string[] = [];
  for (const { action, task } of results) {
    switch (action.type) {
      case "create":
        if (task) parts.push(`已记下「${task.title}」。`);
        break;
      case "complete":
        parts.push(task ? `已把「${task.title}」标记为完成。` : "没找到这条任务。");
        break;
      case "reopen":
        parts.push(task ? `已把「${task.title}」重新标为待办。` : "没找到这条任务。");
        break;
      case "rename":
        parts.push(task ? `已改名为「${task.title}」。` : "没找到这条任务。");
        break;
      case "setAttrs":
        parts.push(task ? `已更新「${task.title}」的属性。` : "没找到这条任务。");
        break;
      case "delete":
        parts.push(task ? `已删除「${task.title}」。` : "没找到这条任务。");
        break;
      case "list":
      case "due":
      case "ask":
        break;
    }
  }

  const list = renderList(tasks);
  return parts.length > 0 ? `${parts.join("\n")}\n\n${list}` : list;
}
