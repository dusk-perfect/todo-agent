import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { createConversationStore } from "./conversations.ts";

async function setup(t: TestContext, limit = 100) {
  const directory = await mkdtemp(join(tmpdir(), "todo-agent-talk-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return createConversationStore(directory, limit);
}

const user = { role: "user" as const, content: "帮我记一下买牛奶" };
const reply = { role: "assistant" as const, content: "已记下「买牛奶」。" };
const next = { role: "user" as const, content: "我有哪些任务？" };

test("会话按用户和会话 id 保存，同样的历史反复提交不会重复记账", async (t) => {
  const store = await setup(t);

  store.save("u1", "session-0001", [user]);
  assert.deepEqual(store.recent("u1", "session-0001"), [user]);

  store.save("u1", "session-0001", [user, reply]);
  assert.deepEqual(store.recent("u1", "session-0001"), [user, reply]);

  // 前端又带了一遍同样的历史，长度不变
  store.save("u1", "session-0001", [user, reply]);
  assert.equal(store.recent("u1", "session-0001").length, 2);

  store.save("u1", "session-0001", [user, reply, next]);
  assert.deepEqual(store.recent("u1", "session-0001"), [user, reply, next]);
});

test("只保留最近若干条，超出上限的旧消息被丢掉", async (t) => {
  const store = await setup(t, 4);
  const many = [1, 2, 3, 4, 5, 6].map((index) => ({
    role: "user" as const,
    content: `第 ${index} 条`,
  }));

  store.save("u1", "session-0001", many);
  const recent = store.recent("u1", "session-0001");
  assert.equal(recent.length, 4);
  assert.equal(recent[0]?.content, "第 3 条");
  assert.equal(recent.at(-1)?.content, "第 6 条");
});

test("刷新后只带回最近几条，末尾就是最新一句，不会出现两份", async (t) => {
  const store = await setup(t, 100);
  const history = Array.from({ length: 10 }, (_, index) => ({
    role: index % 2 === 0 ? ("user" as const) : ("assistant" as const),
    content: `第 ${index + 1} 条`,
  }));
  store.save("u1", "session-0001", history);

  // 前端只恢复了最后 4 条，再发一句新的
  const resumed = [...history.slice(-4), { role: "user" as const, content: "接着聊" }];
  store.save("u1", "session-0001", resumed);

  const saved = store.recent("u1", "session-0001");
  assert.equal(saved.length, 5);
  assert.equal(saved.at(-1)?.content, "接着聊");
  assert.equal(saved.filter((message) => message.content === "接着聊").length, 1);
});

test("不同用户的会话互不干扰，清空只影响自己", async (t) => {
  const store = await setup(t);
  store.save("u1", "session-0001", [user]);
  store.save("u2", "session-0002", [next]);

  assert.equal(store.recent("u1", "session-0001").length, 1);
  assert.equal(store.recent("u2", "session-0002").length, 1);
  assert.deepEqual(store.recent("u1", "session-0002"), []);

  store.clear("u1", "session-0001");
  assert.deepEqual(store.recent("u1", "session-0001"), []);
  assert.equal(store.recent("u2", "session-0002").length, 1);
});
