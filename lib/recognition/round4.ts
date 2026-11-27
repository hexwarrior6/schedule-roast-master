import type {CanonicalSchedule,Course} from "../schema";
import {parsePeriods,parseWeekNumbers,buildTimetable} from "../timetable";
import {parseExtraction} from "../normalize-extraction";
import {compact} from "./evidence";
import {nameRelation} from "./round3";
import {documentKind} from "./round2";
import type {OCR} from "./types";
import type {Layout,Block,Result} from "./round4-types";

type Schedule=CanonicalSchedule;
type Row=Schedule["courses"][number];
const key=(s:string)=>compact(s).replace(/[()（）【】[\]《》_]/g,"");
const ntime=(c:Course)=>JSON.stringify(parsePeriods(c.timeLabel)??(c.start&&c.end?[c.start,c.end]:c.timeLabel??null));
const nweek=(c:Course,t:number|null)=>JSON.stringify(parseWeekNumbers(c.weeks,t)??key(c.weeks??""));
const exact=(a:Course,b:Course,t:number|null)=>a.day===b.day&&key(a.name)===key(b.name)&&ntime(a)===ntime(b)&&nweek(a,t)===nweek(b,t);
const txt=(ocr:OCR,b:Block)=>b.lineIds.map(i=>ocr.lines[i]?.text??"").join("\n");
const cn=["零","一","二","三","四","五","六","七","八","九","十"];
function ordinal(s:string){if(/^\d{1,2}$/.test(s))return Number(s);if(s==="十")return 10;if(s.startsWith("十")&&s.length===2)return 10+cn.indexOf(s[1]);return cn.indexOf(s);}
export function canonicalPeriod(s:string|null){
 if(!s)return null;
 const q=s.normalize("NFKC").trim().replace(/[–—~～至]/g,"-");
 // Only a label explicitly carrying 节 is treated as a period. Bare numeric
 // ranges are handled by the model's explicit field or physical axis evidence.
 const m=q.match(/^第?([一二三四五六七八九十]{1,2}|\d{1,2})(?:-第?([一二三四五六七八九十]{1,2}|\d{1,2}))?节$/);
 if(!m)return s;
 const a=ordinal(m[1]),b=ordinal(m[2]??m[1]);return a>=1&&b>=a&&b<=30?"第"+a+(a===b?"":"-"+b)+"节":s;
}
function visibleWeek(ocr:OCR){const matches=ocr.lines.filter(l=>l.box.every(p=>p[1]<ocr.height*.35)).flatMap(l=>Array.from(l.text.matchAll(/第\s*(\d{1,2})\s*周/g),m=>Number(m[1]))).filter(n=>n>=1&&n<=60);return new Set(matches).size===1?matches[0]:null;}
function state(ocr:OCR,b:Block){const t=txt(ocr,b).replace(/\s+/g,"");return /非本周|本周不上|notthisweek/i.test(t)?"inactive": "unknown";}
function nameIn(c:Course,t:string){const k=key(c.name);return k.length>=2&&key(t).includes(k);}
function blockMatches(c:Course,ocr:OCR,l:Layout){
 return l.blocks.filter(b=>b.source!=="column"&&nameIn(c,txt(ocr,b))).map(b=>({block:b,dayMatches:b.day===c.day,periodMatches:!!parsePeriods(c.timeLabel)&&JSON.stringify(parsePeriods(c.timeLabel))===JSON.stringify(b.periods.length?[b.periods[0],b.periods.at(-1)]:null)}));
}
export function layoutGraph(ocr:OCR,layout:Layout){
 const blocks=layout.blocks.map(b=>({...b,text:txt(ocr,b),status:state(ocr,b)}));
 // Edges are observed geometry/containment, not inferred course identities.
 const edges:({from:string;to:string;type:string})[]=[];
 for(const b of blocks){
  if(b.day!==null)edges.push({from:b.id,to:"D"+b.day,type:"in_weekday_region"});
  for(const i of b.lineIds)edges.push({from:b.id,to:"L"+i,type:"contains_text"});
  for(const p of b.periods)edges.push({from:b.id,to:"T"+p,type:"overlaps_period_tick"});
 }
 for(const day of layout.regions.map(r=>r.day)){
  const same=blocks.filter(b=>b.day===day).sort((a,b)=>layout.axis?.orientation==="rows"?a.bounds[0]-b.bounds[0]:a.bounds[1]-b.bounds[1]);
  for(let i=1;i<same.length;i++)edges.push({from:same[i-1].id,to:same[i].id,type:"next_in_region"});
 }
 return {kind:layout.kind,regions:layout.regions,axis:layout.axis,ticks:layout.ticks,blocks,edges,unassignedLineIds:layout.unassignedLineIds,visibleWeek:visibleWeek(ocr),document:documentKind(ocr),listHeaders:layout.listHeaders};
}
function build(rows:Course[],base:Schedule,ocr:OCR,layout:Layout,uncertain:number[]=[],unscheduled=base.unscheduled){
 if(!rows.length||rows.length>150)return base;
 const coverage=Array.from({length:7},(_,i)=>{
  const day=i+1,count=rows.filter(c=>c.day===day).length,old=base.coverage.find(d=>d.day===day);
  return {day,count,visibility:uncertain.includes(day)||!old||old.count!==count||(old.visibility==="not_shown"&&count>0)?"uncertain":old.visibility};
 });
 const p=parseExtraction({status:"ok",kind:documentKind(ocr).kind==="catalog"?"catalog":base.kind,termWeeks:base.termWeeks,unscheduled,confidence:"medium",warnings:[],coverage,courses:rows}).result;
 return p.success&&p.data.status==="ok"?buildTimetable(p.data):base;
}
export function parsed(raw:unknown){
 const root=raw&&typeof raw==="object"?raw as Record<string,unknown>:null;
 if(!root)return null;
 if(Array.isArray(root.courses))root.courses=root.courses.map(c=>c&&typeof c==="object"?{...c,timeLabel:canonicalPeriod(typeof (c as Course).timeLabel==="string"?(c as Course).timeLabel:null)}:c);
 const p=parseExtraction(root).result;return p.success&&p.data.status==="ok"?buildTimetable(p.data):null;
}
export function evidenceDiagnostics(s:Schedule|null,ocr:OCR,layout:Layout){
 if(!s)return {score:-100,matched:0,grounded:0,coverage:0,conflicts:0,known:0,states:[],recordEvidence:[]};
 const matches=s.courses.map(c=>{
  const all=blockMatches(c,ocr,layout),same=all.filter(x=>x.dayMatches),chosen=same.length===1?same[0].block:null;
  return {id:c.id,day:c.day,blockIds:all.map(x=>x.block.id),sameDayBlockIds:same.map(x=>x.block.id),periodMatch:same.some(x=>x.periodMatches),state:chosen?state(ocr,chosen):"unknown",conflict:all.length>0&&same.length===0&&layout.regions.some(r=>r.day===c.day&&r.reliable)};
 });
 const matched=matches.filter(m=>m.sameDayBlockIds.length>0).length;
 const grounded=matches.filter(m=>m.sameDayBlockIds.length>0||layout.kind==="list"&&m.blockIds.length>0).length;
 const physical=layout.blocks.filter(b=>b.source==="grid"||b.source==="color"||b.source==="list_row"),covered=new Set(matches.flatMap(m=>layout.kind==="list"?m.blockIds:m.sameDayBlockIds));
 const coverage=physical.length?physical.filter(b=>covered.has(b.id)).length/physical.length:0;
 const conflicts=matches.filter(m=>m.conflict).length;
 const known=s.courses.filter(c=>parsePeriods(c.timeLabel)||c.start&&c.end).length/s.courses.length;
 const ratio=grounded/s.courses.length;
 return {score:2*ratio+2*coverage+known-3*conflicts/s.courses.length,matched,grounded,coverage,conflicts,known,states:matches.filter(m=>m.state==="inactive"),recordEvidence:matches};
}
/** V12: infer fields only from a unique same-day physical card and visible
 * period axis; never trust model-provided block ids. Grid cells can contain
 * several independent courses, so don't use their full extent to override
 * explicit period text. */
