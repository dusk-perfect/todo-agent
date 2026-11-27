import type { Task, TaskStore } from "../task-store.ts";

export type Action =
  | { type: "create"; title: string; fields?: Record<string, unknown> }
  | { type: "list" }
  | { type: "due"; date: string }
  | { type: "complete"; id: string }
  | { type: "reopen"; id: string }
  | { type: "rename"; id: string; title: string }
  | { type: "setAttrs"; id: string; fields: Record<string, unknown> }
  | { type: "delete"; id: string }
  | { type: "ask"; question: string };

export interface ActionResult {
  action: Action;
  task?: Task;
  tasks?: Task[];
}

export function executeActions(tasks: TaskStore, actions: Action[]): ActionResult[] {
  return actions.map((action) => {
    switch (action.type) {
      case "create":
        return { action, task: tasks.create(action.title, action.fields) };
      case "list":
        return { action, tasks: tasks.list() };
      case "due":
        return {
          action,
          tasks: tasks.list().filter((task) => task.dueAt === action.date && !task.done),
        };
      case "setAttrs":
        return { action, task: tasks.update(action.id, action.fields) };
      case "complete":
        return { action, task: tasks.update(action.id, { done: true }) };
      case "reopen":
        return { action, task: tasks.update(action.id, { done: false }) };
      case "rename":
        return { action, task: tasks.update(action.id, { title: action.title }) };
      case "delete": {
        const task = tasks.list().find((item) => item.id === action.id);
        tasks.remove(action.id);
        return { action, task };
      }
      case "ask":
        return { action };
    }
  });
}
