"use client";
import {useRef,useState} from "react";
import {unzipSync,zipSync,strToU8,strFromU8} from "fflate";
import {prepareImage,detectedImageType,MAX_IMAGE_BYTES} from "@/lib/image";
import {methods,methodNames,result5Schema,topologySchema,type Method,type Result,type OCR,type Inputs} from "@/lib/recognition/round5-types";
import {ocrSchema} from "@/lib/recognition/types";
import {bundleSchema} from "@/lib/recognition/round4-types";
import type {CanonicalSchedule} from "@/lib/schema";
import styles from "../recognition-lab/lab.module.css";
type Job={id:string;original:File;input:File;sha256:string;priorSha256?:string;sourceArchive?:string;sourceSample?:string;ocr?:OCR;ocrError?:string;local?:{cells:{id:string;text:string}[];totalMs:number};localError?:string;results:Inputs;reused:Method[];ocrReused?:boolean;layoutError?:string;clientMs:Partial<Record<Method,number>>;ocrClientMs?:number;localClientMs?:number};
const MAX_COUNT=30,MAX_TOTAL=225*1024*1024,MAX_FILE=25*1024*1024;
const safeName=(s:string)=>s.split(/[\\/]/).pop()!.replace(/[\x00-\x1f<>:"|?*]/g,"_").slice(0,150)||"image";
const ext=(mime:string)=>mime==="image/png"?"png":mime==="image/webp"?"webp":"jpg";
async function sha(file:File){const data=await crypto.subtle.digest("SHA-256",await file.arrayBuffer());return Array.from(new Uint8Array(data)).map(n=>n.toString(16).padStart(2,"0")).join("");}
const now=()=>performance.now();
function failed(method:Method,error:string,elapsedMs:number):Result{return {method,status:"failed",schedule:null,warnings:[],anchors:[],diagnostics:{clientFailure:true},model:null,vlmCalls:0,promptTokens:0,completionTokens:0,elapsedMs,ocrMs:0,dependencies:[],error};}
async function responseJSON(url:string,init:RequestInit){
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),135000);
 try{const r=await fetch(url,{...init,signal:controller.signal,cache:"no-store"});let data;try{data=await r.json()}catch{throw Error("服务器返回非 JSON (HTTP "+r.status+")")}
 if(!r.ok)throw Error(typeof data.error==="string"?data.error:"HTTP "+r.status);
 return data;
 }finally{clearTimeout(timer);}
}
function scheduleTable(s:CanonicalSchedule){return <div className="table-wrap"><table><thead><tr><th>星期</th><th>课程</th><th>节次 / 时间</th><th>周次</th></tr></thead><tbody>{s.courses.map(c=><tr key={c.id}><td>{"一二三四五六日"[c.day-1]}</td><td>{c.name}</td><td>{c.timeLabel||[c.start,c.end].filter(Boolean).join("–")||"未知"}</td><td>{c.weeks||"未知"}</td></tr>)}</tbody></table></div>;}
export default function RecognitionLab(){
 const [jobs,setJobs]=useState<Job[]>([]),jobRef=useRef<Job[]>([]),[busy,setBusy]=useState(false),[importing,setImporting]=useState(false),[code,setCode]=useState(""),[error,setError]=useState(""),[stage,setStage]=useState(""),[chosen,setChosen]=useState<Method[]>([...methods]),[consent,setConsent]=useState(false),[detail,setDetail]=useState<{id:string;method:Method}|null>(null);
 const stop=useRef(false);
 function update(value:Job[]){jobRef.current=value;setJobs([...value]);}
 function change(id:string,fn:(j:Job)=>Job){update(jobRef.current.map(j=>j.id===id?fn(j):j));}
 async function load(input:FileList|null){
  if(!input?.length)return;setImporting(true);setError("");setDetail(null);
  try{
   const next:Job[]=[];let total=0;
   const seen=new Set<string>();
   async function add(original:File,input:File,priorSha256?:string,sourceArchive?:string,sourceSample?:string){
    if(next.length>=MAX_COUNT)throw Error("最多导入30张图片");
    total+=original.size;if(total>MAX_TOTAL)throw Error("原图总大小超过225 MiB");
    const digest=await sha(input);
    if(priorSha256&&digest!==priorSha256)throw Error("样本 "+sourceSample+" 的实际输入 SHA-256 不一致");
    if(seen.has(digest))throw Error("重复的实际输入："+original.name);
    seen.add(digest);
    next.push({id:String(next.length+1).padStart(2,"0"),original,input,sha256:digest,priorSha256,sourceArchive,sourceSample,results:{},reused:[],clientMs:{}});
   }
   for(const file of Array.from(input)){
    if(file.name.toLowerCase().endsWith(".zip")){
     if(file.size>MAX_TOTAL)throw Error("ZIP 最大225 MiB");
     const bytes=new Uint8Array(await file.arrayBuffer());
     const meta=unzipSync(bytes,{filter:f=>f.name==="manifest.json"&&f.originalSize<300000});
     let manifest:{format?:string;samples?:{id:string;originalPath:string;inputPath:string;originalName:string;inputSha256:string}[]}|null=null;
     if(meta["manifest.json"])try{manifest=JSON.parse(strFromU8(meta["manifest.json"]))}catch{}
     const prior=manifest&&/^schedule-recognition-lab-v(?:[1-5]|41)$/.test(manifest.format??"")&&Array.isArray(manifest.samples)?manifest.samples:null;
     if(prior){
      if(!prior.length||next.length+prior.length>MAX_COUNT)throw Error("实验包合计超过30张或样本数无效");
      const paths=new Set<string>(),ids=new Set<string>();
      const reuse=manifest?.format==="schedule-recognition-lab-v41"||manifest?.format==="schedule-recognition-lab-v5";
      for(const s of prior){
       if(!/^\d{2}$/.test(s.id)||ids.has(s.id)||!new RegExp("^samples/"+s.id+"/original\\.(png|jpg|webp)$").test(s.originalPath)||!new RegExp("^samples/"+s.id+"/(?:original|input)\\.(png|jpg|webp)$").test(s.inputPath)||!/^[a-f0-9]{64}$/.test(s.inputSha256))throw Error("实验包清单无效");
       ids.add(s.id);paths.add(s.originalPath);paths.add(s.inputPath);
       if(reuse){for(const name of ["ocr","layout","topology",...methods])paths.add("samples/"+s.id+"/"+name+".json");}
      }
      let expanded=0;const content=unzipSync(bytes,{filter:f=>{
       if(!paths.has(f.name))return false;expanded+=f.originalSize;if(f.originalSize>MAX_FILE||expanded>MAX_TOTAL*2)throw Error("实验包解压大小过大");return true;
      }});
      for(const s of prior){
       const orig=content[s.originalPath],raw=content[s.inputPath];if(!orig||!raw)throw Error("缺失原图或实际输入");
       const om=detectedImageType(orig),im=detectedImageType(raw);if(!om||!im||raw.length>MAX_IMAGE_BYTES)throw Error("实验包图片无效");
       const original=new File([new Uint8Array(orig).buffer],safeName(s.originalName),{type:om});
       const effective=s.originalPath===s.inputPath?original:new File([new Uint8Array(raw).buffer],"input."+ext(im),{type:im});
       await add(original,effective,s.inputSha256,safeName(file.name),s.id);
       if(reuse){
        const job=next[next.length-1],prefix="samples/"+s.id+"/";
        const read=(name:string)=>{try{const b=content[prefix+name+".json"];return b&&b.length<2_000_000?JSON.parse(strFromU8(b)):null;}catch{return null;}};
        const o=ocrSchema.safeParse(read("ocr"));
        if(o.success){const pair=bundleSchema.safeParse({ocr:o.data,layout:read("layout")});const t=topologySchema.safeParse(read("topology"));job.ocr={...o.data,...(pair.success?{layout:pair.data.layout}:{}),...(t.success?{topology:t.data}:{})};job.ocrReused=true;}
        for(const m of methods){const raw=read(m),p=result5Schema.safeParse(raw);if(p.success&&p.data.method===m&&p.data.status!=="failed"&&p.data.schedule){
          // Do not reuse 4.1 outputs if importing a round-four package. Historical
          // baseline data is preserved; calls are counted separately from new calls.
          if(m==="V1"||m==="V16"||manifest?.format==="schedule-recognition-lab-v5"){
           job.results[m]=p.data;job.reused.push(m);
          }
        }}
       }
      }
     }else{
      let count=0,expanded=0;const content=unzipSync(bytes,{filter:f=>{
       if(f.name.startsWith("__MACOSX/")||f.name.split("/").some(p=>p.startsWith("."))||!/\.(png|jpe?g|webp)$/i.test(f.name))return false;
       count++;expanded+=f.originalSize;if(next.length+count>MAX_COUNT||f.originalSize>MAX_FILE||expanded>MAX_TOTAL)throw Error("图片 ZIP 解压超限");return true;
      }});
      for(const [path,data] of Object.entries(content).sort(([a],[b])=>a.localeCompare(b,"en",{numeric:true}))){
       const mime=detectedImageType(data);if(!mime)throw Error("无效图片："+safeName(path));
       const original=new File([new Uint8Array(data).buffer],safeName(path),{type:mime});
       await add(original,await prepareImage(original),undefined,safeName(file.name),path);
      }
     }
    }else{
     if(file.size>MAX_FILE)throw Error("单张图片超过25 MiB");const mime=detectedImageType(new Uint8Array(await file.slice(0,16).arrayBuffer()));if(!mime)throw Error("不支持的图片："+file.name);
     const original=new File([file],safeName(file.name),{type:mime});await add(original,await prepareImage(original));
    }
   }
   if(!next.length)throw Error("没有可用图片");
   update(next);setStage("已准备 "+next.length+" 张图片，"+next.filter(x=>x.priorSha256).length+" 张前轮哈希一致");
  }catch(e){setError(e instanceof Error?e.message:"导入失败")}finally{setImporting(false);}
 }
 function dependencies(selection:Method[]){
  const set=new Set(selection);
  if(set.has("V21"))set.add("V20");
  return methods.filter(m=>set.has(m));
 }
 const effective=dependencies(chosen);
 async function execute(retryFailed=false){
  if(!jobRef.current.length||!effective.length||!consent)return;
  stop.current=false;setBusy(true);setError("");
  try{
   for(const initial of jobRef.current){
    if(stop.current)break;
    const id=initial.id;
    if(retryFailed){
     const direct:Partial<Record<Method,Method[]>>={V21:["V20"]};
     const reset=new Set<Method>(effective.filter(m=>initial.results[m]?.status==="failed"));
     for(const m of effective)if(direct[m]?.some(d=>reset.has(d))&&!initial.reused.includes(m))reset.add(m);
     if(reset.size)change(id,x=>{const results={...x.results},clientMs={...x.clientMs};for(const m of reset){delete results[m];delete clientMs[m];}return {...x,results,clientMs};});
    }
    let j=jobRef.current.find(x=>x.id===id)!;
    if((!j.ocr||!j.ocr.topology)&&(!j.ocrError||retryFailed)){
     setStage(id+" / "+jobs.length+" · 补测 OCR");
     const start=now();
     // Bounded retry: first resilient layout call, then base OCR alone. Cold
     // initialization timeout may still recur; no fabricated empty OCR.
     for(const url of ["/api/ocr?layout=1&resilient=1&topology=1","/api/ocr"]){
      try{
       const raw=await responseJSON(url,{method:"POST",headers:{"Content-Type":j.input.type,"x-analysis-code":code},body:j.input});
       const o=ocrSchema.parse(raw),p=bundleSchema.safeParse({ocr:o,layout:raw.layout}),t=topologySchema.safeParse(raw.topology);
       change(id,x=>({...x,ocr:{...o,...(p.success?{layout:p.data.layout}:{}),...(t.success?{topology:t.data}:{})},ocrReused:false,ocrError:undefined,layoutError:p.success?undefined:raw.layoutError??"布局不可用",ocrClientMs:Math.round(now()-start)}));break;
      }catch(e){change(id,x=>({...x,ocrError:e instanceof Error?e.message:"OCR 失败",ocrClientMs:Math.round(now()-start)}));}
     }
    }
    for(const m of effective){
     if(stop.current)break;
     j=jobRef.current.find(x=>x.id===id)!;
     if(j.results[m]&&(!retryFailed||j.results[m]?.status!=="failed"))continue;
     setStage(id+" / "+jobs.length+" · "+m+" "+methodNames[m]);
     const start=now();
     try{
      const form=new FormData();
      const {layout,topology,...ocr}=j.ocr??{layout:undefined,topology:undefined};
      if(j.ocr)form.append("ocr",JSON.stringify(ocr));
      if(layout&&(m==="V16"))form.append("layout",JSON.stringify(layout));
      if(topology&&m!=="V1"&&m!=="V16")form.append("topology",JSON.stringify(topology));
      const lean=(r:Result|undefined)=>r?{...r,diagnostics:{},anchors:[]}:null;
      let url="/api/recognition-lab-5";
      let expected:Method|"B1"=m;
      if(m==="V1"){
       url="/api/recognition-lab";expected=j.ocr?"V1":"B1";form.append("method",expected);form.append("image",j.input);
      }else if(m==="V16"){
       url="/api/recognition-lab-41";form.append("method",m);form.append("image",j.input);
      }else{
       form.append("method",m);
       if(m==="V21")form.append("previous",JSON.stringify(lean(j.results.V20)));
       else form.append("image",j.input);
      }
      const response=await responseJSON(url,{method:"POST",headers:{"x-analysis-code":code},body:form});
      if(response.method!==expected)throw Error("实验结果方法不匹配");
      const r:Result=expected==="B1"?{...response,method:"V1",status:response.schedule?"partial":"failed",warnings:[...response.warnings,"OCR 不可用，实际使用 B1 纯视觉回退，不计为 V1 成功。"],diagnostics:{...response.diagnostics,fallback:"B1"}}:response;
      if(r.method!==m||!["ok","partial","failed"].includes(r.status))throw Error("实验结果格式不正确");
      change(id,x=>({...x,results:{...x.results,[m]:r},clientMs:{...x.clientMs,[m]:Math.round(now()-start)}}));
     }catch(e){change(id,x=>({...x,results:{...x.results,[m]:failed(m,e instanceof Error?e.message:"请求失败",Math.round(now()-start))},clientMs:{...x.clientMs,[m]:Math.round(now()-start)}}));}
    }
   }
  }finally{setBusy(false);setStage(stop.current?"已停止，已完成结果可导出或继续":"本轮执行结束，检查失败项并导出实验包");}
 }
 async function download(){
  try{
   setError("");
   const entries:Record<string,Uint8Array>={};
   const manifest={format:"schedule-recognition-lab-v5",exportedAt:new Date().toISOString(),methods:effective,methodNames,commit:process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA??null,notes:"No ground-truth accuracy computed. Original and effective images included. ElapsedMs is per strategy server duration; shared OCR and dependency costs are separate. ClientMs includes network; Historical V1/V16 reused when valid. V18 local topology, V19 learned structure, V20 both, V21 deterministic validation. Export geometry and learned proposals independently. No secrets.",samples:[] as unknown[]};
   const csv=["sample,method,status,courses,unscheduled,server_ms,client_ms,ocr_ms,local_ocr_ms,vlm_calls,prompt_tokens,completion_tokens,model,dependencies,reused,new_vlm_calls"];
   for(const j of jobRef.current){
    const folder="samples/"+j.id+"/",orig="original."+ext(j.original.type),image="input."+ext(j.input.type);
    entries[folder+orig]=new Uint8Array(await j.original.arrayBuffer());
    if(j.original!==j.input)entries[folder+image]=new Uint8Array(await j.input.arrayBuffer());
    const inputPath=j.original===j.input?orig:image;
    if(j.ocr){const {layout,topology,...ocr}=j.ocr;entries[folder+"ocr.json"]=strToU8(JSON.stringify(ocr,null,2));if(layout)entries[folder+"layout.json"]=strToU8(JSON.stringify(layout,null,2));if(topology)entries[folder+"topology.json"]=strToU8(JSON.stringify(topology,null,2));}
    if(j.local)entries[folder+"local-ocr.json"]=strToU8(JSON.stringify(j.local,null,2));
    manifest.samples.push({id:j.id,originalName:j.original.name,sourceArchive:j.sourceArchive,sourceSample:j.sourceSample,layoutKind:j.ocr?.layout?.kind,layoutMs:j.ocr?.layout?.layoutMs,originalPath:folder+orig,inputPath:folder+inputPath,inputSha256:j.sha256,priorInputSha256:j.priorSha256,priorInputMatch:j.priorSha256?j.priorSha256===j.sha256:null,inputBytes:j.input.size,ocrClientMs:j.ocrClientMs,localClientMs:j.localClientMs,ocrError:j.ocrError,localError:j.localError,completed:Object.keys(j.results),groundTruth:null,reused:j.reused,ocrReused:j.ocrReused??false,layoutError:j.layoutError});
    for(const m of effective){
     const r=j.results[m];if(!r){csv.push([j.id,m,"pending"].join(","));continue;}
     entries[folder+m+".json"]=strToU8(JSON.stringify({...r,clientMs:j.clientMs[m]??null,reused:j.reused.includes(m),newVlmCalls:j.reused.includes(m)?0:r.vlmCalls},null,2));
     if(r.schedule)entries[folder+m+".schedule-v1.json"]=strToU8(JSON.stringify(r.schedule,null,2));
     csv.push([j.id,m,r.status,r.schedule?.courses.length??"",r.schedule?.unscheduled.length??"",r.elapsedMs,j.clientMs[m]??"",r.ocrMs,"",r.vlmCalls,r.promptTokens,r.completionTokens,JSON.stringify(r.model??""),r.dependencies.join("+"),j.reused.includes(m),j.reused.includes(m)?0:r.vlmCalls].join(","));
    }
   }
   entries["manifest.json"]=strToU8(JSON.stringify(manifest,null,2));entries["summary.csv"]=strToU8(csv.join("\n"));
   const zipped=zipSync(entries,{level:0});const blob=new Blob([new Uint8Array(zipped).buffer],{type:"application/zip"});
   const url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download="schedule-recognition-round5-"+new Date().toISOString().slice(0,10)+".zip";a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }catch(e){setError(e instanceof Error?e.message:"导出失败")}
 }
 const completed=jobs.reduce((n,j)=>n+effective.filter(m=>!!j.results[m]).length,0),total=jobs.length*effective.length;
 const selected=detail?jobs.find(j=>j.id===detail.id)?.results[detail.method]:undefined;
 return <main className={styles.main}>
  <header className={styles.header}><a href="/">← 原版</a><a href="/recognition-lab">第一轮</a><a href="/recognition-lab-2">第二轮</a><a href="/recognition-lab-3">第三轮</a><a href="/recognition-lab-4">第四轮</a><span>ROUND 05 / PREVIEW</span></header>
  <h1>课表识别实验台 · 第五轮</h1><p className={styles.sub}>局部拓扑 · 专用表格模型 · 双结构融合</p>
  <section className={styles.panel}><h2>01 / 测试集</h2>
   <label className={styles.upload}>导入历史实验 ZIP 或最多30张新图片<input type="file" accept=".zip,image/png,image/jpeg,image/webp" multiple disabled={busy||importing} onChange={e=>load(e.target.files)}/></label>
   <p className={styles.hint}>支持 PNG、JPG、WebP；4.1轮 ZIP 自动复用有效 V1/V16；重新检测结构，校验输入 SHA-256。新图片重新识别。原图总大小最多225 MiB。超过 3 MiB 的单图压缩为统一输入，原图和实际输入都随实验包导出。重新导入会替换本页结果。</p>
   {jobs.length>0&&<div className={styles.samples}>{jobs.map(j=><div key={j.id}><b>{j.id}</b> <span>{j.original.name}</span><small>{(j.input.size/1024/1024).toFixed(2)} MiB {j.priorSha256?"· SHA一致":""}</small></div>)}</div>}
  </section>
  <section className={styles.panel}><h2>02 / 方法与权限</h2>
   <div className={styles.methods}>{methods.map(m=><label key={m}><input type="checkbox" checked={effective.includes(m)} disabled={busy||effective.includes(m)&&!chosen.includes(m)} onChange={e=>setChosen(old=>e.target.checked?[...old,m]:old.filter(x=>x!==m))}/><strong>{m}</strong> {methodNames[m]}{!chosen.includes(m)&&effective.includes(m)&&<small>前置依赖</small>}</label>)}</div>
   <p className={styles.hint}>V1/V16 为原版对照；V18 局部拓扑、V19 RapidTable、V20 双结构联合各一次视觉调用；V21 零调用校验。新图每张最多5次视觉调用，旧对照有效时只需3次。</p>
   <label>访问码（如已配置） <input type="password" value={code} disabled={busy} onChange={e=>setCode(e.target.value)}/></label>
   <label className={styles.consent}><input type="checkbox" checked={consent} disabled={busy} onChange={e=>setConsent(e.target.checked)}/> 我了解图片和 OCR 文字会发送至所配置的视觉模型服务，导出的 ZIP 包含原图及原始识别文字，请勿上传敏感资料。</label>
  </section>
  <section className={styles.panel}><h2>03 / 执行与反馈</h2>
   <div className={styles.actions}><button disabled={busy||importing||!jobs.length||!effective.length||!consent} onClick={()=>execute()}>{busy?"正在运行":"开始 / 继续实验"}</button><button disabled={!busy} onClick={()=>{stop.current=true;setStage("当前请求完成后停止")}}>停止</button><button disabled={busy||!consent||!jobs.some(j=>effective.some(m=>j.results[m]?.status==="failed"))} onClick={()=>execute(true)}>重试失败项</button><button disabled={!jobs.length||busy} onClick={download}>下载完整 ZIP</button></div>
   <progress value={completed} max={total||1}/><p>{completed}/{total} 项 · 已复用 {jobs.reduce((n,j)=>n+j.reused.filter(m=>effective.includes(m)).length,0)} 项 · {stage||"待执行"}</p>
   <p className={styles.hint}>按图片顺序串行执行，减少限流。请保持网页打开；停止不会中断正在运行的请求，结果仅保存在本页内存，刷新会清空。建议先导入10张合成课表，再测试真实图；本轮仍为开发实验。</p>
   {error&&<p role="alert" className={styles.error}>{error}</p>}
   {jobs.length>0&&<div className="table-wrap"><table><thead><tr><th>样本 / 布局</th>{effective.map(m=><th key={m}>{m}</th>)}</tr></thead><tbody>{jobs.map(j=><tr key={j.id}><td>{j.id}<br/><small>{j.original.name}</small><br/><small>{j.sourceArchive?j.sourceArchive+" / "+j.sourceSample:""}</small><br/><small>{j.ocr?.layout?j.ocr.layout.kind+" · "+j.ocr.layout.blocks.length+" 块 · "+j.ocr.layout.regions.length+" 区域":"未检测布局"}</small><br/><small>{j.ocr?.topology?"CV "+j.ocr.topology.geometry.status+" / TSR "+j.ocr.topology.learned.status:"未检测拓扑"}</small></td>{effective.map(m=>{const r=j.results[m];return <td key={m}>{r?<button className={styles.result} data-status={r.status} onClick={()=>setDetail({id:j.id,method:m})}>{j.reused.includes(m)?"复用":r.status==="ok"?"完成":r.status==="partial"?"部分":"失败"}<small>{r.schedule?.courses.length??"—"} 条 · {(r.elapsedMs/1000).toFixed(1)}s</small></button>:"—"}</td>})}</tr>)}</tbody></table></div>}
   <p className={styles.hint}>完成表示产生了结构化结果，不代表准确。请下载包含原图和 JSON 的实验包，使用人工标注比较 Precision、Recall、F1。</p>
  </section>
  {selected&&detail&&<section className={styles.panel}><h2>样本 {detail.id} / {detail.method} {methodNames[detail.method]}</h2><p>{selected.status} · {selected.model||"无视觉模型调用"} · {selected.vlmCalls} 次 VLM · {selected.promptTokens+selected.completionTokens} tokens</p>{selected.error&&<p className={styles.error}>{selected.error}</p>}{selected.warnings.map((w,i)=><p key={i} className={styles.hint}>{w}</p>)}{selected.schedule&&scheduleTable(selected.schedule)}<details><summary>证据与诊断</summary><pre className={styles.json}>{JSON.stringify({anchors:selected.anchors,diagnostics:selected.diagnostics},null,2)}</pre></details></section>}
 </main>
}
