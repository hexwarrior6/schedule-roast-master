"use client";
import {useRef,useState} from "react";
import {unzipSync,zipSync,strToU8} from "fflate";
import {prepareImage,detectedImageType,MAX_IMAGE_BYTES} from "@/lib/image";
import {methods,methodNames,type Method,type Result,type OCR,type Inputs} from "@/lib/recognition/types";
import type {CanonicalSchedule} from "@/lib/schema";
import styles from "./lab.module.css";
type Job={id:string;original:File;input:File;sha256:string;ocr?:OCR;ocrError?:string;local?:{cells:{id:string;text:string}[];totalMs:number};localError?:string;results:Inputs;clientMs:Partial<Record<Method,number>>;ocrClientMs?:number;localClientMs?:number};
const MAX_COUNT=10,MAX_TOTAL=75*1024*1024,MAX_FILE=25*1024*1024;
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
   let sources:File[]=[];
   if(input.length===1&&input[0].name.toLowerCase().endsWith(".zip")){
    const archive=input[0];if(archive.size>MAX_TOTAL)throw Error("ZIP 最大 75 MiB");
    let count=0,total=0;
    const content=unzipSync(new Uint8Array(await archive.arrayBuffer()),{filter:f=>{
      if(f.name.startsWith("__MACOSX/")||f.name.split("/").some(p=>p.startsWith("."))||!/\.(png|jpe?g|webp)$/i.test(f.name))return false;
      count++;total+=f.originalSize;
      if(count>MAX_COUNT||f.originalSize>MAX_FILE||total>MAX_TOTAL)throw Error("ZIP 最多10张图片，每张25 MiB，总解压大小75 MiB");
      return true;
    }});
    sources=Object.entries(content).sort(([a],[b])=>a.localeCompare(b,"en",{numeric:true})).map(([path,data])=>{
      const mime=detectedImageType(data);if(!mime)throw Error("ZIP 内含无效图片："+safeName(path));
      return new File([new Uint8Array(data).buffer],safeName(path),{type:mime});
    });
   }else{
    if(input.length>MAX_COUNT)throw Error("最多选择10张图片");
    for(const f of Array.from(input)){if(f.size>MAX_FILE)throw Error("单张图片超过25 MiB");const mime=detectedImageType(new Uint8Array(await f.slice(0,16).arrayBuffer()));if(!mime)throw Error("不支持的图片："+f.name);sources.push(new File([f],safeName(f.name),{type:mime}));}
   }
   if(!sources.length)throw Error("没有可用图片");
   if(sources.reduce((n,f)=>n+f.size,0)>MAX_TOTAL)throw Error("原图总大小超过75 MiB");
   const next:Job[]=[];
   for(const [i,original] of sources.entries()){
    const effective=await prepareImage(original);
    next.push({id:String(i+1).padStart(2,"0"),original,input:effective,sha256:await sha(effective),results:{},clientMs:{}});
   }
   update(next);setStage("已准备 "+next.length+" 张图片");
  }catch(e){setError(e instanceof Error?e.message:"导入失败")}finally{setImporting(false);}
 }
 function dependencies(selection:Method[]){
  const set=new Set(selection);
  if(set.has("V3")){set.add("B0");set.add("B1");}
  if(set.has("V4"))set.add("V2");
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
    let j=jobRef.current.find(x=>x.id===id)!;
    if(effective.some(m=>m!=="B1")&&!j.ocr&&(!j.ocrError||retryFailed)){
     setStage(id+" / "+jobs.length+" · 基础 OCR");
     const start=now();
     try{const ocr=await responseJSON("/api/ocr",{method:"POST",headers:{"Content-Type":j.input.type,"x-analysis-code":code},body:j.input}) as OCR;change(id,x=>({...x,ocr,ocrError:undefined,ocrClientMs:Math.round(now()-start)}));}
     catch(e){change(id,x=>({...x,ocrError:e instanceof Error?e.message:"OCR 失败",ocrClientMs:Math.round(now()-start)}));}
    }
    for(const m of effective){
     if(stop.current)break;
     j=jobRef.current.find(x=>x.id===id)!;
     if(j.results[m]&&(!retryFailed||j.results[m]?.status!=="failed"))continue;
     setStage(id+" / "+jobs.length+" · "+m+" "+methodNames[m]);
     const start=now();
     if(m!=="B1"&&!j.ocr){
      change(id,x=>({...x,results:{...x.results,[m]:failed(m,"基础 OCR 失败："+(x.ocrError??"无结果"),Math.round(now()-start))}}));continue;
     }
     if(m==="V4"&&j.results.V2?.schedule&&!j.local){
      const targets=j.results.V2.diagnostics.activeTargets;
      if(Array.isArray(targets)&&targets.length){
       const localStart=now();
       try{
        const regions=targets.slice(0,4).map((t:{id:string;bounds:number[]})=>({id:t.id,bounds:t.bounds}));
        const local=await responseJSON("/api/ocr?regions="+encodeURIComponent(JSON.stringify(regions)),{method:"POST",headers:{"Content-Type":j.input.type,"x-analysis-code":code},body:j.input});
        change(id,x=>({...x,local,localError:undefined,localClientMs:Math.round(now()-localStart)}));
       }catch(e){change(id,x=>({...x,localError:e instanceof Error?e.message:"局部 OCR 失败",localClientMs:Math.round(now()-localStart)}));}
       j=jobRef.current.find(x=>x.id===id)!;
      }
     }
     try{
      const form=new FormData();form.append("method",m);
      if(m!=="B0"&&m!=="V3")form.append("image",j.input);
      if(m!=="B1")form.append("ocr",JSON.stringify(j.ocr));
      if(m==="V3")form.append("previous",JSON.stringify({B0:j.results.B0,B1:j.results.B1}));
      if(m==="V4"){form.append("previous",JSON.stringify({V2:j.results.V2}));if(j.local)form.append("local",JSON.stringify(j.local));}
      const r=await responseJSON("/api/recognition-lab",{method:"POST",headers:{"x-analysis-code":code},body:form}) as Result;
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
   const manifest={format:"schedule-recognition-lab-v1",exportedAt:new Date().toISOString(),methods:effective,methodNames,commit:process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA??null,notes:"No ground-truth accuracy computed. Original and effective images included. ElapsedMs is per strategy server duration; shared OCR and dependency costs are separate. ClientMs includes network; V4 clientMs includes local OCR. No secrets.",samples:[] as unknown[]};
   const csv=["sample,method,status,courses,unscheduled,server_ms,client_ms,ocr_ms,local_ocr_ms,vlm_calls,prompt_tokens,completion_tokens,model,dependencies"];
   for(const j of jobRef.current){
    const folder="samples/"+j.id+"/",orig="original."+ext(j.original.type),image="input."+ext(j.input.type);
    entries[folder+orig]=new Uint8Array(await j.original.arrayBuffer());
    if(j.original!==j.input)entries[folder+image]=new Uint8Array(await j.input.arrayBuffer());
    const inputPath=j.original===j.input?orig:image;
    if(j.ocr)entries[folder+"ocr.json"]=strToU8(JSON.stringify(j.ocr,null,2));
    if(j.local)entries[folder+"local-ocr.json"]=strToU8(JSON.stringify(j.local,null,2));
    manifest.samples.push({id:j.id,originalName:j.original.name,originalPath:folder+orig,inputPath:folder+inputPath,inputSha256:j.sha256,inputBytes:j.input.size,ocrClientMs:j.ocrClientMs,localClientMs:j.localClientMs,ocrError:j.ocrError,localError:j.localError,completed:Object.keys(j.results),groundTruth:null});
    for(const m of effective){
     const r=j.results[m];if(!r){csv.push([j.id,m,"pending"].join(","));continue;}
     entries[folder+m+".json"]=strToU8(JSON.stringify({...r,clientMs:j.clientMs[m]??null,localOcrMs:m==="V4"?j.local?.totalMs??null:null,localOcrError:m==="V4"?j.localError??null:null},null,2));
     if(r.schedule)entries[folder+m+".schedule-v1.json"]=strToU8(JSON.stringify(r.schedule,null,2));
     csv.push([j.id,m,r.status,r.schedule?.courses.length??"",r.schedule?.unscheduled.length??"",r.elapsedMs,j.clientMs[m]??"",r.ocrMs,m==="V4"?j.local?.totalMs??"":"",r.vlmCalls,r.promptTokens,r.completionTokens,JSON.stringify(r.model??""),r.dependencies.join("+")].join(","));
    }
   }
   entries["manifest.json"]=strToU8(JSON.stringify(manifest,null,2));entries["summary.csv"]=strToU8(csv.join("\n"));
   const zipped=zipSync(entries,{level:0});const blob=new Blob([new Uint8Array(zipped).buffer],{type:"application/zip"});
   const url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download="schedule-recognition-experiment-"+new Date().toISOString().slice(0,10)+".zip";a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }catch(e){setError(e instanceof Error?e.message:"导出失败")}
 }
 const completed=jobs.reduce((n,j)=>n+effective.filter(m=>!!j.results[m]).length,0),total=jobs.length*effective.length;
 const selected=detail?jobs.find(j=>j.id===detail.id)?.results[detail.method]:undefined;
 return <main className={styles.main}>
  <header className={styles.header}><a href="/">← 原版</a><a href="/ocr-lab">单图 OCR</a><span>RESEARCH LAB / PREVIEW</span></header>
  <h1>课表识别实验台</h1><p className={styles.sub}>同一批图片 · 六种方法 · 可复现证据包</p>
  <section className={styles.panel}><h2>01 / 测试集</h2>
   <label className={styles.upload}>选择最多 10 张课表或一个 ZIP<input type="file" accept=".zip,image/png,image/jpeg,image/webp" multiple disabled={busy||importing} onChange={e=>load(e.target.files)}/></label>
   <p className={styles.hint}>支持 PNG、JPG、WebP；ZIP 仅导入图片，原图总大小最多 75 MiB。超过 3 MiB 的单图压缩为统一输入，原图和实际输入都随实验包导出。重新导入会替换本页结果。</p>
   {jobs.length>0&&<div className={styles.samples}>{jobs.map(j=><div key={j.id}><b>{j.id}</b> <span>{j.original.name}</span><small>{(j.input.size/1024/1024).toFixed(2)} MiB</small></div>)}</div>}
  </section>
  <section className={styles.panel}><h2>02 / 方法与权限</h2>
   <div className={styles.methods}>{methods.map(m=><label key={m}><input type="checkbox" checked={effective.includes(m)} disabled={busy||effective.includes(m)&&!chosen.includes(m)} onChange={e=>setChosen(old=>e.target.checked?[...old,m]:old.filter(x=>x!==m))}/><strong>{m}</strong> {methodNames[m]}{!chosen.includes(m)&&effective.includes(m)&&<small>前置依赖</small>}</label>)}</div>
   <p className={styles.hint}>V3 依赖 B0、B1；V4 依赖 V2。基础 OCR 共享；独立 VLM 基准仅一次整图调用。V4 最多额外四格局部 OCR 与一次局部 VLM。完整默认 10 × 6 = 60 个方法结果，最多40次 VLM 请求（不含手动重试），可能消耗免费额度。</p>
   <label>访问码（如已配置） <input type="password" value={code} disabled={busy} onChange={e=>setCode(e.target.value)}/></label>
   <label className={styles.consent}><input type="checkbox" checked={consent} disabled={busy} onChange={e=>setConsent(e.target.checked)}/> 我了解图片和 OCR 文字会发送至所配置的视觉模型服务，导出的 ZIP 包含原图及原始识别文字，请勿上传敏感资料。</label>
  </section>
  <section className={styles.panel}><h2>03 / 执行与反馈</h2>
   <div className={styles.actions}><button disabled={busy||importing||!jobs.length||!effective.length||!consent} onClick={()=>execute()}>{busy?"正在运行":"开始 / 继续实验"}</button><button disabled={!busy} onClick={()=>{stop.current=true;setStage("当前请求完成后停止")}}>停止</button><button disabled={busy||!consent||!jobs.some(j=>effective.some(m=>j.results[m]?.status==="failed"))} onClick={()=>execute(true)}>重试失败项</button><button disabled={!jobs.length||busy} onClick={download}>下载完整 ZIP</button></div>
   <progress value={completed} max={total||1}/><p>{completed}/{total} 项 · {stage||"待执行"}</p>
   <p className={styles.hint}>按图片顺序串行执行，减少限流。请保持网页打开；停止不会中断正在运行的请求，结果仅保存在本页内存，刷新会清空。建议先少量测试，再跑满 10 张。</p>
   {error&&<p role="alert" className={styles.error}>{error}</p>}
   {jobs.length>0&&<div className="table-wrap"><table><thead><tr><th>样本</th>{effective.map(m=><th key={m}>{m}</th>)}</tr></thead><tbody>{jobs.map(j=><tr key={j.id}><td>{j.id}<br/><small>{j.original.name}</small></td>{effective.map(m=>{const r=j.results[m];return <td key={m}>{r?<button className={styles.result} data-status={r.status} onClick={()=>setDetail({id:j.id,method:m})}>{r.status==="ok"?"完成":r.status==="partial"?"部分":"失败"}<small>{r.schedule?.courses.length??"—"} 条 · {(r.elapsedMs/1000).toFixed(1)}s</small></button>:"—"}</td>})}</tr>)}</tbody></table></div>}
   <p className={styles.hint}>完成表示产生了结构化结果，不代表准确。请下载包含原图和 JSON 的实验包，使用人工标注比较 Precision、Recall、F1。</p>
  </section>
  {selected&&detail&&<section className={styles.panel}><h2>样本 {detail.id} / {detail.method} {methodNames[detail.method]}</h2><p>{selected.status} · {selected.model||"无视觉模型调用"} · {selected.vlmCalls} 次 VLM · {selected.promptTokens+selected.completionTokens} tokens</p>{selected.error&&<p className={styles.error}>{selected.error}</p>}{selected.warnings.map((w,i)=><p key={i} className={styles.hint}>{w}</p>)}{selected.schedule&&scheduleTable(selected.schedule)}<details><summary>证据与诊断</summary><pre className={styles.json}>{JSON.stringify({anchors:selected.anchors,diagnostics:selected.diagnostics},null,2)}</pre></details></section>}
 </main>
}
