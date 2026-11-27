import type { ChatMessage } from "../../shared/chat.ts";
import type { Task } from "../task-store.ts";

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
