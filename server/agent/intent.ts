import type { Task } from "../task-store.ts";
import type { Action } from "./actions.ts";
import { daysFromToday, parseDueDate } from "./date.ts";

const CREATE_PATTERNS = [
  /帮我记一下(.+)/,
  /帮我记下(.+)/,
  /帮我记(.+)/,
  /记一下(.+)/,
  /记下(.+)/,
  /再记一条(.+)/,
  /记一条(.+)/,
  /再记(.+)/,
  /加一条(.+)/,
  /添加(?:一条|一个)?(?:待办|任务)?(.+)/,
  /新增(?:一条|一个)?(?:待办|任务)?(.+)/,
  /新建(?:一条|一个)?(?:待办|任务)?(.+)/,
  /创建(?:一条|一个)?(?:待办|任务)?(.+)/,
  /提醒我(.+)/,
];

// 陈述式表达不靠列举具体动作（取快递 / 还书 / 遛狗…永远列不全），
// 而是剥掉「主语 + 时间 + 意愿词 + 去」这些封闭的前缀，剩下的就是事情本身。
// 任务内容可以是任意说法，只要前缀被削掉就能拿到标题。
const SUBJECT_PREFIX_RE = /^(?:我|俺|咱)(?:们)?/;
const TIME_PREFIX_RE =
  /^(?:(?:[0-9]{1,2}|[一二三四五六七八九十]{1,3})(?:点|点钟|时)(?:半|[0-9]{1,2}分)?|现在|今天|明天|后天|大后天|今晚|明早|明晚|马上|立刻|待会(?:儿)?|等会(?:儿)?|一会儿|晚点|回头|下午|上午|晚上|早上|中午|(?:这|本|下|下下)?(?:周|星期)[一二三四五六日天末]|(?:这|本|下|下下)?(?:周|星期)|(?:这|本|下|下下)个?月(?:初|底|中)?|月初|月底|周末前)/;
// 助动词和「准备/打算」要分开：「我要准备面试」里的准备才是事情本身，
// 「我准备预约体检」里的准备只是意愿，早了会削掉真正的动作。
const AUX_PREFIX_RE = /^(?:还)?(?:要|得|需要|必须|应该|想)/;
const PLAN_PREFIX_RE = /^(?:准备|打算|计划)/;
const ADV_PREFIX_RE = /^(?:先|再|赶紧|尽快|抓紧|顺手|就)/;
// 「这周五之前要…」「月底前得…」里的「之前/以前」是时间后缀，不是事情本身
const DEADLINE_SUFFIX_RE = /^(?:之前|以前|前|之内|以内)/;
const GO_PREFIX_RE = /^(?:去|来)(?:一趟|一下|一回|趟|个)?/;

const DELETE_RE = /(删掉|删除|去掉|移除|清掉|不要了|取消掉|撤掉|删了)/;
const COMPLETE_RE = /(好了|完成了|做完|搞定|弄好|办完|结束了)/;
const REOPEN_RE = /(没做完|还没完成|未完成|取消完成|重新打开|标记未完成)/;
const RENAME_RE = /(?:改名叫|改名为|重命名为|改成)(.+)/;
const LIST_RE = /(有哪些|有什么|看看|看一下|列一下|列出|清单|待办|任务|都要做|还需|还剩)/;
const DUE_QUERY_RE = /(?:到期|截止)/;
const DUE_QUERY_MARKER = /(?:有哪些|有什么|哪些|看看|查一下|列一下|清单|任务)/;
const SET_PRIORITY_RE = /(.+?)(?:设为|设成|改成|标为|定为|弄成|设置|调成)(高|中|低)优先级/;
const SET_ESTIMATE_RE = /(.+?)(?:设为|设成|改成|标为|定为|弄成|设置|调成)(大|中|小)工作量/;
const SET_DUE_RES = [
  /(.+?)(?:的)?(?:截止日期|到期日期|截止时间|截止|到期)(?:改成|设为|是)?(今天|今日|明天|明日|后天|大后天|\d{1,2}月\d{1,2}[日号]?)/,
  /(.+?)(今天|今日|明天|明日|后天|大后天|\d{1,2}月\d{1,2}[日号]?)(?:到期|截止)/,
];

const PRIORITY = { 高: "high", 中: "medium", 低: "low" } as const;
const ESTIMATE = { 大: "large", 中: "medium", 小: "small" } as const;

