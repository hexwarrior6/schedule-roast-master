"use client";
import { useRef,useState } from "react";
import { ArrowLeft, CalendarDays, Clock, Download, Flame, Info, Layers, Sparkles } from "lucide-react";
import { toPng } from "html-to-image";
import { analyzeCourses } from "@/lib/analyzer";
import { dimensions, type Report } from "@/lib/schema";

export default function AnalysisReport({report,demo,onReset}:{report:Report;demo:boolean;onReset:()=>void}) {
  const poster=useRef<HTMLDivElement>(null);
  const [saving,setSaving]=useState(false);
  const [saveError,setSaveError]=useState("");
  const [expanded,setExpanded]=useState(false);
  const data=analyzeCourses(report.courses);
  const sorted=[...report.courses].sort((a,b)=>a.day-b.day||(a.start??"99:99").localeCompare(b.start??"99:99"));
  const level=report.score>=80?"轻松模式":report.score>=60?"普通模式":report.score>=40?"困难模式":"地狱模式";
  const max=Math.max(1,...data.days.map(d=>d.count));
  async function save() {
    if(!poster.current)return;
    setSaving(true);setSaveError("");
    try {
      await document.fonts.ready;
      const url=await toPng(poster.current,{pixelRatio:2,backgroundColor:"#fffdf7"});
      const link=document.createElement("a");link.href=url;link.download="schedule-roast.png";link.click();
    } catch {setSaveError("图片生成失败，可直接截图保存报告。");}
    finally {setSaving(false);}
  }
  return <section className="report">
    <div className="report-toolbar"><button className="secondary-button" onClick={onReset}><ArrowLeft size={17}/> 重新上传</button><button className="primary-button compact" onClick={save} disabled={saving}><Download size={17}/>{saving?"正在生成…":"保存分享海报"}</button></div>
    {saveError&&<p className="error" role="alert">{saveError}</p>}
    {demo&&<div className="notice"><Info size={16}/> 示例报告 · 以下数据和点评均为虚构。</div>}
    <div className="report-hero" ref={poster}>
      <div className="report-top"><span className="eyebrow"><span className="dot"/> 学期生存报告 / {demo?"DEMO":"REPORT"}</span><span className="report-mark"><Flame size={16}/> ROAST MASTER</span></div>
      <div className="report-title-row">
        <div className="report-headline"><div className="level">{level}</div><h1>{report.title}</h1><p>{report.summary}</p><div className="tags">{report.tags.map((tag,i)=><span key={i}># {tag}</span>)}</div></div>
        <div className="score-wrap"><div className="score-ring" style={{background:"conic-gradient(#ec5b3c "+report.score+"%, #eae3d7 0)"}}><div><strong>{report.score}<small>/100</small></strong><span>学期幸福度</span></div></div><small>AI 趣味估计</small></div>
      </div>
      <div className="metric-grid">
        <div><Layers size={19}/><strong>{data.visibleCount}</strong><span>可见课程块</span></div>
        <div><Clock size={19}/><strong>{data.earlyCount??"—"}</strong><span>9 点前课程块{data.timedCount<data.visibleCount?"（已知时间）":""}</span></div>
        <div><CalendarDays size={19}/><strong>{data.activeDays}</strong><span>可见有课日 / 7</span></div>
      </div>
      <div className="poster-footer"><span>课表毒舌评价师</span><span>上传你的课表 · 生成专属生存报告</span></div>
    </div>
    <div className="notice"><Info size={17}/><div>识别可信度：{({high:"较高",medium:"一般",low:"较低"})[report.confidence]}。统计仅依据图片中的可见课程块，不等于每周实际课时。{report.warnings.map((w,i)=><p key={i}>{w}</p>)}</div></div>
    <section className="report-section"><div className="section-kicker">02 / SCHEDULE</div><h2>一周课程分布</h2><p className="muted">可见课程块数量，单双周可能重复计入。</p><div className="bars" role="img" aria-label={data.days.map(d=>d.day+" "+d.count+" 个课程块").join("，")}>{data.days.map(d=><div key={d.day} className="bar-col"><span>{d.count}</span><div className="bar-track"><div style={{height:(d.count/max*100)+"%"}}/></div><small>{d.day}</small></div>)}</div><button className="text-button" aria-expanded={expanded} onClick={()=>setExpanded(!expanded)}>{expanded?"收起":"查看"}识别出的课表（{sorted.length} 条）</button>{expanded&&<div className="table-wrap"><table><thead><tr><th>星期</th><th>课程</th><th>时间 / 节次</th><th>周次</th></tr></thead><tbody>{sorted.map((c,i)=><tr key={i}><td>{"一二三四五六日"[c.day-1]}</td><td>{c.name}</td><td>{c.start?[c.start,c.end].filter(Boolean).join("–"):c.timeLabel||"未知"}</td><td>{c.weeks||"未知"}</td></tr>)}</tbody></table></div>}</section>
    <section className="report-section"><div className="section-kicker">03 / ROAST</div><h2>八维毒舌评价</h2><p className="muted">分数越高代表安排越友好；未知情况不强行打分。</p><div className="review-grid">{dimensions.map(([key,label],index)=>{const review=report.reviews.find(r=>r.key===key)!;return <article className="review-card" key={key}><div className="review-top"><span className="section-kicker">{String(index+1).padStart(2,"0")}</span><strong>{review.score??"—"}{review.score!==null&&<small>/100</small>}</strong></div><h3>{label}</h3>{review.score!==null&&<div className="rating-track"><div style={{width:review.score+"%"}}/></div>}<p>{review.comment}</p></article>;})}</div></section>
    <section className="advice"><Sparkles size={24}/><div><div className="section-kicker">04 / SURVIVAL GUIDE</div><h2>生存建议</h2><ol>{report.advice.map((a,i)=><li key={i}>{a}</li>)}</ol></div></section>
  </section>;
}
