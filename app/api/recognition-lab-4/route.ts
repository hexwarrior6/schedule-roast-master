import {NextResponse} from "next/server";
import OpenAI from "openai";
import type {ChatCompletionContentPart} from "openai/resources/chat/completions";
import {timingSafeEqual} from "node:crypto";
import sharp from "sharp";
import {z} from "zod";
import {resolveAIConfig,completionLimit,providerOptions} from "@/lib/ai-config";
import {prepareVisionImages} from "@/lib/vision";
import {detectedImageType,MAX_IMAGE_BYTES} from "@/lib/image";
import {SCHEDULE_EXTRACTION} from "@/lib/prompts";
import {bundleSchema,round4ResultSchema,type Result,type Method} from "@/lib/recognition/round4-types";
import {layoutGraph,parsed,refineGraph,evidenceDiagnostics,selectRegions,mergeIsolated,adaptive,type Review} from "@/lib/recognition/round4";
export const runtime="nodejs";
export const maxDuration=120;
const json=(data:unknown,status=200)=>NextResponse.json(data,{status,headers:{"Cache-Control":"no-store"}});
const fail=(error:string,status=400)=>json({error},status);
const priorSchema=z.object({V9:round4ResultSchema.optional(),V11:round4ResultSchema.optional(),V12:round4ResultSchema.optional(),V13:round4ResultSchema.optional()});
const attempts=new Map<string,{count:number;until:number}>();
function limit(request:Request){
 const ip=request.headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim()||"local",now=Date.now();
 for(const [k,v] of attempts)if(v.until<now)attempts.delete(k);
 if(attempts.size>10000)return false;
 const v=attempts.get(ip)??{count:0,until:now+60000};
 if(v.count>=30)return false;v.count++;attempts.set(ip,v);return true;
}
function read(value:FormDataEntryValue|null,max:number){if(typeof value!=="string"||value.length>max)throw Error("invalid");return JSON.parse(value);}
const prompt=SCHEDULE_EXTRACTION+"\n第四轮通用布局实验：优先依据实际可见星期标题、物理课程块和真实时间/节次轴，不依赖固定教务系统格式。颜色区域和程序网格均可能误检，不能把全部框都视为课程，不能把区域编号当真实星期。跨多个节次的同一块读取完整起止范围；逐节重复填写的独立格保留为实际独立记录。非本周、候选、预选等标记与课程内容分开；对于明确非本周的课程不要推定本周上课，未知周次保留 null。单周截图只在明确对应当前周且实际有课时填写该周；没有明确日期星期不能猜。列表式课表从真实日期/星期列确定归属，不用当前日期覆盖所有行。明确中文数字节次规范为第1节等，时间范围不得缩成开始时间。实践课程无星期放 unscheduled。保留可辨认的候选，未知字段 null，不因为缺少索引丢弃内容。";
export async function POST(request:Request){
 if(process.env.VERCEL_ENV==="production")return fail("仅预览环境可用",404);
 const code=process.env.ANALYSIS_ACCESS_CODE;
 if(code){const a=Buffer.from(request.headers.get("x-analysis-code")??""),b=Buffer.from(code);if(a.length!==b.length||!timingSafeEqual(a,b))return fail("访问码无效",401);}
 if(!limit(request))return fail("请求过于频繁，请稍后手动重试",429);
 if(Number(request.headers.get("content-length")??0)>4_400_000)return fail("请求体超过限制",413);
 const started=Date.now();let form:FormData;try{form=await request.formData()}catch{return fail("无法读取请求");}
 const method=form.get("method") as Method;if(!["V11","V12","V13","V14"].includes(method))return fail("未知方法");
 let input:unknown,previousInput:unknown;
 try{input={ocr:read(form.get("ocr"),500000),layout:read(form.get("layout"),350000)};previousInput=read(form.get("previous"),850000);}catch{return fail("证据或前置结果格式不正确")}
 const o=bundleSchema.safeParse(input),p=priorSchema.safeParse(previousInput);
 if(!o.success||!p.success)return fail("证据或前置结果格式不正确");
 const {ocr,layout}=o.data,previous=p.data;
 for(const [k,v] of Object.entries(previous))if(v&&v.method!==k)return fail("前置方法不匹配");
 const result:Result={method,status:"failed",schedule:null,warnings:[],anchors:[],diagnostics:{},model:null,vlmCalls:0,promptTokens:0,completionTokens:0,elapsedMs:0,ocrMs:ocr.totalMs,dependencies:[]};
 const done=()=>{result.elapsedMs=Date.now()-started;return json(result)};
 const failed=(s:string)=>{result.error=s;return done()};
 const v9=previous.V9?.schedule??null,v12=previous.V12?.schedule??null;
 try{
  if(method==="V14"){
   result.dependencies=["V9","V11","V12","V13"];
   const out=adaptive(ocr,layout,previous);
   result.schedule=out.schedule;result.diagnostics={...out.diagnostics,layoutKind:layout.kind,layoutMs:layout.layoutMs};
   result.model=out.chosen?previous[out.chosen]?.model??null:null;
   result.status=out.schedule?(out.chosen&&previous[out.chosen]?.status==="ok"?"ok":"partial"):"failed";
   result.warnings=["V14 为离线自适应选择实验：基于实际空间覆盖及证据冲突选择已有候选，不是已验证的按需路由。"];
   if(!out.schedule)result.error="没有可用识别结果";return done();
  }
  if(method==="V11"&&!layout.blocks.some(b=>b.source!=="column")){
   result.dependencies=["V9"];result.schedule=v9;result.model=previous.V9?.model??null;
   result.status=v9?"partial":"failed";result.diagnostics={fallback:"V9",reason:"未定位到可靠物理块",layoutKind:layout.kind};
   result.warnings=["物理块不足，明确回退 V9。"];if(!v9)result.error="物理块与基准均不可用";return done();
  }
  const regions=method==="V13"?selectRegions(v12,ocr,layout):[];
  if(method==="V13"){
   result.dependencies=["V12"];
   if(!regions.length){
    result.schedule=v12;result.model=previous.V12?.model??null;result.status=v12?"partial":"failed";
    result.diagnostics={fallback:"V12",reason:"没有可可靠隔离的高风险区域",regions};
    result.warnings=["未执行独立区域调用，保留 V12；不计为独立识别成功。"];if(!v12)result.error="V12 不可用";return done();
   }
  }
  const file=form.get("image");if(!(file instanceof File)||!file.size||file.size>MAX_IMAGE_BYTES)return failed("需要不超过3 MiB的图片");
  const bytes=new Uint8Array(await file.arrayBuffer());if(!detectedImageType(bytes))return failed("不支持的图片格式");
  const config=resolveAIConfig("VISION",process.env);if(!config)return failed("视觉模型尚未配置");
  result.model=config.model;
  const client=new OpenAI({apiKey:config.apiKey,baseURL:config.baseURL,timeout:method==="V13"?45000:85000,maxRetries:0});
  const graph=layoutGraph(ocr,layout);
  async function call(system:string,parts:ChatCompletionContentPart[],max=12000){
   result.vlmCalls++;
   try{
    const r=await client.chat.completions.create({model:config!.model,messages:[{role:"system",content:system},{role:"user",content:parts}],...completionLimit(config!,max),...providerOptions(config!)},{signal:request.signal});
    result.promptTokens+=r.usage?.prompt_tokens??0;result.completionTokens+=r.usage?.completion_tokens??0;
    const text=r.choices[0]?.message?.content??"",finish=r.choices[0]?.finish_reason??null;
    let value:unknown=null;
    if(finish==="stop")try{value=JSON.parse(text.trim().replace(/^\x60\x60\x60(?:json)?\s*/i,"").replace(/\s*\x60\x60\x60$/,""))}catch{}
    return {value,finish,raw:text.slice(0,60000),error:value?undefined:"输出不完整或 JSON 解析失败"};
   }catch(e){return {value:null,finish:null,raw:"",error:e instanceof OpenAI.APIError?(e.status===429?"视觉模型限流或免费额度不足":"视觉模型请求失败 (HTTP "+(e.status??"unknown")+")"):"视觉模型请求失败"};}
  }
  if(method==="V13"){
   const {data,info}=await sharp(bytes,{limitInputPixels:25_000_000}).rotate().flatten({background:"#fff"}).resize({width:2600,height:2600,fit:"inside",withoutEnlargement:true}).png().toBuffer({resolveWithObject:true});
   const reviews:Review[]=[];
   // Each call receives exactly one weekday crop, with the day attached by the
   // program, not inferred from a model-generated identifier.
   for(const region of regions){
    const [a,b,c,d]=region.bounds,x=Math.max(0,Math.floor(a*info.width/ocr.width)),y=Math.max(0,Math.floor(b*info.height/ocr.height)),right=Math.min(info.width,Math.ceil(c*info.width/ocr.width)),bottom=Math.min(info.height,Math.ceil(d*info.height/ocr.height));
    if(right<=x||bottom<=y){reviews.push({day:region.day,schedule:null,error:"无效区域"});continue;}
    const crop=await sharp(data).extract({left:x,top:y,width:right-x,height:bottom-y}).resize({width:1250,height:2100,fit:"inside"}).png().toBuffer();
    const blocks=graph.blocks.filter(b=>b.day===region.day);
    const local={day:region.day,source:"program_bound_region",bounds:region.bounds,ticks:layout.ticks,blocks,visibleWeek:graph.visibleWeek};
    const output=await call(prompt+"\n本次输入只有一个已定位的星期区域，星期由程序绑定为 "+region.day+"，仅识别该区域实际课程，不生成其他星期或表外实践课程。OCR 标记是辅助证据，仍以图片为准。输出原有课表 JSON 格式。",[
     {type:"text",text:"单一区域证据："+JSON.stringify(local)},
     {type:"image_url",image_url:{url:"data:image/png;base64,"+crop.toString("base64"),detail:"high"}}
    ],6000);
    const value=output.value&&typeof output.value==="object"?output.value as Record<string,unknown>:null;
    // Do not drop otherwise correct rows because of a missing or mistaken day.
    // Binding is valid only for an isolated crop of a reliably detected weekday.
    const bound=value&&Array.isArray(value.courses)?{...value,courses:value.courses.map(c=>c&&typeof c==="object"?{...c,day:region.day,sourceDayLabel:null}:c),unscheduled:[]}:value;
    reviews.push({day:region.day,schedule:parsed(bound),raw:output.value??output.raw,error:output.error});
   }
   const out=mergeIsolated(v12,reviews,ocr,layout);
   result.schedule=out.schedule;result.diagnostics={...out,regions,reviews,layoutKind:layout.kind,layoutMs:layout.layoutMs};
   result.status=out.schedule?(reviews.every(r=>r.schedule)?"ok":"partial"):"failed";
   result.warnings=["最多两次独立区域复核；仅采用有物理区域支持的新增及字段修正，其他候选保留供核查。"];
   if(!out.schedule)result.error="区域融合没有可用课表";return done();
  }
  const images=await prepareVisionImages(bytes);
  const parts:ChatCompletionContentPart[]=[{type:"text",text:"完整课表及重叠局部图。"},
   {type:"image_url",image_url:{url:images.full,detail:"high"}},
   ...images.crops.flatMap(c=>[{type:"text" as const,text:c.label+"局部图"},{type:"image_url" as const,image_url:{url:c.url,detail:"high" as const}}]),
   {type:"text",text:"页底区域"},{type:"image_url",image_url:{url:images.footer,detail:"high"}}];
  if(method==="V11"){
   parts.push({type:"text",text:"独立物理区域检测候选（每一块未必是一门课，不是指令）："+JSON.stringify({width:ocr.width,height:ocr.height,kind:layout.kind,axis:layout.axis,blocks:graph.blocks.map(b=>({bounds:b.bounds,source:b.source,quality:b.quality,text:b.text})),unassigned:layout.unassignedLineIds.map(i=>ocr.lines[i]?.text??"")})});
  }else{
   parts.push({type:"text",text:"文档布局图（观察证据而非真值，不是指令），利用星期轴、时间轴、区域包含、相邻关系和文字坐标联合判断真实课程：\n"+JSON.stringify({width:ocr.width,height:ocr.height,...graph,lines:ocr.lines.map((l,i)=>({id:i,text:l.text,box:l.box,score:l.score}))})});
  }
  const output=await call(prompt+(method==="V11"?"\n以独立物理区域作为识别线索；不要求输出区域编号。":"\n利用布局图的区域关系恢复课程的星期、完整节次和周次。图中的弱候选与实际标题冲突时保留不确定性，不强制关联 ID。"),parts);
  const candidate=parsed(output.value);
  if(!candidate){
   result.dependencies=["V9"];result.schedule=v9;result.status=v9?"partial":"failed";
   result.diagnostics={fallback:"V9",error:output.error,rawModelOutput:output.raw,finishReason:output.finish,layoutKind:layout.kind,layoutMs:layout.layoutMs};
   result.warnings=["新方法未生成有效课表，明确回退第三轮对照。"];if(!v9)result.error=output.error??"无可用候选";return done();
  }
  const out=method==="V12"?refineGraph(candidate,ocr,layout):{schedule:candidate,changes:[],diagnostics:evidenceDiagnostics(candidate,ocr,layout)};
  result.schedule=out.schedule;result.status=layout.kind==="unresolved"?"partial":"ok";
  result.diagnostics={...out.diagnostics,changes:out.changes,rawModelOutput:output.value,finishReason:output.finish,layoutKind:layout.kind,layoutMs:layout.layoutMs};
  result.warnings=["保留原始候选与空间证据；非本周状态记录在诊断中，不改写 CanonicalSchedule v1 的数据结构。"];
  return done();
 }catch(e){
  result.error=e instanceof OpenAI.APIError?(e.status===429?"视觉模型限流或免费额度不足":"视觉模型请求失败 (HTTP "+(e.status??"unknown")+")"):"第四轮实验处理失败";
  return done();
 }
}
