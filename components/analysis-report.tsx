"use client";
import { useRef,useState } from "react";
import { ArrowLeft, CalendarDays, Clock, Download, Flame, Info, Layers, Sparkles } from "lucide-react";
import { toPng } from "html-to-image";
import { analyzeCourses } from "@/lib/analyzer";
import {summarizeTimetable} from "@/lib/timetable";
import {qualityOf} from "@/lib/quality";
import { dimensions, type Report } from "@/lib/schema";

export default function AnalysisReport({report,demo,onReset}:{report:Report;demo:boolean;onReset:()=>void}) {
  const poster=useRef<HTMLDivElement>(null);
  const [saving,setSaving]=useState(false);
  const [saveError,setSaveError]=useState("");
  const [expanded,setExpanded]=useState(true);
  const data=analyzeCourses(report.courses);
  const facts=report.schedule?summarizeTimetable(report.schedule):null;
  const quality=report.schedule?qualityOf(report.schedule):null;
  const sorted=[...report.courses].sort((a,b)=>a.day-b.day||(a.start??"99:99").localeCompare(b.start??"99:99"));
  const level=report.score===null?"待确认":report.score>=80?"轻松模式":report.score>=60?"普通模式":report.score>=40?"困难模式":"地狱模式";
  const max=Math.max(1,...data.days.map(d=>d.count));
  function exportSchedule(){
    if(!report.schedule)return;
    const url=URL.createObjectURL(new Blob([JSON.stringify(report.schedule,null,2)],{type:"application/json"}));
    const link=document.createElement("a");link.href=url;link.download="schedule-v1.json";link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
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
        <div className="score-wrap"><div className="score-ring" style={{background:"conic-gradient(#ec5b3c "+(report.score??0)+"%, #eae3d7 0)"}}><div><strong>{report.score??"—"}{report.score!==null&&<small>/100</small>}</strong><span>{report.kind&&report.kind!=="personal"?"排课趣味评分":"学期幸福度"}</span></div></div><small>{report.score===null?"部分信息不足，见下方点评":report.kind&&report.kind!=="personal"?"假设性评价 · 非真实负担":report.schedule?"规则趣味估计":"AI 趣味估计"}</small></div>
      </div>
      <div className="metric-grid">
        <div><Layers size={19}/><strong>{data.visibleCount}</strong><span>可见课程块</span></div>
        <div><Clock size={19}/><strong>{data.earlyCount??"—"}</strong><span>9 点前课程块{data.timedCount<data.visibleCount?"（已知时间）":""}</span></div>
        <div><CalendarDays size={19}/><strong>{data.activeDays}</strong><span>可见有课日</span></div>
      </div>
      <div className="poster-footer"><span>课表毒舌评价师</span><span>上传你的课表 · 生成专属生存报告</span></div>
    </div>
    <div className="notice"><Info size={17}/><div>模型自估识别可信度：{({high:"较高",medium:"一般",low:"较低"})[report.confidence]}。统计仅依据图片中的可见课程块，不等于每周实际课时。请核对下方识别明细。{report.warnings.map((w,i)=><p key={i}>{w}</p>)}</div></div>
    <section className="report-section"><div className="section-kicker">02 / SCHEDULE</div><h2>课表记录分布</h2><p className="muted">整个学期的可见排课记录，不能当作某一周的实际课次数；未显示的星期不视为无课。</p><div className="bars" role="img" aria-label={data.days.map((d,i)=>d.day+" "+(report.coverage?.find(r=>r.day===i+1)?.visibility==="not_shown"?"未显示":d.count+" 个课程块")).join("，")}>{data.days.map((d,i)=>{const visibility=report.coverage?.find(r=>r.day===i+1)?.visibility;return <div key={d.day} className="bar-col"><span>{visibility==="not_shown"?"—":visibility==="uncertain"?d.count+"?":d.count}</span><div className="bar-track"><div style={{height:(d.count/max*100)+"%"}}/></div><small>{d.day}</small></div>;})}</div><button className="text-button" aria-expanded={expanded} onClick={()=>setExpanded(!expanded)}>{expanded?"收起":"查看"}识别出的课表（{sorted.length} 条）</button>{expanded&&<div className="table-wrap"><table><thead><tr><th>星期</th><th>课程</th><th>时间 / 节次</th><th>周次</th><th>识别原文</th></tr></thead><tbody>{sorted.map((c,i)=><tr key={i}><td>{"一二三四五六日"[c.day-1]}</td><td>{c.name}</td><td>{c.start?[c.start,c.end].filter(Boolean).join("–"):c.timeLabel||"未知"}</td><td>{c.weeks||"未知"}</td><td>{c.rawText||c.sourceDayLabel||c.sourceSlotLabel?<details><summary>查看</summary>{c.rawText||"原文未识别"}{(c.sourceDayLabel||c.sourceSlotLabel)&&<div>原图位置：{c.sourceDayLabel||"星期未知"} · {c.sourceSlotLabel||"时段未知"}</div>}</details>:"—"}</td></tr>)}</tbody></table></div>}</section>
    {facts&&report.schedule&&<section className="report-section"><div className="section-kicker">02B / WEEKLY</div><h2>逐周排课分析</h2><p className="muted">{report.schedule.termWeeks?"学期 "+report.schedule.termWeeks+" 周":"学期总周数未知，仅列明确出现的周次"} · {facts.knownWeekRecords}/{facts.visibleRecords} 条排课记录周次可解析。{facts.scope}。节次是已知编号的去重计数，不代表实际分钟数。{quality&&` 已识别记录字段可解析率（非图片准确率）：${quality.bothKnown}/${quality.total} 条（${Math.round(100*quality.bothKnown/quality.total)}%）。${quality.sufficient?"":"低于80%，暂停综合评分。"}`}</p>
      <button className="text-button" onClick={exportSchedule}><Download size={16}/> 导出标准课表 JSON</button>
      {facts.weekly.length>0?<div className="table-wrap"><table><thead><tr><th>周次</th><th>已知排课记录</th><th>已知有课日</th><th>已知占用节次</th><th>实践 / 不确定</th></tr></thead><tbody>{facts.weekly.map(w=><tr key={w.week}><td>第{w.week}周</td><td>{w.knownOccurrences}</td><td>{w.knownActiveDays}</td><td>{w.unknownPeriodRecords&&w.knownOccupiedPeriods===0?"未知":w.knownOccupiedPeriods+(w.unknownPeriodRecords?"+":"")}</td><td>{[w.unscheduledCount?`${w.unscheduledCount}条实践安排`:"",w.unknownWeekRecords||w.unknownUnscheduledCount?"周次有未知项":"",w.unknownPeriodRecords?"节次有未知项":""].filter(Boolean).join("；")||"—"}</td></tr>)}</tbody></table></div>:<p className="muted">暂无可明确展开的周次。</p>}
      {report.schedule.unscheduled.length>0&&<><h3>未指定星期的实践安排</h3><div className="table-wrap"><table><thead><tr><th>课程</th><th>周次</th></tr></thead><tbody>{report.schedule.unscheduled.map((c,i)=><tr key={i}><td>{c.name}</td><td>{c.weeks??"未知"}</td></tr>)}</tbody></table></div></>}
    </section>}
    <section className="report-section"><div className="section-kicker">03 / ROAST</div><h2>八维毒舌评价</h2><p className="muted">分数越高代表安排越友好；根据已知排课规则计算趣味分，AI仅生成幽默文案，未知情况不强行打分。</p><div className="review-grid">{dimensions.map(([key,label],index)=>{const review=report.reviews.find(r=>r.key===key)!;return <article className="review-card" key={key}><div className="review-top"><span className="section-kicker">{String(index+1).padStart(2,"0")}</span><strong>{review.score??"—"}{review.score!==null&&<small>/100</small>}</strong></div><h3>{label}</h3>{review.score!==null&&<div className="rating-track"><div style={{width:review.score+"%"}}/></div>}<p>{review.comment}</p></article>;})}</div></section>
    <section className="advice"><Sparkles size={24}/><div><div className="section-kicker">04 / SURVIVAL GUIDE</div><h2>生存建议</h2><ol>{report.advice.map((a,i)=><li key={i}>{a}</li>)}</ol></div></section>
  </section>;
}
