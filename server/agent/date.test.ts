import assert from "node:assert/strict";
import { test } from "node:test";
import { parseDueTime } from "./date.ts";

test("口语里的时刻能折算成 24 小时制", () => {
  assert.equal(parseDueTime("下午三点和小东开会")?.time, "15:00");
  assert.equal(parseDueTime("上午十点去医院")?.time, "10:00");
  assert.equal(parseDueTime("晚上八点半看球")?.time, "20:30");
  assert.equal(parseDueTime("中午十二点吃饭")?.time, "12:00");
  assert.equal(parseDueTime("凌晨两点看球")?.time, "02:00");
  assert.equal(parseDueTime("十点十五分开会")?.time, "10:15");
});

test("没有时段词时，1 到 6 点按下午算", () => {
  assert.equal(parseDueTime("三点开会")?.time, "15:00");
  assert.equal(parseDueTime("两点半面试")?.time, "14:30");
  // 7 点以后按原值，不硬猜
  assert.equal(parseDueTime("九点开会")?.time, "09:00");
});

test("没有时间的句子不返回结果", () => {
  assert.equal(parseDueTime("帮我记一下买牛奶"), null);
  assert.equal(parseDueTime("明天内完成"), null);
});
