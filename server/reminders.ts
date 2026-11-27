import type { Task } from "./task-store.ts";
import { localDate } from "./agent/date.ts";

export interface ReminderBuckets {
  overdue: Task[];
  today: Task[];
  soon: Task[];
}

// dueTime 是 "HH:MM"，只在当天有日期时才有意义
function dueTimestamp(task: Task, today: string): number | null {
  if (typeof task.dueAt !== "string" || typeof task.dueTime !== "string") return null;
  const matched = task.dueTime.match(/^(\d{2}):(\d{2})$/);
  if (!matched) return null;
  const [year, month, day] = today.split("-").map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day, Number(matched[1]), Number(matched[2])).getTime();
}

// 三类提醒：已经过期的、今天要做的、一小时内到点的。
// 只算没完成的任务；已完成的不再打扰。
export function buildReminders(
  tasks: Task[],
  now = new Date(),
  windowMinutes = 60,
): ReminderBuckets {
  const today = localDate(now);
  const pending = tasks.filter((task) => !task.done);

  const overdue = pending
    .filter((task) => typeof task.dueAt === "string" && task.dueAt < today)
    .sort((a, b) => String(a.dueAt).localeCompare(String(b.dueAt)));

  const todayTasks = pending
    .filter((task) => task.dueAt === today)
    .sort((a, b) => String(a.dueTime ?? "99:99").localeCompare(String(b.dueTime ?? "99:99")));

  const soon = todayTasks.filter((task) => {
    const at = dueTimestamp(task, today);
    if (at === null) return false;
    const from = now.getTime();
    return at >= from && at - from <= windowMinutes * 60_000;
  });

  return { overdue, today: todayTasks, soon };
}
