import assert from "node:assert/strict";
import { test } from "node:test";
import { eventsOn, parseIcs } from "./agent/calendar.ts";
import { daysFromToday, parseDueDate } from "./agent/date.ts";

test("解析 .ics：全天与带时间的日程都能读到日期和标题", () => {
  const ics = [
    "BEGIN:VCALENDAR",
    "BEGIN:VEVENT",
    "DTSTART;VALUE=DATE:20261128",
    "SUMMARY:公司团建",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "DTSTART:20261201T090000Z",
    "SUMMARY:季度评审\\, 上午",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");

  const events = parseIcs(ics);
  assert.deepEqual(events, [
    { date: "2026-11-28", title: "公司团建", allDay: true },
    { date: "2026-12-01", title: "季度评审, 上午", allDay: false },
  ]);
});

test("「周末」落到最近的周六，已经到周末就是当天", () => {
  const today = new Date().getDay();
  const expected = today === 6 || today === 0 ? daysFromToday(0) : daysFromToday(6 - today);
  assert.equal(parseDueDate("周末去买菜")?.date, expected);
});

test("「月底」「下个月初」落到当月最后一天和次月一号", () => {
  const now = new Date();
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const nextFirst = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const fmt = (date: Date) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

  assert.equal(parseDueDate("月底交房租")?.date, fmt(monthEnd));
  assert.equal(parseDueDate("下个月初交房租")?.date, fmt(nextFirst));
});

test("日历里那天的安排能被查出来", () => {
  const events = eventsOn(daysFromToday(1));
  assert.ok(Array.isArray(events));
});

test("「彻底」里的底不是月底，标题也不会被吃掉一个字", async () => {
  const { parseRuleActions } = await import("./agent/intent.ts");
  const actions = parseRuleActions("周末要把家里彻底打扫一遍", []);
  const created = (actions ?? []).filter((action) => action.type === "create");
  assert.equal(created.length, 1);
  assert.equal(created[0]?.type === "create" ? created[0].title : "", "家里彻底打扫一遍");
});
