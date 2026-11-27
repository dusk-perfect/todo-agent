import assert from "node:assert/strict";
import { test } from "node:test";
import { parsePlan, planWithLLM, systemPrompt } from "./agent/llm.ts";

test("模型返回的合法计划被解析成动作", () => {
  const plan = JSON.stringify({
    actions: [{ type: "create", title: "买牛奶", fields: { priority: "high" } }],
  });
  assert.deepEqual(parsePlan(plan), [
    { type: "create", title: "买牛奶", fields: { priority: "high" } },
  ]);
});

test("多动作计划按顺序保留", () => {
  const plan = JSON.stringify({
    actions: [
      { type: "create", title: "买牛奶" },
      { type: "list" },
      { type: "complete", id: "abc" },
    ],
  });
  assert.deepEqual(
    parsePlan(plan)?.map((action) => action.type),
    ["create", "list", "complete"],
  );
});

test("JSON 不合规时返回 null，交给规则引擎兜底", () => {
  assert.equal(parsePlan("好的，我这就帮你记下"), null);
  assert.equal(parsePlan('{"actions": [}'), null);
});

test("动作类型不在约定范围内时返回 null", () => {
  assert.equal(parsePlan(JSON.stringify({ actions: [{ type: "explode" }] })), null);
});

test("空动作列表视为无效", () => {
  assert.equal(parsePlan(JSON.stringify({ actions: [] })), null);
});

test("create 缺少标题时返回 null", () => {
  assert.equal(parsePlan(JSON.stringify({ actions: [{ type: "create" }] })), null);
});

test("没有配置 Key 时不调用模型，直接返回 null", async () => {
  const saved = process.env.DEEPSEEK_API_KEY;
  delete process.env.DEEPSEEK_API_KEY;
  try {
    assert.equal(await planWithLLM("帮我记一下买牛奶", []), null);
  } finally {
    if (saved !== undefined) process.env.DEEPSEEK_API_KEY = saved;
  }
});

test("模型把字段名写成 action 时也能解析", () => {
  assert.deepEqual(parsePlan('{"actions":[{"action":"create","title":"买牛奶"}]}'), [
    { type: "create", title: "买牛奶" },
  ]);
});

test("模型直接返回动作数组时也能解析", () => {
  assert.deepEqual(parsePlan('[{"type":"list"}]'), [{ type: "list" }]);
});

test("系统提示词带上当天日期，否则模型无法换算相对日期", () => {
  const prompt = systemPrompt(new Date("2026-11-26T10:00:00"));
  assert.match(prompt, /2026-11-26/);
  assert.match(prompt, /星期四|星期./);
  assert.match(prompt, /字段名固定为 type/);
});