export function refineGraph(base:Schedule|null,ocr:OCR,layout:Layout){
 if(!base)return {schedule:null,changes:[],diagnostics:evidenceDiagnostics(null,ocr,layout)};
 const changes:unknown[]=[],days:number[]=[];
 const rows=base.courses.map(c=>{
  const possible=blockMatches(c,ocr,layout).filter(x=>x.dayMatches&&x.block.source==="color"&&x.block.quality>=.65&&x.block.periods.length>0);
  if(possible.length!==1)return c;
  const b=possible[0].block,p=b.periods;
  if(p.some((v,i)=>i>0&&v!==p[i-1]+1))return c;
  const other=base.courses.filter(r=>r.id!==c.id&&r.day===c.day&&nameIn(r,txt(ocr,b)));
  if(other.length)return c;
  const existing=parsePeriods(c.timeLabel);
  // Expand a start-only period, or fill a missing period, but don't override a
  // contradictory explicit interval or clock schedule.
  if(c.start&&c.end||existing&&(existing[0]!==p[0]||existing[1]!==existing[0])||existing&&p.length===1)return c;
  const timeLabel="第"+p[0]+(p.length>1?"-"+p.at(-1):"")+"节";
  if(timeLabel===c.timeLabel)return c;
  const next={...c,timeLabel,rawText:null};changes.push({type:"card_extent",before:c,after:next,blockId:b.id,lineIds:b.lineIds});days.push(c.day);return next;
 });
 const schedule=build(rows,base,ocr,layout,days);
 return {schedule,changes,diagnostics:evidenceDiagnostics(schedule,ocr,layout)};
}
export function selectRegions(base:Schedule|null,ocr:OCR,layout:Layout){
 if(!base||!["cards","grid","header_axis"].includes(layout.kind))return [];
 const d=evidenceDiagnostics(base,ocr,layout);
 return layout.regions.filter(r=>r.reliable).map(r=>{
  const bs=layout.blocks.filter(b=>b.day===r.day&&b.source!=="column"),cs=base.courses.filter(c=>c.day===r.day);
  const ungrounded=cs.filter(c=>!d.recordEvidence.find(x=>x.id===c.id)?.sameDayBlockIds.length).length;
  const uncovered=bs.filter(b=>!cs.some(c=>nameIn(c,txt(ocr,b)))).length;
  const missingSpan=cs.filter(c=>parsePeriods(c.timeLabel)?.[0]===parsePeriods(c.timeLabel)?.[1]&&bs.some(b=>b.source==="color"&&b.periods.length>1&&nameIn(c,txt(ocr,b)))).length;
  return {...r,risk:ungrounded*2+uncovered+missingSpan,reasons:{ungrounded,uncovered,missingSpan}};
 }).filter(r=>r.risk>0).sort((a,b)=>b.risk-a.risk).slice(0,2);
}
export type Review={day:number;schedule:Schedule|null;error?:string;raw?:unknown};
export function mergeIsolated(base:Schedule|null,reviews:Review[],ocr:OCR,layout:Layout){
 if(!base)return {schedule:null,changes:[],conflicts:[],diagnostics:evidenceDiagnostics(null,ocr,layout)};
 const rows:Course[]=[...base.courses],changes:unknown[]=[],conflicts:unknown[]=[],days:number[]=[];
 for(const review of reviews){
  if(!review.schedule)continue;
  for(const raw of review.schedule.courses){
   const c={...raw,day:review.day,sourceDayLabel:null};
   const physical=blockMatches(c,ocr,layout).filter(x=>x.block.day===review.day);
   if(physical.length!==1){conflicts.push({type:"unconfirmed_region_candidate",record:c});continue;}
   if(rows.some(r=>exact(r,c,base.termWeeks)))continue;
   const existing=rows.map((r,i)=>({r,i})).filter(({r})=>r.day===review.day&&nameRelation(r.name,c.name)>=.9&&blockMatches(r,ocr,layout).some(x=>x.block.id===physical[0].block.id));
   if(existing.length===1){
    const {r,i}=existing[0],oldPeriod=parsePeriods(r.timeLabel),newPeriod=parsePeriods(c.timeLabel),oldWeeks=parseWeekNumbers(r.weeks,base.termWeeks),newWeeks=parseWeekNumbers(c.weeks,base.termWeeks);
    const b=physical[0].block,t=txt(ocr,b);
    const periodSupported=b.source==="color"&&newPeriod&&b.periods.length&&newPeriod[0]===b.periods[0]&&newPeriod[1]===b.periods.at(-1);
    const weekSupported=c.weeks&&newWeeks&&key(t).includes(key(c.weeks));
    const next={...r,name:key(c.name).includes(key(r.name))&&c.name.length>r.name.length?c.name:r.name,timeLabel:periodSupported&&(!oldPeriod||oldPeriod[0]===oldPeriod[1])?c.timeLabel:r.timeLabel,weeks:weekSupported&&!oldWeeks?c.weeks:r.weeks,rawText:null};
    if(!exact(next,r,base.termWeeks)){rows[i]=next;days.push(review.day);changes.push({type:"isolated_field_repair",before:r,after:next,blockId:b.id});}
    else conflicts.push({type:"isolated_conflict_not_overwritten",before:r,candidate:c,blockId:b.id});
   }else if(!existing.length&&rows.length<150){
    // For a genuinely new record require the title and explicit scheduling
    // evidence (physical span or literal week) in that physical region.
    const b=physical[0].block,t=txt(ocr,b),p=parsePeriods(c.timeLabel);
    if((p&&b.source==="color"&&b.periods.length&&p[0]===b.periods[0]&&p[1]===b.periods.at(-1))||(c.weeks&&parseWeekNumbers(c.weeks,base.termWeeks)&&key(t).includes(key(c.weeks)))){
     rows.push(c);days.push(review.day);changes.push({type:"isolated_addition",record:c,blockId:b.id});
    }else conflicts.push({type:"new_candidate_without_time_evidence",record:c,blockId:b.id});
   }else conflicts.push({type:"ambiguous_isolated_match",record:c});
  }
 }
 const schedule=build(rows,base,ocr,layout,days);
 return {schedule,changes,conflicts,diagnostics:evidenceDiagnostics(schedule,ocr,layout)};
}
export function adaptive(ocr:OCR,layout:Layout,prev:Partial<Record<"V9"|"V11"|"V12"|"V13",Result>>){
 const order=["V9","V11","V12","V13"] as const;
 const scores=order.map(method=>({method,status:prev[method]?.status??"missing",...evidenceDiagnostics(prev[method]?.schedule??null,ocr,layout)}));
 const usable=scores.filter(x=>prev[x.method]?.schedule);
 if(!usable.length)return {schedule:null,chosen:null,diagnostics:{scores,reason:"no candidate"}};
 // For unresolved layouts, geometry provides no basis to rank results.
 // Prefer full-image V12, then V9; explicitly expose this fallback.
 let chosen=usable.find(x=>x.method==="V12")??usable.find(x=>x.method==="V9")??usable[0];
 let reason="unresolved geometry: contextual fallback";
 if(layout.kind!=="unresolved"&&layout.blocks.some(b=>b.source!=="column")){
  // Ignore small score differences; prefer graph pipeline unless another has
  // materially better spatial agreement. Scores are not calibrated probabilities.
  for(const x of usable)if(x.score>chosen.score+.12&&x.status!=="partial")chosen=x;
  reason="layout evidence coverage, agreement, and conflicting placement";
 }
 const schedule=prev[chosen.method]!.schedule!;
 return {schedule,chosen:chosen.method,diagnostics:{reason,scores,chosen:chosen.method,heuristic:true,offlineSelection:true,document:documentKind(ocr),recordEvidence:evidenceDiagnostics(schedule,ocr,layout).recordEvidence}};
}
