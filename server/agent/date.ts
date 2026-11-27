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
