import OpenAI from "openai";

export const model = process.env.DEEPSEEK_MODEL || "deepseek-flash";

export function getModelClient(): OpenAI {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error("请在 .env 中设置 DEEPSEEK_API_KEY 后重启服务。");
  // 单轮对话不能被模型拖住：超时就失败，由调用方回退规则引擎。
  return new OpenAI({ apiKey, baseURL: "https://api.deepseek.com", timeout: 15000, maxRetries: 0 });
}
