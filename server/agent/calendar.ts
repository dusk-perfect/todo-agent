import { existsSync, readFileSync, statSync } from "node:fs";
import { localDate } from "./date.ts";

export interface CalendarEvent {
  date: string;
  title: string;
  allDay: boolean;
}

// 日历来源：优先环境变量指定的文件，其次 data/calendar.ics。
// 用 .ics 而不是各家日历 API，是为了不依赖授权——用户从手机或电脑导出即可。
// 没有这个文件就当作没有日历，不做任何提醒；格式示例见 examples/calendar.example.ics。
const DEFAULT_PATHS = ["data/calendar.ics", "data/calendar.ical"];

interface Cache {
  key: string;
  events: CalendarEvent[];
}
let cache: Cache | null = null;

function unescapeText(value: string): string {
  return value
    .replace(/\\n/gi, " ")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\");
}

function toDate(value: string): string {
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
}

// 只取 VEVENT 的开始日期与标题；够用来判断「那天有没有安排」。
export function parseIcs(text: string): CalendarEvent[] {
  const unfolded = text.replace(/\r?\n[ \t]/g, "");
  const events: CalendarEvent[] = [];

  for (const chunk of unfolded.split(/BEGIN:VEVENT/).slice(1)) {
    const body = chunk.split(/END:VEVENT/)[0] ?? "";
    const start = body.match(/DTSTART[^:\r\n]*:(\d{8})/);
    if (!start?.[1]) continue;
    const summary = body.match(/SUMMARY:(.+)/);
    events.push({
      date: toDate(start[1]),
      title: summary?.[1] ? unescapeText(summary[1].trim()) : "（未命名日程）",
      allDay: /DTSTART;VALUE=DATE/.test(body),
    });
  }

  return events.sort((a, b) => a.date.localeCompare(b.date));
}

export function calendarPath(): string | null {
  const fromEnv = process.env.CALENDAR_ICS_PATH;
  if (fromEnv && existsSync(fromEnv)) return fromEnv;
  return DEFAULT_PATHS.find((path) => existsSync(path)) ?? null;
}

// 按文件修改时间缓存，改了日历不用重启
export function loadCalendar(): CalendarEvent[] {
  const path = calendarPath();
  if (!path) return [];

  const key = `${path}:${statSync(path).mtimeMs}`;
  if (cache?.key === key) return cache.events;

  try {
    const events = parseIcs(readFileSync(path, "utf8"));
    cache = { key, events };
    return events;
  } catch (error) {
    console.error("日历读取失败，按没有日历处理：", error);
    return [];
  }
}

export function eventsOn(date: string): CalendarEvent[] {
  return loadCalendar().filter((event) => event.date === date);
}

// 把近期安排压成几行，交给模型判断「周末/下周」落到哪天更合适。
export function calendarContext(days = 14): string {
  const events = loadCalendar();
  if (events.length === 0) return "";

  const today = localDate(new Date());
  const limit = new Date();
  limit.setDate(limit.getDate() + days);
  const until = localDate(limit);

  const upcoming = events.filter((event) => event.date >= today && event.date <= until);
  if (upcoming.length === 0) return "";

  const lines = upcoming.map(
    (event) => `- ${event.date} ${event.title}${event.allDay ? "（全天）" : ""}`,
  );
  return `日历里近期已有安排（判断日期时要避开已占满的日子）：\n${lines.join("\n")}`;
}

export function calendarNote(date: string): string {
  const events = eventsOn(date);
  if (events.length === 0) return "";
  const titles = events.map((event) => event.title).join("、");
  return `\n\n（提醒：${date} 日历上已有 ${events.length} 项安排：${titles}）`;
}