function normalize(text: string): string {
  return text
    .replace(/[\s，。！？、；：,.!?;:]/g, "")
    .replace(/(这条|那个|这个|一件|一下|这个任务|这条任务)/g, "");
}

function longestCommonSubstring(a: string, b: string): string {
  let best = "";
  let previous = Array.from({ length: b.length + 1 }, () => 0);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [0];
    for (let j = 1; j <= b.length; j += 1) {
      if (a[i - 1] === b[j - 1]) {
        current[j] = previous[j - 1] + 1;
        if (current[j] > best.length) best = a.slice(i - current[j], i);
      } else {
        current[j] = 0;
      }
    }
    previous = current;
  }
  return best;
}

function referenceScore(message: string, title: string): number {
  const m = normalize(message);
  const t = normalize(title);
  if (!m || !t) return 0;
  if (m === t) return 1;
  if (m.includes(t)) return 0.95;
  const common = longestCommonSubstring(m, t);
  if (common.length < 2) return 0;
  return 0.5 + (0.4 * common.length) / Math.min(m.length, t.length);
}

interface TaskMatch {
  task?: Task;
  candidates: Task[];
  ambiguous: boolean;
}

function findTask(message: string, tasks: Task[]): TaskMatch {
  const ranked = tasks
    .map((task) => ({ task, score: referenceScore(message, task.title) }))
    .filter((entry) => entry.score >= 0.5)
    .sort((a, b) => b.score - a.score);

  if (ranked.length === 0) return { candidates: [], ambiguous: false };
  if (ranked.length > 1 && ranked[0].score - ranked[1].score < 0.05) {
    return { candidates: ranked.slice(0, 3).map((entry) => entry.task), ambiguous: true };
  }
  return { task: ranked[0].task, candidates: [ranked[0].task], ambiguous: false };
}

function cleanTitle(raw: string): string {
  return raw
    .trim()
    .replace(/^(?:一下|一条|一个|一件|把|吧|呢|啊|哦|哈)+/, "")
    .replace(/(?:吧|呢|啊|哦|哈|呀)+$/, "")
    .replace(/^(?:的|了)+/, "")
    .trim();
}

function splitTitles(raw: string): string[] {
  const text = raw.trim();
  if (!text) return [];

  // 长句不按标点硬拆：拆错的代价（好几条垃圾任务）比不拆大。
  // 短句才按「和/、/再/然后」拆成多条。
  if (text.length > 16) {
    const head = text.split(/[，,；;。]/)[0] ?? text;
    const title = cleanTitle(head);
    return title ? [title] : [];
  }

  return text
    .split(/\s*(?:和|以及|、|,|，|;|；|然后|还有|顺便)\s*/)
    .map(cleanTitle)
    .filter((title) => title.length > 0);
}

// 「我现在要去取快递」→ 取快递；「这周末要给车做保养」→ 给车做保养。
// 必须削掉过意愿词（要/得/需要/准备…）才算陈述式任务，否则「今天天气怎么样」也会被当成任务。
function statementTitle(message: string): string | null {
  let rest = message.trim();
  const subject = rest.match(SUBJECT_PREFIX_RE);
  if (subject) rest = rest.slice(subject[0].length);

  let sawModal = false;
  for (;;) {
    const before = rest;
    rest = rest.replace(TIME_PREFIX_RE, "");

    const aux = rest.match(AUX_PREFIX_RE);
    if (aux) {
      sawModal = true;
      rest = rest.slice(aux[0].length);
    } else if (!sawModal) {
      // 「准备/打算」只有出现在助动词之前才算意愿词
      const plan = rest.match(PLAN_PREFIX_RE);
      if (plan) {
        sawModal = true;
        rest = rest.slice(plan[0].length);
      }
    }

    rest = rest.replace(DEADLINE_SUFFIX_RE, "");
    rest = rest.replace(ADV_PREFIX_RE, "");
    rest = rest.replace(GO_PREFIX_RE, "");
    if (rest === before) break;
  }

  if (!sawModal) return null;
  rest = rest
    .replace(/^[，,、：:\s]+/, "")
    .replace(/[，,、：:。.]+$/, "")
    .replace(/(?:了|啦)+$/, "");
  return rest.length >= 2 ? rest : null;
}

interface Attributes extends Record<string, unknown> {
  priority?: string;
  estimate?: string;
  dueAt?: string;
}

