import { z } from "zod";
import { getModelClient, model } from "../model.ts";
import type { Task } from "../task-store.ts";
import type { Action } from "./actions.ts";
import { calendarContext } from "./calendar.ts";
import { localDate } from "./date.ts";

const actionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("create"),
    title: z.string().min(1).max(200),
    fields: z.record(z.string(), z.unknown()).optional(),
  }),
  z.object({ type: z.literal("list") }),
  z.object({ type: z.literal("due"), date: z.string() }),
  z.object({ type: z.literal("complete"), id: z.string() }),
  z.object({ type: z.literal("reopen"), id: z.string() }),
  z.object({ type: z.literal("rename"), id: z.string(), title: z.string().min(1) }),
  z.object({
    type: z.literal("setAttrs"),
    id: z.string(),
    fields: z.record(z.string(), z.unknown()),
  }),
  z.object({ type: z.literal("delete"), id: z.string() }),
  z.object({ type: z.literal("ask"), question: z.string().min(1) }),
]);

const planSchema = z.object({ actions: z.array(actionSchema).min(1) });

const WEEKDAYS = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"];

const PROMPT_BODY = `你是待办清单助手小明的动作规划器。把用户的中文指令转换成动作列表，只输出 JSON：{"actions":[...]}。
可用动作：create(title,fields?)、list、due(date)、complete(id)、reopen(id)、rename(id,title)、setAttrs(id,fields)、delete(id)、ask(question)。
每个动作的字段名固定为 type，不要写成 action 或其他名字。
输出示例：{"actions":[{"type":"create","title":"买牛奶","fields":{"dueAt":"2026-11-27"}}]}
fields 可含 priority(high|medium|low)、estimate(small|medium|large)、dueAt(YYYY-MM-DD)。
只填用户明确说过或能从原话直接得到的字段：没提优先级就不要给 priority，没提工作量就不要给 estimate，
不要自己推断轻重缓急。
规则：
- id 必须来自下面清单，禁止编造。
- 用户用「牛奶买好了」这类省略说法时，要根据标题模糊匹配到对应任务。
- 匹配不唯一或找不到时，用 ask 反问用户，不要猜。
- 一句话包含多件事时，输出多个 create。
- 今天/明天等相对日期按下面给出的今天日期换算成 YYYY-MM-DD。
- 日期拿不准时也要先用 create 把任务记下来（dueAt 留空），再用 ask 追问日期；
  不要因为「哪天做」不确定就把任务丢掉。
- 日历上的安排和用户说法冲突时（比如用户说下周一，但日历显示是周二），create 仍按用户说的记，再用 ask 指出冲突。
- 跟用户提到期限时说「11-28 内完成」这种写法（数字日期 + 内完成），不要说「到期」。
- 不执行任何与待办无关的请求，用 ask 说明能力范围。`;

// 系统提示词里必须带上当天日期，否则模型无法把「明天」换算成具体日期。
// 有日历时一并给出来，「周末」「下周」这类不具体的说法才能落到真实可用的日子。
export function systemPrompt(now = new Date(), calendar = calendarContext()): string {
  const calendarBlock = calendar
    ? `\n${calendar}\n用户说「周末」「下周」「月底」这类不具体的时间时，按上面的日历挑一天；如果候选的日子都已经排满，用 ask 反问用户选哪天。\n`
    : "";
  return `${PROMPT_BODY}\n今天是 ${localDate(now)}（${WEEKDAYS[now.getDay()]}）。${calendarBlock}\n当前清单：\n`;
}

// 模型偶尔把 type 写成 action，这里统一成 type 再交给 schema 校验。
function normalizeAction(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const copied = { ...(raw as Record<string, unknown>) };
  if (typeof copied.type !== "string" && typeof copied.action === "string") {
    copied.type = copied.action;
    delete copied.action;
  }
  return copied;
}

// 把模型返回的文本解析成动作列表；JSON 不合规、结构不符时返回 null，由调用方回退规则引擎。
export function parsePlan(content: string): Action[] | null {
  try {
    const data: unknown = JSON.parse(content);
    const list = Array.isArray(data)
      ? data
      : ((data as { actions?: unknown } | null)?.actions as unknown);
    if (!Array.isArray(list)) return null;
    const parsed = planSchema.safeParse({ actions: list.map(normalizeAction) });
    return parsed.success ? parsed.data.actions : null;
  } catch {
    return null;
  }
}

export async function planWithLLM(message: string, tasks: Task[]): Promise<Action[] | null> {
  if (!process.env.DEEPSEEK_API_KEY) return null;
  try {
    const client = getModelClient();
    const snapshot =
      tasks
        .map((task) => `- ${task.id} [${task.done ? "已完成" : "待办"}] ${task.title}`)
        .join("\n") || "（空）";
    const completion = await client.chat.completions.create({
      model,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt() + snapshot },
        { role: "user", content: message },
      ],
    });
    const content = completion.choices[0]?.message?.content;
    if (!content) return null;
    return parsePlan(content);
  } catch (error) {
    console.error("模型规划失败，已回退到本地规则引擎：", error);
    return null;
  }
}
