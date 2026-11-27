import type { Task } from "../task-store.ts";
import type { ActionResult } from "./actions.ts";
import { dueBadge, shortDate } from "./date.ts";

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
  if (typeof task.detail === "string") tags.push(task.detail);
  return tags.length > 0 ? ` [${tags.join(" · ")}]` : "";
}

function rowText(task: Task, index: number): string {
  return `${task.done ? "☑" : "☐"} ${index + 1}. ${task.title}${tagText(task)}`;
}

function renderRows(tasks: Task[]): string {
  return tasks.map((task, index) => rowText(task, index)).join("\n");
}

interface DayGroup {
  date: string;
  label: string;
  tasks: Task[];
}

// 同一天的任务并到一组，日期只写一次，不逐条重复
function groupByDay(tasks: Task[]): DayGroup[] {
  const dated = new Map<string, Task[]>();
  const undated: Task[] = [];
  for (const task of tasks) {
    if (typeof task.dueAt !== "string") {
      undated.push(task);
      continue;
    }
    const bucket = dated.get(task.dueAt) ?? [];
    bucket.push(task);
    dated.set(task.dueAt, bucket);
  }

  const groups = [...dated.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, items]) => ({ date, label: dueBadge(date), tasks: items }));
  if (undated.length > 0) groups.push({ date: "", label: "未排期", tasks: undated });
  return groups;
}

export function renderList(tasks: Task[]): string {
  if (tasks.length === 0) return "清单是空的，还没有待办。";
  const pending = tasks.filter((task) => !task.done).length;
  // 一条都没剩下时不说「其中 0 项待办」，读着别扭
  const header =
    pending === 0
      ? `共 ${tasks.length} 项，都已完成：`
      : `共 ${tasks.length} 项，其中 ${pending} 项待办：`;
  const groups = groupByDay(tasks);

  // 一条都没排期时不用多一个「未排期」标题
  const only = groups[0];
  if (groups.length === 1 && only && only.date === "") {
    return [header, renderRows(only.tasks)].join("\n");
  }

  let seen = 0;
  const blocks = groups.map((group) => {
    const rows = group.tasks
      .map((task) => {
        seen += 1;
        return rowText(task, seen - 1);
      })
      .join("\n");
    return `${group.label}（${group.tasks.length} 项）\n${rows}`;
  });
  return [header, ...blocks].join("\n\n");
}

export function formatResults(results: ActionResult[], tasks: Task[]): string {
  for (const result of results) {
    if (result.action.type === "ask") return result.action.question;
  }

  const dueResult = results.find((result) => result.action.type === "due");
  if (dueResult?.action.type === "due") {
    const dueTasks = dueResult.tasks ?? [];
    const day = shortDate(dueResult.action.date);
    if (dueTasks.length === 0) return `${day} 没有需要完成的待办。`;
    return [`${day} 有 ${dueTasks.length} 项待办需要完成：`, renderRows(dueTasks)].join("\n");
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
