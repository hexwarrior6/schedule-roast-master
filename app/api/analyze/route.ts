import { NextResponse } from "next/server";
import OpenAI from "openai";
import { timingSafeEqual } from "node:crypto";
import { SCHEDULE_GENERAL_ANALYSIS } from "@/lib/prompts";
import { modelResultSchema } from "@/lib/schema";
import { detectedImageType, MAX_IMAGE_BYTES } from "@/lib/image";

export const runtime = "nodejs";
export const maxDuration = 60;

const fail = (message:string,status:number) => NextResponse.json({error:message},{status,headers:{"Cache-Control":"no-store"}});
function checkCode(provided: string, expected: string) {
  const a = Buffer.from(provided), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a,b);
}
// 单实例节流只用于减少误触与并发尖峰；生产环境需在 Vercel Firewall 配置限流。
const attempts = new Map<string,{count:number;expires:number}>();
function limited(ip:string) {
  const now = Date.now();
  for (const [key, entry] of attempts) if (entry.expires <= now) attempts.delete(key);
  if (attempts.size > 10000) return true;
  const entry = attempts.get(ip);
  if (entry && entry.count >= 5) return true;
  if (entry) entry.count++;
  else attempts.set(ip,{count:1,expires:now+60_000});
  return false;
}

export async function POST(request: Request) {
  const expected = process.env.ANALYSIS_ACCESS_CODE;
  if (expected && !checkCode(request.headers.get("x-analysis-code") ?? "",expected)) {
    return fail("访问码无效。",401);
  }
  if (!process.env.AI_API_KEY || !process.env.AI_MODEL) {
    return fail("AI 服务尚未配置。你仍可在首页体验示例报告。",503);
  }
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MAX_IMAGE_BYTES + 65536) return fail("图片超过上传限制。",413);
  if (!request.headers.get("content-type")?.startsWith("multipart/form-data")) return fail("请选择图片上传。",415);
  const ip = request.headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (limited(ip)) return fail("分析请求过于频繁，请稍后再试。",429);
  let file: File;
  try {
    const form = await request.formData();
    const field = form.get("image");
    if (!(field instanceof File) || !field.size) return fail("未收到图片。",400);
    file = field;
  } catch { return fail("无法读取上传文件。",400); }
  if (file.size > MAX_IMAGE_BYTES) return fail("图片不能超过 3 MB。",413);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const mime = detectedImageType(bytes);
  if (!mime || mime !== file.type) return fail("仅支持真实的 JPG、PNG、WebP 图片。",415);

  try {
    const client = new OpenAI({
      apiKey: process.env.AI_API_KEY,
      baseURL: process.env.AI_BASE_URL || "https://api.openai.com/v1",
      timeout: 45000,
      maxRetries: 0,
    });
    const completion = await client.chat.completions.create({
      model: process.env.AI_MODEL,
      messages: [
        {role:"system",content:SCHEDULE_GENERAL_ANALYSIS},
        {role:"user",content:[
          {type:"text",text:"识别这张大学课表并生成评价，按照指定 JSON 格式返回。"},
          {type:"image_url",image_url:{url:"data:"+mime+";base64,"+Buffer.from(bytes).toString("base64")}},
        ]},
      ],
      max_tokens: 6500,
    }, { signal: request.signal });
    const raw = completion.choices[0]?.message?.content?.trim();
    if (!raw) return fail("模型没有返回有效结果，请重试。",502);
    const clean = raw.replace(/^```(?:json)?\s*/i,"").replace(/\s*```$/,"").trim();
    let parsed: unknown;
    try { parsed = JSON.parse(clean); } catch { return fail("模型返回格式异常，请重试。",502); }
    const result = modelResultSchema.safeParse(parsed);
    if (!result.success) return fail("模型结果不完整，请重新分析或换一张更清晰的课表。",502);
    if (result.data.status === "unreadable") return fail(result.data.reason,422);
    return NextResponse.json(result.data,{headers:{"Cache-Control":"no-store"}});
  } catch (error) {
    if (error instanceof OpenAI.APIError && error.status === 429) return fail("AI 服务繁忙或额度不足，请稍后重试。",503);
    return fail("AI 分析暂时失败，请稍后重试或检查服务配置。",502);
  }
}
