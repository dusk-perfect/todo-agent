import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import type { ChatMessage } from "../shared/chat.ts";
import { reply } from "./agent.ts";
import { daysFromToday } from "./agent/date.ts";
import { createJsonTaskStore } from "./task-store.ts";

async function startConversation(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "todo-agent-dialog-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filename = join(directory, "tasks.json");
  const store = createJsonTaskStore(filename);
  const history: ChatMessage[] = [];

  async function say(text: string) {
    history.push({ role: "user", content: text });
    const answer = await reply(history, store);
    history.push({ role: "assistant", content: answer });
    return answer;
  }

  return { store, filename, say };
}

test("验收对话：创建、查看、完成、删除全流程", async (t) => {
  const { store, say } = await startConversation(t);

  assert.match(await say("帮我记一下买牛奶"), /买牛奶/);
  assert.deepEqual(
    store.list().map((task) => task.title),
    ["买牛奶"],
  );

  assert.match(await say("再记一条取快递"), /取快递/);
  assert.deepEqual(
    store.list().map((task) => task.title),
    ["买牛奶", "取快递"],
  );

  const listing = await say("我有哪些任务？");
  assert.match(listing, /买牛奶/);
  assert.match(listing, /取快递/);
  assert.match(listing, /☐/);
  assert.match(listing, /待办/);

  const completed = await say("牛奶买好了");
  assert.match(completed, /买牛奶/);
  assert.equal(store.list()[0]?.done, true);
  assert.equal(store.list()[1]?.done, false);
  assert.match(completed, /☑ 1\. 买牛奶/);
  assert.match(completed, /☐ 2\. 取快递/);

  assert.match(await say("取快递这条删掉吧"), /取快递/);
  assert.deepEqual(
    store.list().map((task) => task.title),
    ["买牛奶"],
  );

  const final = await say("再给我看看清单");
  assert.match(final, /☑ 1\. 买牛奶/);
  assert.doesNotMatch(final, /取快递/);
});

test("空清单与超出能力范围的输入", async (t) => {
  const { say } = await startConversation(t);
  assert.match(await say("看看我的待办"), /空的/);
  assert.match(await say("今天天气怎么样"), /记待办|清单|完成|删除/);
});

test("任务指代模糊时反问确认，不擅自修改", async (t) => {
  const { store, say } = await startConversation(t);
  await say("记一下买牛奶");
  await say("再记一条买面包");

  const answer = await say("买好了");
  assert.match(answer, /哪一个/);
  assert.match(answer, /买牛奶/);
  assert.match(answer, /买面包/);
  assert.equal(
    store.list().some((task) => task.done),
    false,
  );
});

test("一句话记录多件事", async (t) => {
  const { store, say } = await startConversation(t);
  const answer = await say("帮我记一下买牛奶和取快递");
  assert.match(answer, /买牛奶/);
  assert.match(answer, /取快递/);
  assert.deepEqual(
    store.list().map((task) => task.title),
    ["买牛奶", "取快递"],
  );
});

test("重启服务后任务仍可查询", async (t) => {
  const { store, filename, say } = await startConversation(t);
  await say("帮我记一下洗衣服");
  assert.equal(store.list().length, 1);

  const restarted = createJsonTaskStore(filename);
  const history: ChatMessage[] = [{ role: "user", content: "有哪些任务" }];
  const answer = await reply(history, restarted);
  assert.match(answer, /洗衣服/);
});

test("创建时解析优先级、工作量和截止日期", async (t) => {
  const { store, say } = await startConversation(t);
  const answer = await say("帮我记一下写季度报告，高优先级，大工作量，明天到期");

  const task = store.list()[0];
  assert.equal(task?.title, "写季度报告");
  assert.equal(task?.priority, "high");
  assert.equal(task?.estimate, "large");
  assert.equal(task?.dueAt, daysFromToday(1));
  assert.match(answer, /高优先级/);
  assert.match(answer, /大工作量/);
  // 日期写在标题前面，纯数字，不同日期的待办一眼分得清
  assert.match(answer, new RegExp(`\\[${daysFromToday(1).slice(5)} 内完成\\] 写季度报告`));
});

test("「今天内完成」是截止说明，不会被拆成第二条任务", async (t) => {
  const { store, say } = await startConversation(t);
  await say("帮我记一下交季度报表，今天内完成");
  assert.deepEqual(
    store.list().map((task) => task.title),
    ["交季度报表"],
  );
  assert.equal(store.list()[0]?.dueAt, daysFromToday(0));
});

test("「明天之前搞定」同样只算截止时间", async (t) => {
  const { store, say } = await startConversation(t);
  await say("帮我记一下陪小东打电话，明天之前搞定");
  assert.deepEqual(
    store.list().map((task) => task.title),
    ["陪小东打电话"],
  );
  assert.equal(store.list()[0]?.dueAt, daysFromToday(1));
});

