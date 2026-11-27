/**
 * 文档同步校验。
 *
 * 目的：改完代码以后，一条命令就能看出「哪些文档跟不上了」，
 * 而不是靠人肉逐份对照。检查项见 docs/SYNC-CHECKLIST.md。
 *
 * 用法：
 *   node scripts/check-sync.mjs
 *   node scripts/check-sync.mjs --docx <路径>   # 额外校验工作目录里的 Word 提交件
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const results = [];

function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
}

function read(path) {
  return readFileSync(resolve(ROOT, path), "utf8");
}

/** 从 docx 里取正文段落纯文本 */
function docxParagraphs(docxPath) {
  let xml = "";
  try {
    xml = execFileSync("unzip", ["-p", docxPath, "word/document.xml"], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    xml = execFileSync("tar", ["-xOf", docxPath, "word/document.xml"], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
  }
  return xml
    .replace(/<w:p [^>]*>/g, "\n")
    .replace(/<w:p>/g, "\n")
    .replace(/<[^>]*>/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

/** 路径归一：去掉尾部斜杠，{id} 与 :id 互转 */
function normalizePath(path) {
  const trimmed = path.replace(/\/+$/, "");
  return trimmed.replace(/\{(\w+)\}/g, ":$1");
}

/** markdown 段落：去掉标题符号、加粗、列表符号 */
function mdParagraphs(md) {
  return md
    .split(/\n\s*\n/)
    .map((block) =>
      block
        .replace(/^#+\s*/gm, "")
        .replace(/\*\*/g, "")
        .replace(/^[-*]\s*/gm, "")
        .trim(),
    )
    .filter(Boolean);
}

// ── 1. 构建代码汇总里的代码块与源码逐字一致 ──────────────────────────
{
  const docPath = "docs/构建代码汇总.md";
  if (!existsSync(resolve(ROOT, docPath))) {
    check("构建代码汇总与源码一致", false, "文档不存在，跑 npm run docs:code");
  } else {
    const doc = read(docPath);
    const re = /### `([^`]+)`\n\n([^\n]*)\n\n```[a-z]*\n([\s\S]*?)\n```/g;
    let match;
    let mismatch = 0;
    let count = 0;
    while ((match = re.exec(doc)) !== null) {
      const [, file, , code] = match;
      count += 1;
      const source = readFileSync(resolve(ROOT, file), "utf8").replace(/\n$/, "");
      if (source !== code) {
        mismatch += 1;
        console.log(`    ↳ ${file} 与源码不一致`);
      }
    }
    check(
      "构建代码汇总与源码一致",
      mismatch === 0 && count > 0,
      `${count} 个文件${mismatch ? `，${mismatch} 个对不上` : "，逐字相同"}`,
    );
  }
}

// ── 2. README 接口一览 ↔ openapi.yaml ↔ app.ts 路由 ──────────────────
{
  const readme = read("README.md");
  const openapi = read("server/openapi.yaml");
  const app = read("server/app.ts");

  const readmePaths = new Set(
    [...readme.matchAll(/`(\/api\/[^`]*)`/g)].map((m) => normalizePath(m[1])),
  );
  readmePaths.delete("/api"); // README 里单独提到 /api 兜底，不是接口
  const yamlPaths = new Set(
    [...openapi.matchAll(/^  (\/api\/[^:]*):/gm)].map((m) => normalizePath(m[1])),
  );
  const appPaths = new Set([
    ...[...app.matchAll(/app\.(get|post|patch|delete)\("([^"]+)"/g)].map((m) =>
      normalizePath(m[2]),
    ),
    ...[...app.matchAll(/app\.use\(\s*"([^"]+)"/g)].map((m) => normalizePath(m[1])),
  ]);
  appPaths.delete("/assets/chat.js"); // 静态资源，不是接口
  // /api/tasks/{id} 由 taskRouter 内部挂载，路径要拼上前缀
  const taskRouter = read("server/tasks.ts");
  const routerPaths = new Set(
    [...taskRouter.matchAll(/router\.(get|post|patch|delete)\("([^"]*)"/g)].map((m) =>
      normalizePath(`/api/tasks${m[2]}`),
    ),
  );

  const all = new Set([...yamlPaths, ...appPaths, ...routerPaths]);
  const missingInCode = [...readmePaths].filter((p) => !all.has(p));
  const missingInReadme = [...all].filter(
    (p) => p !== "/api" && !readmePaths.has(p), // /api 是 404 兜底，不是接口
  );
  check(
    "README 接口一览 ↔ openapi.yaml ↔ 实际路由",
    missingInCode.length === 0 && missingInReadme.length === 0,
    missingInCode.length || missingInReadme.length
      ? `README 多:${missingInCode.join(",")} / README 缺:${missingInReadme.join(",")}`
      : `${all.size} 个接口对得上`,
  );
}

// ── 3. 文档里的关键常量与代码一致 ────────────────────────────────────
{
  const intent = read("server/agent/intent.ts");
  const model = read("server/model.ts");
  const submit = read("SUBMIT.md");
  const readme = read("README.md");

  const facts = [
    ["匹配打分 0.93", /0\.93/.test(intent), /0\.93/.test(submit)],
    ["匹配打分 0.95", /0\.95/.test(intent), /0\.95/.test(submit)],
    ["及格线 0.5", /score >= 0\.5/.test(intent), /0\.5/.test(submit)],
    ["分差 0.05 反问", /< 0\.05/.test(intent), /0\.05/.test(submit)],
    ["模型超时 15 秒", /timeout:\s*15000/.test(model), /15 秒/.test(readme)],
    ["模型不重试", /maxRetries:\s*0/.test(model), /不重试/.test(readme)],
    ["模型名 deepseek-flash", /deepseek-flash/.test(model), /deepseek-flash/.test(readme)],
  ];
  const bad = facts.filter(([, inCode, inDoc]) => !inCode || !inDoc);
  check(
    "关键常量在代码与文档里对得上",
    bad.length === 0,
    bad.length ? bad.map(([name]) => name).join("、") : `${facts.length} 项一致`,
  );
}

// ── 4. GETTING_STARTED 列出的文件都存在 ──────────────────────────────
{
  const guide = read("GETTING_STARTED.md");
  const paths = [...guide.matchAll(/\]\((server\/[^)]+|src\/[^)]+)\)/g)].map((m) => m[1]);
  const missing = paths.filter((p) => !existsSync(resolve(ROOT, p)));
  check(
    "开发指南里的文件清单都存在",
    missing.length === 0 && paths.length > 0,
    missing.length ? `缺：${missing.join(",")}` : `${paths.length} 个文件都在`,
  );
}

// ── 5. 文档里说的动作数量与代码一致 ──────────────────────────────────
{
  const actions = read("server/agent/actions.ts");
  const unique = [...new Set([...actions.matchAll(/type: "(\w+)"/g)].map((m) => m[1]))];
  const submit = read("SUBMIT.md");
  const saysNine = /九种动作/.test(submit);
  check(
    "动作数量与 SUBMIT.md 的描述对应",
    unique.length === 9 && saysNine,
    `代码 ${unique.length} 种动作，SUBMIT.md ${saysNine ? "写了「九种动作」" : "没提「九种动作」"}`,
  );
}

// ── 6. 桌面提交件（唯一一份 Word）↔ 仓库 SUBMIT.md ──────────────────
{
  const docxArg = process.argv.indexOf("--docx");
  const docxPath =
    docxArg > -1
      ? resolve(process.argv[docxArg + 1])
      : resolve(homedir(), "Desktop", "submit.docx");
  const mdParas = mdParagraphs(read("SUBMIT.md"));

  if (!existsSync(docxPath)) {
    check("桌面提交件 ↔ 仓库 SUBMIT.md", false, `找不到 ${docxPath}`);
  } else {
    const docParas = docxParagraphs(docxPath);
    const diffs = [];
    for (let i = 0; i < Math.max(docParas.length, mdParas.length); i += 1) {
      if (docParas[i] !== mdParas[i]) diffs.push(i + 1);
    }
    check(
      "桌面提交件 ↔ 仓库 SUBMIT.md",
      diffs.length === 0,
      diffs.length ? `第 ${diffs.join(",")} 段不一致` : `${mdParas.length} 段逐段一致`,
    );
  }
}

// ── 7. 工作目录的「构建代码汇总」↔ 仓库 docs/版本 ────────────────────
{
  const external = resolve(ROOT, "..", "智能体构建代码.md");
  if (!existsSync(external)) {
    check("工作目录的构建代码汇总 ↔ 仓库版本", false, "文件不存在");
  } else {
    const a = readFileSync(external, "utf8");
    const b = read("docs/构建代码汇总.md");
    check(
      "工作目录的构建代码汇总 ↔ 仓库版本",
      a === b,
      a === b ? "完全一致" : `差 ${a.length - b.length} 字符`,
    );
  }
}

// ── 8. 邮件正文要素齐全 ──────────────────────────────────────────────
{
  const mailPath = resolve(ROOT, "..", "SUBMIT.邮件版.md");
  if (!existsSync(mailPath)) {
    check("邮件正文要素齐全", false, "找不到 SUBMIT.邮件版.md");
  } else {
    const mail = readFileSync(mailPath, "utf8");
    const need = [
      ["仓库链接", /github\.com\/dusk-perfect\/todo-agent/],
      ["收件人", /hr@tokenow\.com\.cn/],
      ["附件清单", /submit\.docx/],
      ["运行方式", /npm ci/],
    ];
    const missing = need.filter(([, pattern]) => !pattern.test(mail)).map(([name]) => name);
    check(
      "邮件正文要素齐全",
      missing.length === 0,
      missing.length ? `缺：${missing.join("、")}` : `${need.length} 项齐全`,
    );
  }
}

// ── 汇总 ──────────────────────────────────────────────────────────────
const failed = results.filter((r) => !r.ok);
console.log(
  `\n${failed.length === 0 ? "✅ 全部同步" : `❌ ${failed.length} 项没同步`}（共 ${results.length} 项）`,
);
process.exit(failed.length === 0 ? 0 : 1);