// 「今天内完成」「明天之前搞定」是整句的截止说明，不是第二件事。
// 判断标准：这一小句去掉日期、范围词和完成动词后什么都不剩。
const DEADLINE_RANGE_RE = /^(?:之内|以内|内|之前|以前|前)/;
const DEADLINE_VERB_RE = /(?:完成|做完|搞定|弄完|弄好|办完)$/;

function deadlineSegment(segment: string): string | null {
  const due = parseDueDate(segment);
  if (!due) return null;
  const left = segment
    .replace(due.matched, "")
    .replace(/[，,。.；;、\s]/g, "")
    .replace(DEADLINE_RANGE_RE, "")
    .replace(DEADLINE_VERB_RE, "");
  return left === "" ? due.date : null;
}

function stripDeadlineSegments(text: string): { rest: string; dueAt?: string } {
  const chunks = text.split(/([，,；;。])/);
  let dueAt: string | undefined;
  const kept: string[] = [];
  for (const chunk of chunks) {
    if (/^[，,；;。]$/.test(chunk)) {
      kept.push(chunk);
      continue;
    }
    const due = deadlineSegment(chunk.trim());
    if (due) {
      dueAt = due;
      continue;
    }
    kept.push(chunk);
  }
  return { rest: kept.join("").replace(/[，,；;。]{2,}/g, "，"), dueAt };
}

function extractAttributes(text: string): { rest: string; attrs: Attributes } {
  let rest = text;
  const attrs: Attributes = {};

  const stripped = stripDeadlineSegments(rest);
  if (stripped.dueAt) attrs.dueAt = stripped.dueAt;
  rest = stripped.rest;

  const priority = rest.match(/(高|中|低)优先级|优先级(高|中|低)|(?:标成|设成|定为)(高|中|低)/);
  if (priority) {
    attrs.priority = PRIORITY[(priority[1] ?? priority[2] ?? "中") as keyof typeof PRIORITY];
    rest = rest.replace(priority[0], "");
  }

  const estimate = rest.match(
    /(大|中|小)工作量|工作量(大|中|小)|(?:标成|设成|定为)(大|中|小)工作量/,
  );
  if (estimate) {
    attrs.estimate = ESTIMATE[(estimate[1] ?? estimate[2] ?? "中") as keyof typeof ESTIMATE];
    rest = rest.replace(estimate[0], "");
  }

  const due = parseDueDate(rest);
  if (due) {
    // 「今天内完成」已经给出过截止日，正文里的日期不再覆盖它
    attrs.dueAt ??= due.date;
    rest = rest.replace(due.matched, "");
  }

  rest = rest.replace(/(?:到期|截止|之前)/g, "");
  return { rest, attrs };
}

// 「把X设为…」这类改属性的说法，前面的 X 必须是短引用。
// 否则「下个月初得把房租交了，别忘了设成高优先级」会被当成改属性，答成「没找到任务」。
function isCleanReference(reference: string): boolean {
  const text = reference.trim();
  return text.length > 0 && text.length <= 12 && !/[，,；;。]/.test(text);
}

function notFound(): Action[] {
  return [
    { type: "ask", question: "没找到对应的任务。你可以说「看看清单」确认一下当前有哪些任务。" },
  ];
}

type MatchScope = "pending" | "done" | "any";

function withTask(
  message: string,
  tasks: Task[],
  build: (id: string) => Action,
  scope: MatchScope = "any",
): Action[] {
  const reference = cleanTitle(
    message
      .replace(DELETE_RE, "")
      .replace(REOPEN_RE, "")
      .replace(COMPLETE_RE, "")
      .replace(RENAME_RE, ""),
  );
  let match = findTask(reference, tasks);
  // 只说了「这个」「它」这类指代，没有可匹配的标题时，退到按状态找唯一候选
  if (!match.task && !match.ambiguous && normalize(reference).length < 2) {
    const pool =
      scope === "pending"
        ? tasks.filter((task) => !task.done)
        : scope === "done"
          ? tasks.filter((task) => task.done)
          : tasks;
    match =
      pool.length > 1
        ? { candidates: pool, ambiguous: true }
        : { task: pool[0], candidates: pool, ambiguous: false };
  }
  if (match.ambiguous) {
    const options = match.candidates.map((task, index) => `${index + 1}. ${task.title}`).join("；");
    return [{ type: "ask", question: `有几条任务比较像，你说的是哪一个？${options}` }];
  }
  if (!match.task) return notFound();
  return [build(match.task.id)];
}

