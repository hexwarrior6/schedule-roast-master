import { NextResponse } from "next/server";
import OpenAI from "openai";
import { timingSafeEqual } from "node:crypto";
import { SCHEDULE_EXTRACTION, SCHEDULE_REVIEW } from "@/lib/prompts";
import { extractionResultSchema, reviewResultSchema } from "@/lib/schema";
import { analyzeCourses } from "@/lib/analyzer";
import { buildReport } from "@/lib/report";
import { prepareVisionImages } from "@/lib/vision";
import { resolveAIConfig, completionLimit, providerOptions } from "@/lib/ai-config";
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
  const vision=resolveAIConfig("VISION",process.env);
  const reviewConfig=resolveAIConfig("REVIEW",process.env);
  if(!vision||!reviewConfig)return fail("视觉识别或评价模型尚未配置。请检查服务端模型、端点和密钥。",503);
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

  let stage="视觉识别";
  try {
    const images=await prepareVisionImages(bytes).catch(()=>null);
    if(!images)return fail("无法解析图片，请上传清晰的 JPG、PNG 或 WebP 截图。",400);
    const visionClient = new OpenAI({apiKey:vision.apiKey,baseURL:vision.baseURL,timeout:50000,maxRetries:0});
    const reviewClient = new OpenAI({apiKey:reviewConfig.apiKey,baseURL:reviewConfig.baseURL,timeout:50000,maxRetries:0});
    const completion = await visionClient.chat.completions.create({
      model: vision.model,
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
      ...completionLimit(vision,10000),
      ...providerOptions(vision),
    }, { signal: request.signal });
    const raw = completion.choices?.[0]?.message?.content?.trim();
    if (!raw || completion.choices?.[0]?.finish_reason==="length" || completion.choices?.[0]?.finish_reason==="content_filter" || String(completion.choices?.[0]?.finish_reason)==="error") {
      const reason=completion.choices?.[0]?.finish_reason;
      console.warn("AI completion incomplete",{stage,model:vision.model,finishReason:reason,hasContent:Boolean(raw),choiceCount:completion.choices?.length??0,completionTokens:completion.usage?.completion_tokens,reasoningTokens:completion.usage?.completion_tokens_details?.reasoning_tokens});
      return fail(reason==="length"?"视觉模型输出达到 Token 上限，请重试或换一张清晰图片。":"视觉模型未返回完整答案，请稍后重试。",502);
    }
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
    stage="文本评价";
    const reviewCompletion=await reviewClient.chat.completions.create({
      model:reviewConfig.model,
      messages:[
        {role:"system",content:SCHEDULE_REVIEW},
        {role:"user",content:JSON.stringify({extraction,stats:analyzeCourses(extraction.courses)})},
      ],
      ...completionLimit(reviewConfig,6500),
      ...providerOptions(reviewConfig),
    },{signal:request.signal});
    const reviewRaw=reviewCompletion.choices?.[0]?.message?.content?.trim();
    const reason=reviewCompletion.choices?.[0]?.finish_reason;
    if(!reviewRaw||reason==="length"||reason==="content_filter"||String(reason)==="error"){
      console.warn("AI completion incomplete",{stage,model:reviewConfig.model,finishReason:reason,hasContent:Boolean(reviewRaw),choiceCount:reviewCompletion.choices?.length??0,completionTokens:reviewCompletion.usage?.completion_tokens,reasoningTokens:reviewCompletion.usage?.completion_tokens_details?.reasoning_tokens});
      return fail(reason==="length"?"文本评价达到 Token 上限，请重试。":"课表已识别，但评价模型未返回完整答案，请重试。",502);
    }
    let reviewJson:unknown;
    try{reviewJson=JSON.parse(reviewRaw.replace(/^\x60\x60\x60(?:json)?\s*/i,"").replace(/\s*\x60\x60\x60$/,"").trim());}
    catch{return fail("评价格式异常，请重试。",502);}
    const review=reviewResultSchema.safeParse(reviewJson);
    if(!review.success)return fail("模型评价不完整，请重试。",502);
    return NextResponse.json(buildReport(extraction,review.data),{headers:{"Cache-Control":"no-store"}});
  } catch (error) {
    if (error instanceof OpenAI.APIError && error.status === 429) return fail(stage+"模型繁忙或免费额度不足，请稍后重试。",503);
    // Do not log request bodies, provider error messages, keys or course data.
    console.warn("AI stage failed",{stage,status:error instanceof OpenAI.APIError?error.status:undefined});
    return fail(stage+"暂时失败，请稍后重试或检查服务配置。",502);
  }
}
