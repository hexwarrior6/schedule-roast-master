"use client";
import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowRight, CalendarDays, Check, CircleAlert, CloudUpload, Flame, Github, ImageIcon, LoaderCircle, LockKeyhole, Sparkles, X } from "lucide-react";
import { prepareImage } from "@/lib/image";
import { reportSchema, type Report } from "@/lib/schema";
import { demoReport } from "@/lib/demo";
import AnalysisReport from "./analysis-report";

export default function RoastApp({accessCodeRequired}:{accessCodeRequired:boolean}) {
  const [file,setFile] = useState<File|null>(null);
  const [preview,setPreview] = useState("");
  const [dragging,setDragging] = useState(false);
  const [busy,setBusy] = useState(false);
  const [preparing,setPreparing] = useState(false);
  const [error,setError] = useState("");
  const [report,setReport] = useState<Report|null>(null);
  const [demo,setDemo] = useState(false);
  const [code,setCode] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const request = useRef<AbortController|null>(null);
  const selectionId = useRef(0);
  useEffect(()=>{
    if (!file) {setPreview("");return;}
    const url=URL.createObjectURL(file);
    setPreview(url);
    return ()=>URL.revokeObjectURL(url);
  },[file]);
  useEffect(()=>()=>request.current?.abort(),[]);
  async function select(next:File|undefined) {
    if (!next || busy || preparing) return;
    const id=++selectionId.current;
    setError("");setPreparing(true);
    try {
      const processed=await prepareImage(next);
      if (selectionId.current===id) setFile(processed);
    } catch(e) {
      if (selectionId.current===id) {setFile(null);setError(e instanceof Error?e.message:"无法读取图片。");}
    } finally {if(selectionId.current===id)setPreparing(false);}
  }
  async function analyze() {
    if (!file || busy || preparing) return;
    setBusy(true);setError("");setDemo(false);
    const controller=new AbortController();request.current=controller;
    try {
      const body=new FormData();body.append("image",file);
      const response=await fetch("/api/analyze",{method:"POST",body,headers:code?{"x-analysis-code":code}:{},signal:controller.signal});
      const result=await response.json().catch(()=>null);
      if (!response.ok) throw new Error(result?.error || "分析失败，请稍后重试。");
      const parsed=reportSchema.safeParse(result);
      if (!parsed.success) throw new Error("返回的报告格式不正确。");
      setReport(parsed.data);window.scrollTo({top:0,behavior:"smooth"});
    } catch(e) {
      if(!controller.signal.aborted)setError(e instanceof Error?e.message:"分析失败。");
    } finally {
      if (request.current===controller) {request.current=null;setBusy(false);}
    }
  }
  function reset() {setReport(null);setDemo(false);setFile(null);setError("");window.scrollTo({top:0,behavior:"smooth"});}
  return (
    <div className="site">
      <header className="nav shell">
        <a href="/" className="brand" aria-label="课表毒舌评价师首页"><span className="brand-icon"><Flame size={19}/></span><span>课表毒舌评价师<small> SCHEDULE ROAST MASTER</small></span></a>
        <a className="github" href="https://github.com/hexwarrior6/schedule-roast-master" target="_blank" rel="noreferrer" aria-label="GitHub 仓库"><Github size={20}/><span>GitHub</span></a>
      </header>
      <main className="shell">
        {report ? <AnalysisReport report={report} demo={demo} onReset={reset}/> : <>
          <section className="hero">
            <div className="hero-copy">
              <div className="eyebrow"><span className="dot"/> AI 学期生存诊断 / VOL. 01</div>
              <h1>你的课表，<br/>真的<span>能活吗？</span></h1>
              <p>早八、连堂、单双周……让 AI 看一眼你的课表，给这学期来一份有数据、有梗的生存报告。</p>
              <div className="hero-meta"><span><Check size={15}/> 无需注册</span><span><Check size={15}/> 一张截图就够</span></div>
            </div>
            <div className="hero-art" aria-hidden="true">
              <div className="art-orbit orbit-a"/><div className="art-orbit orbit-b"/>
              <div className="paper">
                <div className="paper-header"><CalendarDays size={18}/><b>本周课程表</b><span>WEEK 01</span></div>
                <div className="paper-days">{["MON","TUE","WED","THU","FRI"].map(d=><span key={d}>{d}</span>)}</div>
                <div className="paper-grid">{Array.from({length:25},(_,i)=><i key={i} className={["hot","gold","cool","",""][((i*7+Math.floor(i/5))%5)]}/>)}</div>
                <div className="paper-foot"><span>08:00 — 18:00</span><span>别问，问就是早八</span></div>
              </div>
              <div className="stamp"><Flame size={22}/><b>生存难度</b><strong>困难模式</strong></div>
              <span className="art-label">* 图为虚构课表示意</span>
            </div>
          </section>
          <section className="upload-panel" aria-labelledby="upload-title">
            <div className="panel-heading"><div><div className="section-kicker">01 / UPLOAD</div><h2 id="upload-title">上传你的课表</h2><p>教务系统截图、课程表 App 截图都可以。</p></div><span className="panel-number">01</span></div>
            <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" tabIndex={-1} aria-label="选择课表图片" onChange={e=>{void select(e.target.files?.[0]);e.currentTarget.value="";}} disabled={busy||preparing}/>
            <div className={"dropzone"+(dragging?" dragging":"")+(file?" has-file":"")} onDragOver={e=>{e.preventDefault();if(!busy&&!preparing)setDragging(true);}} onDragLeave={()=>setDragging(false)} onDrop={e=>{e.preventDefault();setDragging(false);if(e.dataTransfer.files.length>1){setError("每次只能上传一张图片。");return;}void select(e.dataTransfer.files[0]);}}>
              {file ? <div className="preview-row">{preview&&<img src={preview} alt="已选择的课表图片" className="preview"/>}<div className="file-details"><div className="file-label"><ImageIcon size={16}/> 图片已就绪</div><strong>{file.name}</strong><small>{(file.size/1024/1024).toFixed(2)} MB</small><button className="text-button" disabled={busy||preparing} onClick={()=>input.current?.click()}>更换图片</button></div><button className="icon-button remove" aria-label="移除图片" disabled={busy||preparing} onClick={()=>{setFile(null);setError("");}}><X size={19}/></button></div>
              : <button className="drop-trigger" disabled={busy||preparing} onClick={()=>input.current?.click()}>{preparing?<LoaderCircle className="spin" size={28}/>:<span className="upload-icon"><CloudUpload size={30}/></span>}<b>{preparing?"正在处理图片…":"点击选择或拖拽课表图片"}</b><span>JPG / PNG / WebP · 大图自动压缩</span></button>}
            </div>
            {accessCodeRequired&&<label className="access-label"><LockKeyhole size={15}/> 访问码<input type="password" autoComplete="off" value={code} onChange={e=>setCode(e.target.value)} placeholder="输入访问码" disabled={busy}/></label>}
            {error&&<div role="alert" className="error"><CircleAlert size={18}/><span>{error}</span></div>}
            {busy&&<div role="status" className="progress-message"><LoaderCircle className="spin" size={17}/> AI 正在识别课程并组织吐槽，请保持页面打开。</div>}
            <div className="upload-actions">
              {busy?<button className="secondary-button" onClick={()=>request.current?.abort()}>取消分析</button>:<button className="secondary-button" disabled={preparing} onClick={()=>{setDemo(true);setReport(demoReport);window.scrollTo({top:0,behavior:"smooth"});}}>看看示例报告 <ArrowRight size={16}/></button>}
              <button className="primary-button" disabled={!file||busy||preparing||(accessCodeRequired&&!code)} onClick={analyze}>{busy?<LoaderCircle className="spin" size={19}/>:<Sparkles size={19}/>} {busy?"正在锐评…":"开始毒舌评价"} {!busy&&<ArrowRight size={18}/>}</button>
            </div>
            <p className="privacy"><LockKeyhole size={14}/> 图片会发送至 AI 服务进行识别，本站不持久化保存。请先遮挡姓名、学号等个人信息。</p>
          </section>
          <section className="feature-strip">
            {[["01","一眼识别","多模态 AI 直接读图，不用填写课程。"],["02","八维锐评","从早八到社交时间，精准吐槽课表安排。"],["03","生存报告","统计数据、个性称号，还能保存分享。"]].map(([n,title,desc])=><div key={n}><span>{n}</span><h3>{title}</h3><p>{desc}</p></div>)}
          </section>
        </>}
      </main>
      <footer className="shell footer"><span>Schedule Roast Master · 课表毒舌评价师</span><span>仅供娱乐，不代表真实学业负担或健康评估。</span><a href="https://github.com/hexwarrior6/schedule-roast-master" target="_blank" rel="noreferrer">开源项目 <ArrowDown size={13} className="external-arrow"/></a></footer>
    </div>
  );
}