export const FALLBACK_QUESTION =
  "我可以帮你记待办、看清单、标记完成或删除任务。比如试试说「帮我记一下买牛奶」。";

// 返回 null 表示规则引擎没听懂，交给上层决定是否问模型。
export function parseRuleActions(text: string, tasks: Task[]): Action[] | null {
  const message = text.trim();

  for (const pattern of CREATE_PATTERNS) {
    const matched = message.match(pattern);
    if (matched) {
      const { rest, attrs } = extractAttributes(matched[1]);
      const titles = splitTitles(rest);
      if (titles.some((title) => title.length > 200)) {
        return [{ type: "ask", question: "任务标题请控制在 200 字以内。" }];
      }
      if (titles.length > 0) {
        return titles.map((title) => ({ type: "create", title, fields: attrs }));
      }
    }
  }

  const setPriority = message.match(SET_PRIORITY_RE);
  if (setPriority && isCleanReference(setPriority[1])) {
    const fields = { priority: PRIORITY[setPriority[2] as keyof typeof PRIORITY] };
    return withTask(setPriority[1], tasks, (id) => ({ type: "setAttrs", id, fields }));
  }

  const setEstimate = message.match(SET_ESTIMATE_RE);
  if (setEstimate && isCleanReference(setEstimate[1])) {
    const fields = { estimate: ESTIMATE[setEstimate[2] as keyof typeof ESTIMATE] };
    return withTask(setEstimate[1], tasks, (id) => ({ type: "setAttrs", id, fields }));
  }

  for (const pattern of SET_DUE_RES) {
    const matched = message.match(pattern);
    if (matched) {
      const due = parseDueDate(matched[2] ?? "");
      if (due && isCleanReference(matched[1] ?? "")) {
        return withTask(matched[1] ?? "", tasks, (id) => ({
          type: "setAttrs",
          id,
          fields: { dueAt: due.date },
        }));
      }
    }
  }

  if (DUE_QUERY_RE.test(message)) {
    const due = parseDueDate(message);
    if (due) return [{ type: "due", date: due.date }];
    // 只问了「有哪些到期」没说哪一天时，按今天算，避免退化成普通清单
    if (DUE_QUERY_MARKER.test(message)) return [{ type: "due", date: daysFromToday(0) }];
  }

  const rename = message.match(RENAME_RE);
  if (rename) {
    const title = cleanTitle(rename[1]);
    if (title) return withTask(message, tasks, (id) => ({ type: "rename", id, title }));
  }

  if (DELETE_RE.test(message)) {
    return withTask(message, tasks, (id) => ({ type: "delete", id }));
  }

  if (REOPEN_RE.test(message)) {
    return withTask(message, tasks, (id) => ({ type: "reopen", id }), "done");
  }

  if (COMPLETE_RE.test(message)) {
    return withTask(message, tasks, (id) => ({ type: "complete", id }), "pending");
  }

  if (LIST_RE.test(message)) {
    return [{ type: "list" }];
  }

  // 「我现在要去取快递」「这周末要给车做保养」这类陈述句不带动作词，
  // 但意图就是新增待办；放在最后判断，避免抢掉前面的查询与属性指令。
  const statement = statementTitle(message);
  // 长复合句（多个小句、多个动作）拆起来歧义大，交给模型判断；
  // 规则只保留 parseLongStatementTitle 作为没有模型时的退路。
  if (statement && !isCompoundStatement(message)) {
    const { rest, attrs } = extractAttributes(statement);
    const due = parseDueDate(rest) ?? parseDueDate(message);
    const titles = splitTitles(rest);
    if (titles.length > 0 && titles.every((title) => title.length <= 200)) {
      return titles.map((title) => ({
        type: "create",
        title,
        fields: due ? { ...attrs, dueAt: due.date } : attrs,
      }));
    }
  }

  return null;
}

// 一句话里有多个小句、多件事时，规则不硬拆，交给模型
function isCompoundStatement(message: string): boolean {
  if (message.length <= 16) return false;
  return /[，,；;]/.test(message) || /(?:然后|接着|另外|顺便)/.test(message);
}

// 没有模型时的退路：把长句压成一个标题，也不至于一条都建不出来
export function parseLongStatementTitle(message: string): string | null {
  const statement = statementTitle(message);
  if (!statement) return null;
  const { rest } = extractAttributes(statement);
  const titles = splitTitles(rest);
  return titles[0] ?? null;
}
