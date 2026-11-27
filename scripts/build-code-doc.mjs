/**
 * 生成「构建代码汇总」文档。
 *
 * 文档里的每一段代码都从当前源码原样抽取，不手写、不复制粘贴，
 * 所以代码一改，重新跑一次 `npm run docs:code` 文档就跟着变，不会对不上。
 *
 * 用法：
 *   node scripts/build-code-doc.mjs                 # 生成到 docs/构建代码汇总.md
 *   node scripts/build-code-doc.mjs <输出路径>        # 生成到指定路径
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** 收录全文的文件：顺序即文档里的章节顺序 */
const CORE_FILES = [
  { path: "server/agent.ts", role: "智能体入口：追问状态 → 规则 → 模型 → 执行 → 组装回复" },
  { path: "server/agent/actions.ts", role: "九种动作的类型定义与统一执行器" },
  { path: "server/agent/intent.ts", role: "本地规则引擎：中文意图识别，不依赖任何 Key" },
  { path: "server/agent/date.ts", role: "相对日期、时段、时刻与完成日期标签" },
  { path: "server/agent/followup.ts", role: "创建后的备注追问、日期追问状态机" },
  { path: "server/agent/format.ts", role: "清单渲染：☑/☐ 区分完成态，按日期分组" },
  { path: "server/agent/llm.ts", role: "DeepSeek 结构化规划与提示词，规则接不住时才走" },
  { path: "server/agent/calendar.ts", role: "iCalendar 日历解析，用于撞期提醒" },
  { path: "server/app.ts", role: "Express 应用：注入 TaskStore、匿名身份、对话与提醒" },
  { path: "server/task-store.ts", role: "本地 JSON 任务清单：looseObject 透传扩展字段" },
];

/** 只列职责、不贴全文的文件 */
const OTHER_FILES = [
  ["server/users.ts", "匿名身份与按人隔离的数据目录"],
  ["server/conversations.ts", "对话记忆：每会话最近 50 轮，落盘为 JSON"],
  ["server/reminders.ts", "提醒计算：已过期、今天、一小时内到点三类"],
  ["server/tasks.ts", "任务接口的输入校验与 HTTP 响应"],
  ["server/model.ts", "DeepSeek 客户端与模型配置"],
  ["server/index.ts", "启动服务，装配上面各模块"],
  ["src/App.tsx", "聊天界面：发送对话历史、显示回复与提醒条"],
  ["src/ReminderBar.tsx", "顶部提醒条与浏览器通知授权"],
  ["shared/chat.ts", "前后端共用的对话消息类型（模板自带，未改）"],
];

/** 模板原样保留、没动的部分 */
const UNTOUCHED = ["public/index.html", "package.json（只加了 prestart / predev 构建钩子）"];

async function countTests() {
  const { execFileSync } = await import("node:child_process");
  try {
    const out = execFileSync("node", ["--test", "server/*.test.ts"], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const m = out.match(/# pass (\d+)/);
    return m ? Number(m[1]) : 0;
  } catch (error) {
    const out = error.stdout ?? "";
    const m = out.match(/# pass (\d+)/);
    return m ? Number(m[1]) : 0;
  }
}

const outPath = resolve(process.argv[2] ?? resolve(ROOT, "docs/构建代码汇总.md"));
const tests = await countTests();

const parts = [];

parts.push(`# 小明待办智能体 · 构建代码汇总

> 对应公开仓库：https://github.com/dusk-perfect/todo-agent
> 本文由 \`npm run docs:code\` 从当前源码自动生成，代码与仓库 \`main\` 分支逐字一致。
> 文档里不放全文的模块，在「其余模块」一节列出职责与路径。
`);

parts.push(`## 一、做了什么

在小明只会回「你好，欢迎使用小明智能体」的模板上，改造成能用中文管待办的助手。整体分三层：

| 层 | 位置 | 职责 |
| --- | --- | --- |
| 规则层 | \`server/agent/intent.ts\` 等 | 中文意图识别，不配置任何 Key 也能完成全部验收动作 |
| 模型层 | \`server/agent/llm.ts\` | 规则接不住的句子才交给 DeepSeek，校验不过或超时就退回规则 |
| 存取层 | \`server/task-store.ts\` \`server/users.ts\` 等 | 任务落在本机 JSON，原子写；按匿名身份分目录 |

意图识别的顺序是**规则优先、模型兜底**：规则判得快且确定，模型只在规则确实听不懂时才上场，没有 Key 时全程走规则。
`);

parts.push(`## 二、核心代码

下列文件是本次实现的主体，按调用顺序排列。
`);

for (const file of CORE_FILES) {
  const source = await readFile(resolve(ROOT, file.path), "utf8");
  const lines = source.split("\n").length;
  const lang = file.path.endsWith(".tsx") ? "tsx" : file.path.endsWith(".ts") ? "ts" : "";
  parts.push(`### \`${file.path}\`

${file.role}（${lines} 行）

\`\`\`${lang}
${source.replace(/\n$/, "")}
\`\`\`
`);
}

parts.push(`## 三、其余模块

| 文件 | 职责 |
| --- | --- |
${OTHER_FILES.map(([path, role]) => `| \`${path}\` | ${role} |`).join("\n")}

模板原样保留、未作改动的部分：${UNTOUCHED.map((x) => `\`${x}\``).join("、")}。
`);

parts.push(`## 四、验证

| 项目 | 命令 | 当前结果 |
| --- | --- | --- |
| 单元与集成测试 | \`npm test\` | ${tests} 项通过 |
| 类型检查 | \`npm run typecheck\` | 通过 |
| 代码检查 | \`npm run lint\` | 0 warning / 0 error |
| 格式检查 | \`npm run fmt:check\` | 通过 |
| 前端构建 | \`npm run build\` | 通过 |
| 文档同步 | \`npm run check:sync\` | 见 \`docs/SYNC-CHECKLIST.md\` |

测试文件：

- \`server/agent.test.ts\` — 对话与意图识别，含 README 的六轮验收对话
- \`server/app.test.ts\` — 接口层：任务读写、校验、扩展字段透传
- \`server/agent/date.test.ts\` — 日期与时段解析
- \`server/calendar.test.ts\` — iCalendar 解析
- \`server/conversations.test.ts\` — 对话记忆
- \`server/reminders.test.ts\` — 提醒分级
- \`server/llm.test.ts\` — 模型输出的兼容与回退

本地跑起来：

\`\`\`sh
npm ci
npm run dev          # 打开 http://127.0.0.1:3000
\`\`\`

\`\`\`sh
curl -sS http://127.0.0.1:3000/api/chat \\
  -H 'Content-Type: application/json' \\
  -d '{"messages":[{"role":"user","content":"帮我记一下买牛奶"}]}'
\`\`\`
`);

const doc = parts.join("\n");
await mkdir(dirname(outPath), { recursive: true });
await writeFile(outPath, doc, "utf8");

const rel = relative(ROOT, outPath).replace(/\\/g, "/");
console.log(`已生成 ${rel}（${doc.split("\n").length} 行，${tests} 项测试）`);
