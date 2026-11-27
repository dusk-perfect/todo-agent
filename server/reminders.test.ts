import assert from "node:assert/strict";
import { test } from "node:test";
import { buildReminders } from "./reminders.ts";

const now = new Date(2026, 10, 27, 14, 0, 0);
const today = "2026-11-27";

const tasks = [
  { id: "1", title: "过期两天", done: false, dueAt: "2026-11-25" },
  { id: "2", title: "今天没具体时间", done: false, dueAt: today },
  { id: "3", title: "半小时后", done: false, dueAt: today, dueTime: "14:30" },
  { id: "4", title: "晚上八点", done: false, dueAt: today, dueTime: "20:00" },
  { id: "5", title: "已经做完", done: true, dueAt: today, dueTime: "14:10" },
  { id: "6", title: "以后再说", done: false, dueAt: "2026-12-02" },
];

test("提醒分成过期、今天、一小时内到点三类", () => {
  const result = buildReminders(tasks, now);

  assert.deepEqual(
    result.overdue.map((task) => task.id),
    ["1"],
  );
  assert.deepEqual(
    result.today.map((task) => task.id),
    ["3", "4", "2"],
  );
  assert.deepEqual(
    result.soon.map((task) => task.id),
    ["3"],
  );
});

test("已完成的任务不再提醒，没有日期的任务也不进提醒", () => {
  const result = buildReminders(
    [
      { id: "a", title: "已做完", done: true, dueAt: "2026-11-20" },
      { id: "b", title: "没有日期", done: false },
    ],
    now,
  );

  assert.equal(result.overdue.length, 0);
  assert.equal(result.today.length, 0);
  assert.equal(result.soon.length, 0);
});

test("已经过了的时刻不算即将到点，只算今天要做", () => {
  const result = buildReminders(
    [{ id: "late", title: "半小时前", done: false, dueAt: today, dueTime: "13:30" }],
    now,
  );

  assert.equal(result.soon.length, 0);
  assert.equal(result.today.length, 1);
});
