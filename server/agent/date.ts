export function localDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function daysFromToday(offset: number): string {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + offset);
  return localDate(date);
}

export interface DueMatch {
  date: string;
  matched: string;
}

// 只说明一天里的哪个时段、不跨天的词：说了它们就是在说当天。
const DAY_PERIOD_RE = /凌晨|清晨|早晨|早上|上午|中午|午后|下午|傍晚|晚上|夜里/;

export function mentionsDayPeriod(text: string): boolean {
  return DAY_PERIOD_RE.test(text);
}

// 一句话里「指定了哪一天」，只用来决定记到哪天，不动标题原文。
// 与 parseDueDate 的区别：后者的匹配串会从标题里删掉，而「今晚」「明早」删了标题就少信息，
// 所以这类词只在这里取日期，不进 parseDueDate。
export function statedDay(text: string): string | null {
  const due = parseDueDate(text);
  if (due) return due.date;
  if (/今晚|今早|今夜/.test(text)) return daysFromToday(0);
  if (/明早|明晚|明夜/.test(text)) return daysFromToday(1);
  if (mentionsDayPeriod(text)) return daysFromToday(0);
  return null;
}

export function parseDueDate(text: string): DueMatch | null {
  const relative: Array<[RegExp, number]> = [
    [/大后天/, 3],
    [/后天/, 2],
    [/明天|明日/, 1],
    [/今天|今日/, 0],
  ];
  for (const [pattern, offset] of relative) {
    const matched = text.match(pattern);
    if (matched) return { date: daysFromToday(offset), matched: matched[0] };
  }

  // 「周末」按真实日历落到最近的周六；已经到周末就算当天
  const weekend = text.match(/(下下|下|这|本)?周末/);
  if (weekend) {
    const weeks = weekend[1] === "下下" ? 2 : weekend[1] === "下" ? 1 : 0;
    const today = new Date().getDay();
    const delta = (today === 6 || today === 0 ? 0 : 6 - today) + weeks * 7;
    return { date: daysFromToday(delta), matched: weekend[0] };
  }

  const weekday = text.match(/(下下|下|这|本)?(?:周|星期)([一二三四五六日天])/);
  if (weekday) {
    const target = "一二三四五六日天".indexOf(weekday[2] ?? "");
    const today = new Date().getDay();
    const current = today === 0 ? 6 : today - 1;
    const weeks = weekday[1] === "下下" ? 2 : weekday[1] === "下" ? 1 : 0;
    let delta: number;
    if (weeks > 0) {
      // 「下周X」「下下周X」都从本周周一起算，避免在已跨周的结果上再加七天
      delta = 7 * weeks - current + target;
    } else {
      delta = (target - current + 7) % 7;
      // 「这周五」就是本周那天，当天也算；只说「周五」才顺延到下一个
      const thisWeek = weekday[1] === "这" || weekday[1] === "本";
      if (delta === 0 && !thisWeek) delta = 7;
    }
    return { date: daysFromToday(delta), matched: weekday[0] };
  }

  // 「月底/下个月初」这类说法按真实日历落到当月最后一天或下月一号。
  // 必须带「月」字：「彻底打扫」里的「底」不是月底。
  const monthEdge = text.match(/下个?月(底|末|初)/) ?? text.match(/(?:本|这个)?月(底|末|初)/);
  if (monthEdge) {
    const now = new Date();
    const isNext = text.includes("下个月") || text.includes("下月");
    const offset = isNext ? 1 : 0;
    const unit = monthEdge[1];
    const first = new Date(now.getFullYear(), now.getMonth() + offset, 1);
    let date = unit === "初" ? first : new Date(now.getFullYear(), now.getMonth() + offset + 1, 0);
    // 「月初」已经过去就顺延到下个月一号，不记一个过期的时间
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (unit === "初" && date < today) {
      date = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    }
    return { date: localDate(date), matched: monthEdge[0] };
  }

  const monthDay = text.match(/(\d{1,2})月(\d{1,2})[日号]?/);
  if (monthDay) {
    const month = Number(monthDay[1]);
    const day = Number(monthDay[2]);
    const now = new Date();
    let year = now.getFullYear();
    const candidate = new Date(year, month - 1, day);
    if (candidate < new Date(now.getFullYear(), now.getMonth(), now.getDate())) year += 1;
    return { date: localDate(new Date(year, month - 1, day)), matched: monthDay[0] };
  }

  return null;
}

// 日期只写数字，跨年才带年份
export function shortDate(date: string): string {
  const matched = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!matched) return date;
  return Number(matched[1]) === new Date().getFullYear() ? `${matched[2]}-${matched[3]}` : date;
}

// 期限统一说成「11-28 内完成」：日期在前，不同日期的待办一眼分得清
export function dueBadge(date: string): string {
  return `${shortDate(date)} 内完成`;
}

const CN_DIGIT: Record<string, number> = {
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
  十: 10,
};
// 时段词把 12 小时制折算成 24 小时制；凌晨/早上/上午保持原值
const NOON_PERIODS = new Set(["中午", "下午", "傍晚", "晚上"]);

function toHour(raw: string): number | null {
  if (/^\d{1,2}$/.test(raw)) return Number(raw);
  if (raw === "十一") return 11;
  if (raw === "十二") return 12;
  return CN_DIGIT[raw] ?? null;
}

// 从原话里单独取出时刻，写进 dueTime，用来做提醒。
// 标题里仍然保留「下午三点」，这里只是额外记一份结构化的时间。
export function parseDueTime(text: string): { time: string; matched: string } | null {
  const matched = text.match(
    /(上午|早上|凌晨|中午|下午|傍晚|晚上)?\s*(\d{1,2}|[一二三四五六七八九十]{1,2})\s*[点时](半|\d{1,2}分)?/,
  );
  if (!matched?.[2]) return null;

  const period = matched[1];
  let hour = toHour(matched[2]);
  if (hour === null) return null;

  if (period && NOON_PERIODS.has(period) && hour < 12) hour += 12;
  // 「三点开会」这种没有时段词的说法，口语里通常指下午，1-6 点按下午折算
  if (!period && hour >= 1 && hour <= 6) hour += 12;
  if (hour > 23) return null;

  const suffix = matched[3];
  const minute = suffix === "半" ? 30 : suffix ? Number(suffix.replace("分", "")) : 0;
  if (!Number.isFinite(minute) || minute > 59) return null;

  return {
    time: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
    matched: matched[0].trim(),
  };
}
