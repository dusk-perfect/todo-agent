import { useEffect, useState } from "react";
import { loadReminders, type ReminderTask, type Reminders } from "./chat-client.ts";

const NOTIFIED_KEY = "todo-agent-notified";

function readNotified(): string[] {
  try {
    const raw = window.localStorage.getItem(NOTIFIED_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function writeNotified(keys: string[]) {
  try {
    window.localStorage.setItem(NOTIFIED_KEY, JSON.stringify(keys.slice(-200)));
  } catch {
    // 存不进去最多再提醒一次，不影响使用
  }
}

function taskKey(task: ReminderTask): string {
  return `${task.id}@${task.dueAt ?? ""}@${task.dueTime ?? ""}`;
}

function todayString(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

// 「今天 15:30 和小东开会」比「2026-11-27 15:30 和小东开会」好读，今天不用重复日期；
// 逾期任务也只在跨年时才写年份
function whenText(task: ReminderTask): string {
  const time = task.dueTime ?? "";
  if (task.dueAt === todayString()) return time ? `今天 ${time}` : "今天";
  const date = task.dueAt ?? "";
  const year = String(new Date().getFullYear());
  const short = date.startsWith(`${year}-`) ? date.slice(5) : date;
  return [short, time].filter(Boolean).join(" ");
}

function describe(task: ReminderTask): string {
  const when = whenText(task);
  return when ? `${when} ${task.title}` : task.title;
}

type Kind = "overdue" | "soon" | "today";

interface DetailRow {
  task: ReminderTask;
  kind: Kind;
}

interface ReminderBarProps {
  /** 每聊完一轮递增，让提醒条立刻跟着刷新，而不是最多等 60 秒 */
  revision?: number;
}

export function ReminderBar({ revision = 0 }: ReminderBarProps) {
  const [reminders, setReminders] = useState<Reminders | null>(null);
  const [open, setOpen] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">(() =>
    typeof window !== "undefined" && "Notification" in window
      ? Notification.permission
      : "unsupported",
  );

  useEffect(() => {
    let alive = true;
    async function refresh() {
      const next = await loadReminders();
      if (alive) setReminders(next);
    }
    void refresh();
    const timer = window.setInterval(() => void refresh(), 60_000);
    // 切回页面时补一次，避免后台标签页里的数据过期
    function onVisible() {
      if (document.visibilityState === "visible") void refresh();
    }
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [revision]);

  // 一小时内到点的，授权后弹系统通知；同一条任务只弹一次
  useEffect(() => {
    if (!reminders || permission !== "granted" || reminders.soon.length === 0) return;
    const shown = readNotified();
    let changed = false;
    for (const task of reminders.soon) {
      const key = taskKey(task);
      if (shown.includes(key)) continue;
      new Notification("该做了", { body: describe(task), tag: key });
      shown.push(key);
      changed = true;
    }
    if (changed) writeNotified(shown);
  }, [reminders, permission]);

  if (!reminders) return null;

  const overdue = reminders.overdue.length;
  const today = reminders.today.length;
  const soon = reminders.soon.length;
  if (overdue + today === 0) return null;

  // today 本身包含 soon，这里按「先过期、再一小时内、最后其余今天」排，并去重
  const rows: DetailRow[] = [
    ...reminders.overdue.map((task) => ({ task, kind: "overdue" as const })),
    ...reminders.soon.map((task) => ({ task, kind: "soon" as const })),
    ...reminders.today.map((task) => ({ task, kind: "today" as const })),
  ];
  const seen = new Set<string>();
  const detail = rows.filter((row) => {
    if (seen.has(row.task.id)) return false;
    seen.add(row.task.id);
    return true;
  });

  return (
    <section className="reminders" aria-label="提醒">
      <button
        type="button"
        className="reminder-summary"
        aria-expanded={open}
        aria-label={open ? "收起提醒明细" : "展开提醒明细"}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="chips">
          {overdue > 0 && (
            <span className="chip overdue">
              <strong>{overdue}</strong> 项已过期
            </span>
          )}
          {today > 0 && (
            <span className="chip today">
              今天 <strong>{today}</strong> 项
            </span>
          )}
          {soon > 0 && (
            <span className="chip soon">
              其中 <strong>{soon}</strong> 项一小时内
            </span>
          )}
        </span>
        <span className="reminder-toggle" aria-hidden="true">
          {open ? "▴" : "▾"}
        </span>
      </button>
      {open && (
        <>
          <ul className="reminder-list">
            {detail.map(({ task, kind }) => (
              <li key={task.id}>
                <span className={`dot ${kind}`} aria-hidden="true" />
                {describe(task)}
              </li>
            ))}
          </ul>
          {permission === "default" && (
            <button
              type="button"
              className="reminder-allow"
              onClick={() =>
                void Notification.requestPermission().then((result) => setPermission(result))
              }
            >
              开启浏览器通知，到点弹出
            </button>
          )}
        </>
      )}
    </section>
  );
}
