import type { ChatMessage } from "../../shared/chat.ts";
import type { Task } from "../task-store.ts";
import { parseDueTime, statedDay } from "./date.ts";

// 追问语里必须带这个标记，下一轮才认得出「这句是在回答备注」。
// 兼容旧文案「补充细节吗」，避免升级前留下的对话被当成另一件事。
const DETAIL_MARKERS = ["备注说明", "补充细节吗"];
const PROMPT_RE = /给「(.+?)」(?:备注说明|补充细节吗)/;
const NO_DETAIL_RE =
  /^(?:没有|不用|不要|不需要|不必|算了|就这些|没了|无|不补充|不用补充|ok|OK|好的|好)[。！!,.，\s]*$/;

// 明确表示「要补充」的说法。只有这类回答才会写进上一条任务的细节里。
// 注意不能用「有」这种宽泛开头：「有哪些到期了」会被误判成要补充。
const AGREE_THEN_RE = /^(?:嗯+|对|是的?|可以|补充|加上)[：:，,、\s]+(.+)$/;
const AGREE_WITH_CONTENT_RE = /^(?:要|需要)(?:补充|加上)?[：:，,、\s]*(.+)$/;
const AGREE_BARE_RE = /^(?:嗯+|对|是的?|可以|要|需要|补充吧?|加上吧?)[。！!，,\s]*$/;

export type DetailAnswer =
  | { kind: "none" } // 不用补充
  | { kind: "agree"; text: string } // 要补充，且已经说了内容
  | { kind: "ask" } // 要补充，但还没说内容
  | { kind: "other"; text: string }; // 没说要补充 —— 按另一件事处理

export function detailPrompt(title: string): string {
  return `\n\n需要给「${title}」备注说明吗？`;
}

// 追问内容缺失时的追问语，带同样的标记，保证下一轮仍能认出是在等备注
export function detailContentPrompt(title: string): string {
  return `好，要给「${title}」备注说明什么？直接说内容就行。`;
}

export function pendingDetailTask(messages: ChatMessage[], tasks: Task[]): Task | undefined {
  const previous = messages.at(-2);
  if (!previous || previous.role !== "assistant") return undefined;
  if (!DETAIL_MARKERS.some((marker) => previous.content.includes(marker))) return undefined;

  const matched = previous.content.match(PROMPT_RE);
  if (!matched) return undefined;

  return [...tasks].reverse().find((task) => task.title === matched[1]);
}

export function isNoDetailAnswer(text: string): boolean {
  return NO_DETAIL_RE.test(text.trim());
}

// 追问的下一句到底是「补充细节」还是「另一件事」：
// 只有明确说要补充（要 / 需要 / 嗯 / 可以 …）才算细节，其余一律按新待办处理。
export function parseDetailAnswer(text: string): DetailAnswer {
  const message = text.trim();
  if (NO_DETAIL_RE.test(message)) return { kind: "none" };

  const then = message.match(AGREE_THEN_RE);
  if (then?.[1]) return { kind: "agree", text: then[1].trim() };

  const withContent = message.match(AGREE_WITH_CONTENT_RE);
  if (withContent?.[1]) return { kind: "agree", text: withContent[1].trim() };

  if (AGREE_BARE_RE.test(message)) return { kind: "ask" };

  return { kind: "other", text: message };
}

// ---- 时间追问：任务先记下来，再问哪天完成 ----

const DUE_MARKER = "哪天完成";
const DUE_PROMPT_RE = /「(.+?)」哪天完成/;
const DUE_NONE_RE = /^(?:不用|不用了|就今天|今天吧|没定|不确定|算了|没有|随便|都行)[。！!，,\s]*$/;

export function duePrompt(title: string): string {
  return `\n\n「${title}」哪天完成？`;
}

export function pendingDueTask(messages: ChatMessage[], tasks: Task[]): Task | undefined {
  const previous = messages.at(-2);
  if (!previous || previous.role !== "assistant") return undefined;
  if (!previous.content.includes(DUE_MARKER)) return undefined;

  const matched = previous.content.match(DUE_PROMPT_RE);
  if (!matched) return undefined;

  return [...tasks].reverse().find((task) => task.title === matched[1]);
}

export type DueAnswer =
  | { kind: "date"; date: string; time?: string } // 说清了哪天（可能还带了时刻）
  | { kind: "today"; time?: string } // 不打算挑日子，就按今天（含只说了时段的情况）
  | { kind: "other"; text: string }; // 说的是别的事

// 把日期词、时段词、钟点从一句里摘干净，剩下的才是「事情」。
// 剩下为空，说明这句就是在交代时间，不是另一件事。
const TIME_WORD_RE =
  /(?:\d{1,2}|[一二三四五六七八九十]{1,2})\s*[点时](?:半|\d{1,2}分)?|凌晨|清晨|早晨|早上|上午|中午|午后|下午|傍晚|晚上|夜里|今晚|今早|今夜|明早|明晚|明夜|今天|今日|明天|明日|后天|大后天|周末|(?:这|本|下|下下)?(?:周|星期)[一二三四五六日天]?|(?:这|本|下|下下)个?月(?:初|底|末|中)?|(?:本|这个)?月[底末初]/g;

function timeOnlyRest(message: string): string {
  return message
    .replace(TIME_WORD_RE, "")
    .replace(/[，,。.！!？?；;、\s]/g, "")
    .replace(/^(?:就|在|到|定在|改到|改成|设为|是)/, "")
    .replace(/(?:完成|做完|搞定|办完|吧|了|呀|哈)$/, "")
    .replace(/(?:之前|以前|内|以内|前|截止)$/, "");
}

export function parseDueAnswer(text: string): DueAnswer {
  const message = text.trim();
  if (DUE_NONE_RE.test(message)) return { kind: "today" };

  const day = statedDay(message);
  if (day) {
    // 只有「整句就是在说时间」才算回答；「我明天得准备面试材料」是新任务
    if (timeOnlyRest(message) !== "") return { kind: "other", text: message };
    const clock = parseDueTime(message);
    return clock ? { kind: "date", date: day, time: clock.time } : { kind: "date", date: day };
  }

  // 只给了钟点、没说哪一天（「三点」）：按当天算，时刻一并记下
  const clock = parseDueTime(message);
  if (clock && timeOnlyRest(message) === "") return { kind: "today", time: clock.time };
  return { kind: "other", text: message };
}
