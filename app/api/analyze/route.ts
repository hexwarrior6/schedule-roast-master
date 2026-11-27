import { NextResponse } from "next/server";
import OpenAI from "openai";
import { timingSafeEqual } from "node:crypto";
import { SCHEDULE_EXTRACTION, SCHEDULE_REVIEW } from "@/lib/prompts";
import { extractionResultSchema, reviewResultSchema } from "@/lib/schema";
import { analyzeCourses } from "@/lib/analyzer";
import { buildReport } from "@/lib/report";
import { prepareVisionImages } from "@/lib/vision";
import { detectedImageType, MAX_IMAGE_BYTES } from "@/lib/image";

export const runtime = "nodejs";
export const maxDuration = 120;

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
    const images=await prepareVisionImages(bytes).catch(()=>null);
    if(!images)return fail("无法解析图片，请上传清晰的 JPG、PNG 或 WebP 截图。",400);
    const client = new OpenAI({
      apiKey: process.env.AI_API_KEY,
      baseURL: process.env.AI_BASE_URL || "https://api.openai.com/v1",
      timeout: 45000,
      maxRetries: 0,
    });
    const completion = await client.chat.completions.create({
      model: process.env.AI_MODEL,
      messages: [
        {role:"system",content:SCHEDULE_EXTRACTION},
        {role:"user",content:[
          {type:"text",text:"仅逐日识别图片中所有可见课程块，核对每个星期，暂不评价。"},
          {type:"text",text:"原图：用于确定整体布局与星期节次。"},
          {type:"image_url",image_url:{url:images.full,detail:"high"}},
          ...images.crops.flatMap(crop=>[
            {type:"text" as const,text:"同一课表的"+crop.label+"局部放大图（与其他区域有重叠）。"},
            {type:"image_url" as const,image_url:{url:crop.url,detail:"high" as const}},
          ]),
        ]},
      ],
      max_tokens: 6500,
    }, { signal: request.signal });
    const raw = completion.choices[0]?.message?.content?.trim();
    if (!raw) return fail("模型没有返回有效结果，请重试。",502);
    const clean = raw.replace(/^```(?:json)?\s*/i,"").replace(/\s*```$/,"").trim();
    let parsed: unknown;
    try { parsed = JSON.parse(clean); } catch { return fail("模型返回格式异常，请重试。",502); }
    const result = extractionResultSchema.safeParse(parsed);
    if (!result.success) return fail("模型结果不完整，请重新分析或换一张更清晰的课表。",502);
    if (result.data.status === "unreadable") return fail(result.data.reason,422);
    const extraction=result.data;
    if(Math.min(images.width,images.height)<600){
      if(extraction.confidence==="high")extraction.confidence="medium";
      extraction.warnings=["原图分辨率较低，局部放大不能恢复缺失的文字细节，请核对课程名称和节次。",...extraction.warnings].slice(0,8);
    }
    const reviewCompletion=await client.chat.completions.create({
      model:process.env.AI_MODEL,
      messages:[
        {role:"system",content:SCHEDULE_REVIEW},
        {role:"user",content:JSON.stringify({extraction,stats:analyzeCourses(extraction.courses)})},
      ],
      max_tokens:3500,
    },{signal:request.signal});
    const reviewRaw=reviewCompletion.choices[0]?.message?.content?.trim();
    if(!reviewRaw)return fail("课表已识别，但模型没有生成评价，请重试。",502);
    let reviewJson:unknown;
    try{reviewJson=JSON.parse(reviewRaw.replace(/^\x60\x60\x60(?:json)?\s*/i,"").replace(/\s*\x60\x60\x60$/,"").trim());}
    catch{return fail("评价格式异常，请重试。",502);}
    const review=reviewResultSchema.safeParse(reviewJson);
    if(!review.success)return fail("模型评价不完整，请重试。",502);
    return NextResponse.json(buildReport(extraction,review.data),{headers:{"Cache-Control":"no-store"}});
  } catch (error) {
    if (error instanceof OpenAI.APIError && error.status === 429) return fail("AI 服务繁忙或额度不足，请稍后重试。",503);
    return fail("AI 分析暂时失败，请稍后重试或检查服务配置。",502);
  }
}
