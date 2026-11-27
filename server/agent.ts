import type { ChatMessage } from "../shared/chat.ts";
import type { Task, TaskStore } from "./task-store.ts";
import { executeActions, type Action } from "./agent/actions.ts";
import { parseDueDate } from "./agent/date.ts";
import {
  detailContentPrompt,
  detailPrompt,
  parseDetailAnswer,
  pendingDetailTask,
} from "./agent/followup.ts";
import { calendarNote } from "./agent/calendar.ts";
import { formatResults } from "./agent/format.ts";
import { parseRuleActions, parseLongStatementTitle, FALLBACK_QUESTION } from "./agent/intent.ts";
import { planWithLLM } from "./agent/llm.ts";

export type { ChatMessage } from "../shared/chat.ts";

function listBlock(tasks: TaskStore): string {
  return formatResults([{ action: { type: "list" }, tasks: tasks.list() }], tasks.list());
}

// 把用户明确要补充的那句写进上一条任务：属性拆出来，剩下的记成 detail。
function writeDetail(text: string, task: Task, tasks: TaskStore): string {
  const fields: Record<string, unknown> = {};
  let remainder = text.trim();

  const priority = remainder.match(/(高|中|低)优先级/);
  if (priority) {
    fields.priority = { 高: "high", 中: "medium", 低: "low" }[priority[1] as "高" | "中" | "低"];
    remainder = remainder.replace(priority[0], "");
  }

  const estimate = remainder.match(/(大|中|小)工作量/);
  if (estimate) {
    fields.estimate = { 大: "large", 中: "medium", 小: "small" }[estimate[1] as "大" | "中" | "小"];
    remainder = remainder.replace(estimate[0], "");
  }

  const due = parseDueDate(remainder);
  if (due) {
    fields.dueAt = due.date;
    remainder = remainder.replace(due.matched, "");
  }

  remainder = remainder.replace(/(?:到期|截止)/g, "").replace(/^[，,、\s]+|[，,、\s]+$/g, "");
  if (remainder) {
    // 已经补过的细节保留，新的接在后面，不覆盖
    const existing = typeof task.detail === "string" ? task.detail : "";
    fields.detail =
      existing && !existing.includes(remainder) ? `${existing}；${remainder}` : remainder;
  }

  if (Object.keys(fields).length === 0) {
    return `「${task.title}」先按现在的记录保存。\n\n${listBlock(tasks)}`;
  }

  executeActions(tasks, [{ type: "setAttrs", id: task.id, fields }]);
  const summary =
    typeof fields.detail === "string"
      ? `已为「${task.title}」记下备注：${fields.detail}`
      : `已更新「${task.title}」的属性`;
  return `${summary}\n\n${listBlock(tasks)}`;
}

// 接收本轮对话历史与任务存储，返回小明的回复。
// 意图识别顺序：规则 → 模型 → 兜底；规则优先是为了确定和快，模型只在规则听不懂时兜底。
export async function reply(messages: ChatMessage[], tasks: TaskStore): Promise<string> {
  const latest = messages.at(-1);
  if (!latest || latest.role !== "user") return "请告诉我你想做什么。";

  const snapshot = tasks.list();
  const ruleActions = parseRuleActions(latest.content, snapshot);

  // 上一轮刚追问过细节：只有用户明确说要补充，才写进上一条任务。
  // 说「没有」就结束；没说要补充（比如「我现在要去取快递」）一律按另一件事处理。
  const pending = pendingDetailTask(messages, snapshot);
  if (pending) {
    const answer = parseDetailAnswer(latest.content);
    if (answer.kind === "none") {
      return `好的，「${pending.title}」先按现在的记录保存。\n\n${listBlock(tasks)}`;
    }
    if (answer.kind === "agree") return writeDetail(answer.text, pending, tasks);
    if (answer.kind === "ask") return detailContentPrompt(pending.title);
  }

  let actions: Action[] | null = ruleActions;
  if (!actions) actions = await planWithLLM(latest.content, snapshot);

  // 都没有结果时：长句压成一条整体建出来，别让用户白说一场；
  // 追问状态下的任何非问句都按「没说要补充，就算另一件事」处理。问题类句子不建任务。
  if (!actions && !isQuestion(latest.content)) {
    const title =
      parseLongStatementTitle(latest.content) ??
      (pending ? latest.content.trim().slice(0, 200) : null);
    if (title) actions = [{ type: "create", title }];
  }
  if (!actions) actions = [{ type: "ask", question: FALLBACK_QUESTION }];

  const results = executeActions(tasks, actions);
  const created = results.filter((result) => result.action.type === "create" && result.task);
  // 新任务如果落在有日程的日子上，顺手提醒一句，免得排重了
  const busyNote = created
    .map((result) =>
      typeof result.task?.dueAt === "string" ? calendarNote(result.task.dueAt) : "",
    )
    .filter(Boolean)
    .join("");
  const answer = formatResults(results, tasks.list()) + busyNote;

  if (created.length === 1) {
    const title = created[0].task?.title;
    // 追问被打断时说明一句，免得用户以为刚才那条被改了
    if (title && pending) {
      return (
        `这看着是另一件事，我新建了「${title}」，上面那条「${pending.title}」没动。\n\n${answer}` +
        detailPrompt(title)
      );
    }
    if (title) return answer + detailPrompt(title);
  }
  return answer;
}

const QUESTION_RE = /[？?]\s*$|^(?:为什么|怎么|多少|几点|什么|谁|哪里|哪个|是不是|能不能)/;

function isQuestion(text: string): boolean {
  return QUESTION_RE.test(text.trim());
}