test("修改已有任务的属性", async (t) => {
  const { store, say } = await startConversation(t);
  await say("记一下买牛奶");
  const answer = await say("把买牛奶设为低优先级");

  assert.equal(store.list()[0]?.priority, "low");
  assert.match(answer, /买牛奶/);
});

test("创建后追问细节：用户说没有则不补充", async (t) => {
  const { store, say } = await startConversation(t);
  const created = await say("帮我记一下买牛奶");
  assert.match(created, /需要给「买牛奶」备注说明吗/);
  // 追问只问一句，不再举例子、也不再教用户说「没有」
  assert.doesNotMatch(created, /比如|不需要就说/);

  const answered = await say("没有");
  assert.match(answered, /先按现在的记录保存/);
  assert.equal(store.list()[0]?.detail, undefined);
  assert.doesNotMatch(answered, /备注说明吗/);
});

test("创建后追问细节：用户补充内容会写入任务并显示在清单", async (t) => {
  const { store, say } = await startConversation(t);
  await say("帮我记一下买牛奶");

  const answered = await say("要三元的纯牛奶，高优先级，明天到期");
  const task = store.list()[0];
  assert.equal(task?.detail, "三元的纯牛奶");
  assert.equal(task?.priority, "high");
  assert.equal(task?.dueAt, daysFromToday(1));
  assert.match(answered, /三元的纯牛奶/);
  // 只回 detail，不再把整句原样贴一遍
  assert.match(answered, /已为「买牛奶」记下备注：三元的纯牛奶\n/);
  assert.doesNotMatch(answered, /记下备注：三元的纯牛奶，高优先级/);
});

test("追问时用户改说新指令，优先执行新指令而非当作细节", async (t) => {
  const { store, say } = await startConversation(t);
  await say("帮我记一下买牛奶");

  const next = await say("再记一条取快递");
  assert.deepEqual(
    store.list().map((task) => task.title),
    ["买牛奶", "取快递"],
  );
  assert.equal(store.list()[0]?.detail, undefined);
  assert.match(next, /取快递/);
});

test("查询今天到期的任务", async (t) => {
  const { say } = await startConversation(t);
  await say("帮我记一下交报表，今天到期");
  await say("帮我记一下取快递，明天到期");

  const answer = await say("今天有哪些任务到期？");
  assert.match(answer, /交报表/);
  assert.doesNotMatch(answer, /取快递/);
  assert.match(answer, new RegExp(`${daysFromToday(0).slice(5)} 有 1 项待办需要完成`));
});

test("查询明天到期：文案跟随日期，不写死今天", async (t) => {
  const { say } = await startConversation(t);
  await say("帮我记一下交报表，今天到期");
  await say("帮我记一下取快递，明天到期");

  const answer = await say("明天有哪些任务到期？");
  assert.match(answer, new RegExp(`${daysFromToday(1).slice(5)} 有 1 项待办需要完成`));
  assert.match(answer, /取快递/);
  assert.doesNotMatch(answer, /交报表/);
  assert.doesNotMatch(answer, /今天/);
});

test("查询后天到期：不只是今天明天", async (t) => {
  const { say } = await startConversation(t);
  await say("帮我记一下交水费，后天到期");
  const answer = await say("后天有哪些任务到期？");
  assert.match(answer, new RegExp(`${daysFromToday(2).slice(5)} 有 1 项待办需要完成`));
  assert.match(answer, /交水费/);
});

test("只说「帮我记一下」不创建空任务", async (t) => {
  const { store, say } = await startConversation(t);
  const answer = await say("帮我记一下");
  assert.equal(store.list().length, 0);
  assert.doesNotMatch(answer, /已记下/);
});

test("超过 200 字的标题被拒绝", async (t) => {
  const { store, say } = await startConversation(t);
  const answer = await say("帮我记一下" + "超长标题".repeat(60));
  assert.equal(store.list().length, 0);
  assert.match(answer, /200 字以内/);
});

test("「下周三」算到下一周的周三，不会多算一周", async (t) => {
  const { store, say } = await startConversation(t);
  await say("帮我记一下开评审，下周三到期");
  await say("帮我记一下做复盘，下下周三到期");
  const weekday = (new Date().getDay() + 6) % 7;
  assert.equal(store.list()[0]?.dueAt, daysFromToday(7 - weekday + 2));
  assert.equal(store.list()[1]?.dueAt, daysFromToday(14 - weekday + 2));
});

