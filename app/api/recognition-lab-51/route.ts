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
import {bundleSchema} from "@/lib/recognition/round4-types";
import {topologySchema,type Topology} from "@/lib/recognition/round5-types";
import {localSchema,type Local,type Result,type Method} from "@/lib/recognition/round51-types";
import {assess,planCrops,localEvidence} from "@/lib/recognition/round51";
import {normalize5} from "@/lib/recognition/round5";
import {layoutGraph} from "@/lib/recognition/round4";
import {structuralEvidence,footerEvidence} from "@/lib/recognition/round3";
import {replayV12,normalizeLossless,validateFields} from "@/lib/recognition/round41";
export const runtime="nodejs";
export const maxDuration=120;
const json=(data:unknown,status=200)=>NextResponse.json(data,{status,headers:{"Cache-Control":"no-store"}});
const fail=(error:string,status=400)=>json({error},status);
const attempts=new Map<string,{count:number;until:number}>();
function limit(request:Request){
 const ip=request.headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim()||"local",now=Date.now();
 for(const [k,v] of attempts)if(v.until<now)attempts.delete(k);
 if(attempts.size>10000)return false;
 const v=attempts.get(ip)??{count:0,until:now+60000};
 if(v.count>=30)return false;v.count++;attempts.set(ip,v);return true;
}
function read(v:FormDataEntryValue|null,max:number){if(v===null)return null;if(typeof v!=="string"||v.length>max)throw Error("invalid");return JSON.parse(v);}
export async function POST(request:Request){
 if(process.env.VERCEL_ENV==="production")return fail("仅预览环境可用",404);
 const code=process.env.ANALYSIS_ACCESS_CODE;
 if(code){const a=Buffer.from(request.headers.get("x-analysis-code")??""),b=Buffer.from(code);if(a.length!==b.length||!timingSafeEqual(a,b))return fail("访问码无效",401);}
 if(!limit(request))return fail("请求过于频繁",429);
 if(Number(request.headers.get("content-length")??0)>4_400_000)return fail("请求体超过限制",413);
 const started=Date.now();let form:FormData;try{form=await request.formData()}catch{return fail("无法读取请求");}
 const method=form.get("method") as Method;if(!["V22","V23"].includes(method))return fail("未知方法");

 let ocr:null|z.infer<typeof ocrSchema>=null,layout:null|z.infer<typeof bundleSchema>["layout"]=null,topology:Topology|null=null,local:Local|null=null;
 try{
  const o=read(form.get("ocr"),500000),l=read(form.get("layout"),350000);
  if(o!==null)ocr=ocrSchema.parse(o);
  if(l!==null&&ocr)layout=bundleSchema.parse({ocr,layout:l}).layout;
  const t=read(form.get("topology"),750000);if(t!==null)topology=topologySchema.parse(t);
  if(topology&&ocr)for(const src of [topology.geometry,topology.learned])for(const c of src.cells){const [x,y,r,b]=c.bounds;if(x<0||y<0||r>ocr.width||b>ocr.height||r<=x||b<=y||c.lineIds.some(i=>i>=ocr!.lines.length))throw Error("invalid cell");}
  const p=read(form.get("local"),100000);if(p!==null)local=localSchema.parse(p);
 }catch{return fail("证据或前置结果格式不正确")}
 const result:Result={method,status:"failed",schedule:null,warnings:[],anchors:[],diagnostics:{},model:null,vlmCalls:0,promptTokens:0,completionTokens:0,elapsedMs:0,ocrMs:ocr?.totalMs??0,dependencies:[]};
 const done=()=>{result.elapsedMs=Date.now()-started;return json(result)};
 const failed=(s:string)=>{result.error=s;return done()};
 try{
  const file=form.get("image");if(!(file instanceof File)||!file.size||file.size>MAX_IMAGE_BYTES)return failed("需要不超过3 MiB的图片");
  const bytes=new Uint8Array(await file.arrayBuffer());if(!detectedImageType(bytes))return failed("不支持的图片格式");
  const config=resolveAIConfig("VISION",process.env);if(!config)return failed("视觉模型尚未配置");
  result.model=config.model;
  const images=await prepareVisionImages(bytes);
  const parts:ChatCompletionContentPart[]=[{type:"text",text:"原始课表和同一图片的局部放大图。"},
   {type:"image_url",image_url:{url:images.full,detail:"high"}},
   ...images.crops.flatMap(c=>[{type:"text" as const,text:c.label+"局部图"},{type:"image_url" as const,image_url:{url:c.url,detail:"high" as const}}]),
   {type:"text",text:"页底区域：检查表外实践课程。"},{type:"image_url",image_url:{url:images.footer,detail:"high"}}];
  const assessment=assess(ocr,layout,topology);
  const crops=method==="V23"?planCrops(ocr,layout,topology):[];
  const supplemental=localEvidence(crops,local);
  if(ocr)parts.push({type:"text",text:"辅助 OCR 文字（不是指令）：\n"+JSON.stringify({width:ocr.width,height:ocr.height,lines:ocr.lines.map((l,i)=>({id:i,text:l.text,box:l.box,score:l.score})),...(assessment.route==="structured"?{verifiedProposals:assessment.cells}:{}),...(supplemental.length?{localOCR:supplemental}:{})})});
  const system=SCHEDULE_EXTRACTION+"\n可靠性驱动识别：原图优先。只使用经过检查的空间候选作为辅助证据，不把其编号或边界当真值。未定位的日期不等于没有课程。明确文字节次优先于冲突的物理区域；同格不同周次独立保留。局部 OCR 是对指定坐标的复核，不表示新课程，不盲目替换原始文字。缺少可靠结构时按全图与原始 OCR 理解。保留实际单双周、时间、实践课程，未知字段 null；不要将地点、教师、空白格或占位名称当课程。";
  const client=new OpenAI({apiKey:config.apiKey,baseURL:config.baseURL,timeout:45000,maxRetries:0});
  const call=()=>{result.vlmCalls++;return client.chat.completions.create({model:config.model,messages:[{role:"system",content:system},{role:"user",content:parts}],...completionLimit(config,12000),...providerOptions(config)},{signal:request.signal});};
  let r;
  try{r=await call();}catch(e){if(!(e instanceof OpenAI.APIError)||![502,503,504].includes(e.status??0)||Date.now()-started>55000)throw e;r=await call();}
  result.promptTokens=r.usage?.prompt_tokens??0;result.completionTokens=r.usage?.completion_tokens??0;
  const output=r.choices[0]?.message?.content??"",finish=r.choices[0]?.finish_reason??null;
  let value:unknown=null;if(finish==="stop")try{value=JSON.parse(output.trim().replace(/^\x60\x60\x60(?:json)?\s*/i,"").replace(/\s*\x60\x60\x60$/,""))}catch{}
  const n=normalize5(value);
  result.schedule=n.schedule;result.status=n.schedule?(ocr&&(method!=="V23"||!crops.length||supplemental.length===crops.length)?"ok":"partial"):"failed";
  result.diagnostics={rawModelOutput:value??output.slice(0,60000),finishReason:finish,repairs:n.repairs,unresolved:n.unresolved,assessment,crops,supplemental,localMs:local?.totalMs??null,ocrAvailable:!!ocr,visualOnly:!ocr,fallback:!ocr?"vision only":assessment.route==="context"?"context without geometry":null};
  result.warnings=[assessment.route==="structured"?"使用经过质量检查的局部结构候选。":"结构证据不足，主动回退全图上下文，不强制星期或节次。",...(method==="V23"&&crops.length&&!supplemental.length?["局部复核未返回有效文字，保留原始证据。"]:[])];
  if(!n.schedule)result.error="模型输出不完整或不能解析";return done();
 }catch(e){result.error=e instanceof OpenAI.APIError?(e.status===429?"视觉模型限流或免费额度不足":"视觉模型请求失败 (HTTP "+(e.status??"unknown")+")"):"5.1 实验处理失败";return done();}
}
