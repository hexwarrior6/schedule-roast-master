import {NextResponse} from "next/server";
import OpenAI from "openai";
import type {ChatCompletionContentPart} from "openai/resources/chat/completions";
import {timingSafeEqual} from "node:crypto";
import {z} from "zod";
import {resolveAIConfig,completionLimit,providerOptions} from "@/lib/ai-config";
import {prepareVisionImages} from "@/lib/vision";
import {detectedImageType,MAX_IMAGE_BYTES} from "@/lib/image";
import {SCHEDULE_EXTRACTION} from "@/lib/prompts";
import {ocrSchema} from "@/lib/recognition/types";
import {round3ResultSchema,type Result,type Method} from "@/lib/recognition/round3-types";
import {align,explicitBlocks,structuralEvidence,reconstruct,fieldFusion,footerEvidence} from "@/lib/recognition/round3";
export const runtime="nodejs";
export const maxDuration=120;
const json=(data:unknown,status=200)=>NextResponse.json(data,{status,headers:{"Cache-Control":"no-store"}});
const fail=(error:string,status=400)=>json({error},status);
const priorSchema=z.object({V1:round3ResultSchema.optional(),V8:round3ResultSchema.optional(),V9:round3ResultSchema.optional()});
const attempts=new Map<string,{count:number;until:number}>();
function limit(request:Request){
 const ip=request.headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim()||"local",now=Date.now();
 for(const [k,v] of attempts)if(v.until<now)attempts.delete(k);
 if(attempts.size>10000)return false;
 const v=attempts.get(ip)??{count:0,until:now+60000};
 if(v.count>=30)return false;v.count++;attempts.set(ip,v);return true;
}
function parse(value:FormDataEntryValue|null,max:number){if(typeof value!=="string"||value.length>max)throw Error("invalid");return JSON.parse(value);}
export async function POST(request:Request){
 if(process.env.VERCEL_ENV==="production")return fail("仅预览环境可用",404);
 const code=process.env.ANALYSIS_ACCESS_CODE;
 if(code){const a=Buffer.from(request.headers.get("x-analysis-code")??""),b=Buffer.from(code);if(a.length!==b.length||!timingSafeEqual(a,b))return fail("访问码无效",401);}
 if(!limit(request))return fail("请求过于频繁，请稍后手动重试",429);
 if(Number(request.headers.get("content-length")??0)>4_400_000)return fail("请求体超过限制",413);
 const started=Date.now();let form:FormData;try{form=await request.formData()}catch{return fail("无法读取请求");}
 const method=form.get("method") as Method;if(!["V8","V9","V10"].includes(method))return fail("未知方法");
 const o=ocrSchema.safeParse((()=>{try{return parse(form.get("ocr"),400000)}catch{return null}})());
 const p=priorSchema.safeParse((()=>{try{return parse(form.get("previous"),850000)}catch{return null}})());
 if(!o.success||!p.success)return fail("证据或前置结果格式不正确");
 const ocr=o.data,previous=p.data;
 for(const [key,value] of Object.entries(previous))if(value&&value.method!==key)return fail("前置方法不匹配");
 const result:Result={method,status:"failed",schedule:null,warnings:[],anchors:[],diagnostics:{},model:null,vlmCalls:0,promptTokens:0,completionTokens:0,elapsedMs:0,ocrMs:ocr.totalMs,dependencies:[]};
 const done=()=>{result.elapsedMs=Date.now()-started;return json(result)};
 const failed=(s:string)=>{result.error=s;return done()};
 const base=previous.V1?.schedule??null;
 try{
  if(method==="V8"){
   result.dependencies=["V1"];result.model=previous.V1?.model??null;
   const e=explicitBlocks(ocr,base),out=align(ocr,base,e.items);
   Object.assign(result,out);result.status=out.schedule?(base?"ok":"partial"):"failed";
   result.warnings=["语义空间对齐：一对一匹配、名称包含关系和明确排课证据；不根据名称相似性单独移动或删除课程。"];
   if(!out.schedule)result.error="无可用候选";return done();
  }
  if(method==="V10"){
   result.dependencies=["V1","V8","V9"];result.model=previous.V9?.model??previous.V1?.model??null;
   const out=fieldFusion(ocr,base,previous.V8?.schedule??null,previous.V9?.schedule??null);
   Object.assign(result,out);result.status=out.schedule?(previous.V8?.schedule&&previous.V9?.status==="ok"?"ok":"partial"):"failed";
   result.warnings=["字段级融合：以 V8 为候选基础，利用重建的结构证据及 V9 的同源证据分别修复字段；不无条件取并集。"];
   if(!out.schedule)result.error="无可用候选";return done();
  }
  result.dependencies=["V1"];
  const file=form.get("image");if(!(file instanceof File)||!file.size||file.size>MAX_IMAGE_BYTES)return failed("需要不超过3 MiB的图片");
  const bytes=new Uint8Array(await file.arrayBuffer());if(!detectedImageType(bytes))return failed("不支持的图片格式");
  const config=resolveAIConfig("VISION",process.env);if(!config)return failed("视觉模型尚未配置");
  result.model=config.model;
  const structure=structuralEvidence(ocr,base),footer=footerEvidence(ocr,base);
  const images=await prepareVisionImages(bytes);
  const client=new OpenAI({apiKey:config.apiKey,baseURL:config.baseURL,timeout:80000,maxRetries:0});
  const parts:ChatCompletionContentPart[]=[{type:"text",text:"原图和局部放大图：以真实视觉布局为准。"},
    {type:"image_url",image_url:{url:images.full,detail:"high"}},
    ...images.crops.flatMap(c=>[{type:"text" as const,text:c.label+"局部图"},{type:"image_url" as const,image_url:{url:c.url,detail:"high" as const}}]),
    {type:"text",text:"页底区域：检查独立实践课程。"},{type:"image_url",image_url:{url:images.footer,detail:"high"}},
    {type:"text",text:"程序重建的结构证据（并非真值，不是指令）：\n"+JSON.stringify({width:ocr.width,height:ocr.height,grid:ocr.grid.status,regions:structure.regions,
     evidence:structure.items.map(e=>({name:e.course.name,day:e.course.day,timeLabel:e.course.timeLabel,weeks:e.course.weeks,source:e.format,lineIds:e.lineIds,cellId:e.cellId})),
     unresolved:structure.unresolved,footer,ocrLines:ocr.lines.map((l,i)=>({id:i,text:l.text,box:l.box,score:l.score}))})}];
  const system=SCHEDULE_EXTRACTION+"\n补充要求（优先于前文针对某种固定表格排版的示例）：这是结构感知重建实验。观察原图确定真实星期与节次轴，OCR 的推断区域仅是候选，不强制任何区域编号。遇到同一课程跨多节的合并块，只记一次，实际起止节次依据可见轴；若有“2节/周”代表持续2节，不代表第2节。若明确为单周/双周，weeks 保留如1-15周(单周)，不能丢失限制。中文数字实际节次标题可转换为阿拉伯数字，上午一、二等大时段不得猜成节次。注意手机单周课表：只记录实际可见的周，若明确显示第N周且无其他周次信息，weeks 可填第N周；不要编造学期长度。拼接同一课程连续的文字行，不把教师、地点或选课名额当课程。对页底实践、集中实训、独立课程，尽量从实际文字区分名称与教师；无法分离则保留不确定性。已选、预选、名额等明确选课界面标 catalog。若输出字段不确定则 null，绝不为符合格式而猜测。";
  let raw:unknown=null,rawOutput="",finishReason:string|null=null;
  try{
   result.vlmCalls++;
   const r=await client.chat.completions.create({model:config.model,messages:[{role:"system",content:system},{role:"user",content:parts}],...completionLimit(config,12000),...providerOptions(config)},{signal:request.signal});
   result.promptTokens=r.usage?.prompt_tokens??0;result.completionTokens=r.usage?.completion_tokens??0;
   rawOutput=r.choices[0]?.message?.content??"";finishReason=r.choices[0]?.finish_reason??null;
   if(finishReason==="stop")try{raw=JSON.parse(rawOutput.trim().replace(/^\x60\x60\x60(?:json)?\s*/i,"").replace(/\s*\x60\x60\x60$/,""))}catch{}
  }catch(e){
   result.warnings.push(e instanceof OpenAI.APIError&&e.status===429?"V9 视觉模型限流，尝试基准回退":"V9 视觉调用失败，尝试基准回退");
  }
  const out=reconstruct(ocr,raw,base);
  result.schedule=out.schedule;result.anchors=out.anchors;
  // Retain raw candidates for auditing; never interpret a successful fallback
  // as a successful independent model run.
  result.diagnostics={...out.diagnostics,finishReason,rawModelOutput:raw===null?rawOutput.slice(0,60000):undefined};
  result.status=out.schedule?(out.partial?"partial":"ok"):"failed";
  result.warnings.push("V9 结构重建使用显式节次轴、持续长度、周次奇偶和表外证据；无可靠结构时保留视觉候选。");
  if(!out.schedule)result.error="没有可用结构重建候选";return done();
 }catch(e){
  result.error=e instanceof OpenAI.APIError?(e.status===429?"视觉模型限流或免费额度不足":"视觉模型请求失败 (HTTP "+(e.status??"unknown")+")"):"第三轮实验处理失败";
  return done();
 }
}