test("「这个没做完」在只有一条已完成时标回待办", async (t) => {
  const { store, say } = await startConversation(t);
  await say("帮我记一下买牛奶");
  await say("没有");
  await say("牛奶买好了");
  assert.equal(store.list()[0]?.done, true);

  const answer = await say("这个没做完");
  assert.equal(store.list()[0]?.done, false);
  assert.match(answer, /重新标为待办/);
});

test("有两条已完成时「这个没做完」反问，不擅自挑一条", async (t) => {
  const { store, say } = await startConversation(t);
  await say("帮我记一下买牛奶");
  await say("没有");
  await say("帮我记一下取快递");
  await say("没有");
  await say("牛奶买好了");
  await say("取快递搞定了");
  assert.equal(store.list().filter((task) => task.done).length, 2);

  const answer = await say("这个没做完");
  assert.match(answer, /哪一个/);
  assert.equal(store.list().filter((task) => task.done).length, 2);
});

test("追问状态下说「把…设为低优先级」按指令执行，不当成细节", async (t) => {
  const { store, say } = await startConversation(t);
  await say("帮我记一下写季度报告，高优先级，大工作量，明天到期");
  assert.equal(store.list()[0]?.priority, "high");

  const answer = await say("把写季度报告设为低优先级");
  assert.equal(store.list()[0]?.priority, "low");
  assert.match(answer, /已更新/);
});

test("只问「有哪些到期了」不带日期时按今天算", async (t) => {
  const { say } = await startConversation(t);
  await say("帮我记一下交水费，今天到期");
  await say("帮我记一下交电费，明天到期");

  const answer = await say("有哪些到期了？");
  assert.match(answer, new RegExp(`${daysFromToday(0).slice(5)} 有 1 项待办需要完成`));
  assert.match(answer, /交水费/);
  assert.doesNotMatch(answer, /交电费/);
});

test("追问中用户说的是另一件事（没有说要补充）时新建任务，不污染上一条", async (t) => {
  const { store, say } = await startConversation(t);
  await say("帮我记一下买书");

  const answered = await say("我现在要去取快递");
  const tasks = store.list();
  assert.equal(tasks.length, 2);
  assert.equal(tasks.find((task) => task.title === "买书")?.detail, undefined);
  assert.ok(tasks.some((task) => task.title === "取快递"));
  assert.match(answered, /另一件事/);
  assert.match(answered, /买书/);
});

test("追问中只说「嗯」时继续问细节，不建新任务也不写空细节", async (t) => {
  const { store, say } = await startConversation(t);
  await say("帮我记一下买书");

  const answered = await say("嗯");
  assert.equal(store.list().length, 1);
  assert.equal(store.list()[0]?.detail, undefined);
  assert.match(answered, /备注说明/);
  assert.match(answered, /买书/);
});

test("追问中「有哪些到期了」不会被当成细节", async (t) => {
  const { store, say } = await startConversation(t);
  await say("帮我记一下交水费，今天到期");

  await say("有哪些到期了？");
  assert.equal(store.list()[0]?.detail, undefined);
});

test("陈述式说法能建任务，不依赖具体是哪件事", async (t) => {
  const { store, say } = await startConversation(t);
  const cases: [string, string][] = [
    ["这周末要给车做保养", "给车做保养"],
    ["晚上还得遛狗", "遛狗"],
    ["我下周要去银行办卡", "银行办卡"],
    ["我得交房租了", "交房租"],
    ["我明天得准备面试材料", "准备面试材料"],
  ];

  for (const [text, title] of cases) {
    await say(text);
    assert.ok(
      store.list().some((task) => task.title === title),
      `${text} 应当建出「${title}」，实际：${store
        .list()
        .map((task) => task.title)
        .join("、")}`,
    );
  }
});

test("追问中说的是规则也解析不了的另一件事，仍按新任务处理", async (t) => {
  const { store, say } = await startConversation(t);
  await say("帮我记一下买书");

  await say("同事让我下午去开会");
  assert.equal(store.list().length, 2);
  assert.equal(store.list().find((task) => task.title === "买书")?.detail, undefined);
});

test("长复合句没有模型时压成一条，不拆成多条错任务", async (t) => {
  const { store, say } = await startConversation(t);
  await say("我明天上午得先去公司开周会，然后下午要去银行把那个卡办了");
  assert.equal(store.list().length, 1);
  assert.match(store.list()[0]?.title ?? "", /周会/);
});

test("「这周五」指本周那天，当天就是当天", async (t) => {
  const { store, say } = await startConversation(t);
  await say("帮我记一下交季度报告，这周五到期");
  const current = (new Date().getDay() + 6) % 7;
  const expected = daysFromToday((4 - current + 7) % 7);
  assert.equal(store.list()[0]?.dueAt, expected);
});
