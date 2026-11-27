import type {CanonicalSchedule,Course} from "../schema";
import {canonicalScheduleSchema} from "../schema";
import {parsePeriods,parseWeekNumbers,buildTimetable} from "../timetable";
import {parseExtraction} from "../normalize-extraction";
import {cellsOf,compact,recordKey,contentKey,parseOCR,supported} from "./evidence";
import type {Anchor,OCR} from "./types";
import type {Result} from "./round2-types";

type Row=CanonicalSchedule["courses"][number];
type Schedule=CanonicalSchedule;
const nameKey=(s:string)=>compact(s).replace(/[()（）【】[\]《》]/g,"");
const weekKey=(c:Course,t:number|null)=>JSON.stringify(parseWeekNumbers(c.weeks,t)??compact(c.weeks??""));
const timeKey=(c:Course)=>JSON.stringify(parsePeriods(c.timeLabel)??(c.start&&c.end?[c.start,c.end]:c.timeLabel??null));
const hasTime=(c:Course)=>!!parsePeriods(c.timeLabel)||!!(c.start&&c.end);
const sameName=(a:Course,b:Course)=>nameKey(a.name)===nameKey(b.name);
const sameContent=(a:Course,b:Course,t:number|null)=>sameName(a,b)&&timeKey(a)===timeKey(b)&&weekKey(a,t)===weekKey(b,t);
const same=(a:Course,b:Course,t:number|null)=>a.day===b.day&&sameContent(a,b,t);
const observed=(o:OCR,day:number,name:string)=>cellsOf(o).some(c=>c.day===day&&nameKey(c.text).includes(nameKey(name)));
const evidenceTerm=(ocr:OCR)=>{
 const terms=ocr.lines.flatMap(l=>Array.from(l.text.matchAll(/(?:共\s*(\d{1,2})\s*周|(?:total|semester)\s*(\d{1,2})\s*weeks)/gi),m=>Number(m[1]??m[2]))).filter(n=>n>=1&&n<=60);
 return new Set(terms).size===1?terms[0]:null;
};
/** Only explicit selection interface signals, not overlap or ordinary course counts. */
export function documentKind(ocr:OCR):{kind:"catalog"|"unknown";signals:string[]}{
 const text=ocr.lines.map(l=>l.text).join("\n");
 const signals=["已选","预选","剩余名额","选课状态","退选","余量","已选课程","候选课程","Add/Drop","Waitlist"].filter(x=>text.toLowerCase().includes(x.toLowerCase()));
 const selection=signals.some(s=>/预选|退选|剩余名额|余量|选课状态|waitlist|add\/drop/i.test(s));
 return {kind:signals.length>=2&&selection?"catalog":"unknown",signals};
}
export function makeSchedule(rows:Course[],base:Schedule,ocr:OCR,uncertainDays:number[]=[]):Schedule|null{
 if(!rows.length||rows.length>150)return null;
 const kind=documentKind(ocr).kind==="catalog"?"catalog":base.kind;
 const term=evidenceTerm(ocr)??base.termWeeks;
 const coverage=Array.from({length:7},(_,i)=>{
 const day=i+1,count=rows.filter(c=>c.day===day).length,old=base.coverage.find(d=>d.day===day);
 return {day,count,visibility:uncertainDays.includes(day)||!old||old.count!==count||old.visibility==="not_shown"&&count>0?"uncertain":old.visibility};
 });
 const p=parseExtraction({status:"ok",kind,termWeeks:term,unscheduled:base.unscheduled,confidence:"medium",warnings:[],coverage,courses:rows}).result;
 if(!p.success||p.data.status!=="ok")return null;
 const s=buildTimetable(p.data);return canonicalScheduleSchema.safeParse(s).success?s:null;
}
/** Separate, more tolerant evidence extractor; B0 itself remains unchanged. */
export function explicitEvidence(ocr:OCR){
 const prior=parseOCR(ocr),rows:Course[]=[...(prior.schedule?.courses??[])];
 const term=evidenceTerm(ocr),sources:{course:Course;cellId:string;lineIds:number[]}[]=[];
 for(const c of prior.schedule?.courses??[]){const a=prior.anchors.find(x=>x.recordId===c.id);if(a)sources.push({course:c,cellId:a.cellId,lineIds:a.lineIds});}
 for(const cell of cellsOf(ocr)){
  const lines=cell.lineIds.map(i=>({id:i,text:ocr.lines[i].text.normalize("NFKC")}));
  // Only join a trailing explicit slash/period marker to its immediately preceding title,
  // avoiding arbitrary reconstruction of missing fields.
  for(let i=1;i<lines.length;i++){
   if(!/^\s*\/\s*\(\s*\d/.test(lines[i].text))continue;
   const name=lines[i-1].text.trim();if(!/^[\p{L}][^/]{1,99}$/u.test(name)||/周|节|教室|地点|学分/.test(name))continue;
   const tail=lines.slice(i,i+4).map(x=>x.text).join("").match(/^\s*\/\s*\(\s*((?:第)?\d{1,2}(?:[-–—~～至]\d{1,2})?节)\s*\)\s*([^/]+)(?=\/|$)/);
   if(!tail||!parsePeriods(tail[1])||!parseWeekNumbers(tail[2],term))continue;
   const c:Course={name,day:cell.day,timeLabel:tail[1],weeks:tail[2],start:null,end:null,rawText:name+"/("+tail[1]+")"+tail[2]};
   if(rows.some(r=>same(r,c,term)))continue;
   rows.push(c);sources.push({course:c,cellId:cell.id,lineIds:lines.slice(i-1,i+4).map(l=>l.id)});
  }
 }
 return {rows,sources,term};
}
function locate(c:Course,ocr:OCR,term:number|null){
 const choices=cellsOf(ocr).filter(x=>nameKey(x.text).includes(nameKey(c.name))).map(x=>({cellId:x.id,day:x.day,lineIds:x.lineIds,supported:supported(c,x.text,term),sameDay:x.day===c.day}));
 return choices.sort((a,b)=>Number(b.supported)-Number(a.supported)||Number(b.sameDay)-Number(a.sameDay));
}
function anchorsFor(schedule:Schedule|null,ocr:OCR):Anchor[]{
 return (schedule?.courses??[]).flatMap(c=>{const a=locate(c,ocr,schedule!.termWeeks).find(x=>x.sameDay);return a?[{recordId:c.id,cellId:a.cellId,lineIds:a.lineIds,supported:a.supported}]:[];});
}
export function softFusion(ocr:OCR,baseline:Schedule|null){
 const e=explicitEvidence(ocr),term=e.term??baseline?.termWeeks??null,changes:unknown[]=[],uncertain:number[]=[];
 if(!baseline){const a=parseOCR(ocr);return {schedule:a.schedule,anchors:a.anchors,diagnostics:{fallback:"OCR",changes,document:documentKind(ocr),explicitCount:e.rows.length}};}
 const rows:Course[]=[...baseline.courses],matched=new Set<number>();
 for(const source of e.sources){
  const c=source.course;
  let i=rows.findIndex((r,j)=>!matched.has(j)&&same(r,c,term));
  if(i>=0){matched.add(i);continue;}
  const possible=rows.map((r,j)=>({r,j})).filter(({r,j})=>!matched.has(j)&&sameName(r,c)&&r.day===c.day&&timeKey(r)===timeKey(c)&&
   // A different week range may describe a separate real occurrence.
   e.rows.filter(x=>sameName(x,c)&&x.day===c.day&&timeKey(x)===timeKey(c)).length===1);
  if(possible.length===1){
   const {r,j}=possible[0];
   // Use explicit OCR range only when full period + week evidence exists.
   if(parseWeekNumbers(c.weeks,term)&&hasTime(c)){
    rows[j]={...r,weeks:c.weeks,timeLabel:c.timeLabel,rawText:c.rawText};matched.add(j);
    changes.push({type:"explicit_field_correction",before:r,after:rows[j],cellId:source.cellId});uncertain.push(c.day);continue;
   }
  }
  if(rows.length<150){rows.push(c);matched.add(rows.length-1);changes.push({type:"explicit_ocr_addition",record:c,cellId:source.cellId});uncertain.push(c.day);}
 }
 // A copied record may appear on an adjacent day. Suppress only a redundant, fully
 // supported counterpart when there is a mapped, occupied target day with no title evidence.
 // Keep every suppressed candidate and rationale in the exported audit trail.
 const mapped=new Set(ocr.grid.regions.map(r=>r.day));
 const kept=rows.filter((r,j)=>{
  if(matched.has(j)||!hasTime(r)||!parseWeekNumbers(r.weeks,term)||!mapped.has(r.day)||observed(ocr,r.day,r.name))return true;
  const other=e.rows.filter(c=>c.day!==r.day&&sameContent(c,r,term));
  if(other.length!==1||!rows.some((c,k)=>k!==j&&same(c,other[0],term)))return true;
  if(!cellsOf(ocr).some(c=>c.day===r.day&&c.lineIds.length>0))return true;
  changes.push({type:"suspected_cross_day_copy_suppressed",record:r,counterpart:other[0]});uncertain.push(r.day);return false;
 });
 const schedule=makeSchedule(kept,baseline,ocr,uncertain)??baseline;
 return {schedule,anchors:anchorsFor(schedule,ocr),diagnostics:{changes,explicitCount:e.rows.length,document:documentKind(ocr),unanchored:schedule.courses.filter(c=>!locate(c,ocr,term).some(a=>a.sameDay)).map(c=>c.id),uncertainDays:[...new Set(uncertain)]}};
}
export function regionalMerge(ocr:OCR,raw:unknown,base:Schedule|null){
 const root=raw&&typeof raw==="object"?raw as Record<string,unknown>:{};
 const regions=ocr.grid.regions;
 const candidates=Array.isArray(root.courses)?root.courses.slice(0,150):[];
 const notes:unknown[]=[];
 const rows:Record<string,unknown>[]=candidates.flatMap((x,i)=>{
  if(!x||typeof x!=="object")return [];
  const row=x as Record<string,unknown>;
  const id=typeof row.sourceRegion==="string"?row.sourceRegion:null;
  const region=regions.find((_,j)=>id==="R"+j);
  if(region){if(row.day!==region.day)notes.push({type:"region_day_override",index:i,reported:row.day,day:region.day});return [{...row,day:region.day,sourceDayLabel:"周"+"一二三四五六日"[region.day-1]}];}
  // Missing region is not a reason to throw away a real course.
  notes.push({type:"unanchored_candidate_retained",index:i,region:id});return [row];
 });
 const p=parseExtraction({...root,courses:rows}).result;
 const candidate=p.success&&p.data.status==="ok"?buildTimetable(p.data):null;
 if(!candidate)return {schedule:base,anchors:anchorsFor(base,ocr),diagnostics:{fallback:"V1",notes,raw},partial:true};
 // Unmapped weekdays are not evidence of absence. Preserve baseline candidates on
 // those days only when the regional model missed the same record.
 const term=candidate.termWeeks??base?.termWeeks??null,merged:Course[]=[...candidate.courses];
 const missingDays=base?.courses.filter(c=>!regions.some(r=>r.day===c.day))??[];
 for(const c of missingDays)if(!merged.some(r=>same(c,r,term))&&merged.length<150){merged.push(c);notes.push({type:"unmapped_day_baseline_retained",record:c});}
 const schedule=makeSchedule(merged,candidate,ocr,missingDays.map(c=>c.day))??candidate;
 return {schedule,anchors:anchorsFor(schedule,ocr),diagnostics:{notes,raw,document:documentKind(ocr),regionCount:regions.length},partial:false};
}
export function evidenceScore(s:Schedule|null,ocr:OCR){
 if(!s)return {score:-1000,explicitRecall:0,grounded:0,known:0,unmapped:0};
 const e=explicitEvidence(ocr),t=e.term??s.termWeeks;
 const explicitRecall=e.rows.length?e.rows.filter(c=>s.courses.some(r=>same(c,r,t))).length/e.rows.length:0;
 const grounded=s.courses.filter(c=>observed(ocr,c.day,c.name)).length/s.courses.length;
 const known=s.courses.filter(c=>hasTime(c)&&(parseWeekNumbers(c.weeks,t)||c.start&&c.end)).length/s.courses.length;
 const unmapped=s.courses.filter(c=>!ocr.grid.regions.some(r=>r.day===c.day)).length;
 const extra=s.courses.filter(c=>e.rows.some(x=>x.day!==c.day&&sameContent(x,c,t))&&!observed(ocr,c.day,c.name)&&ocr.grid.regions.some(r=>r.day===c.day)).length/s.courses.length;
 return {score:4*explicitRecall+2*grounded+known-2*extra,explicitRecall,grounded,known,unmapped};
}
export function adaptive(ocr:OCR,previous:Partial<Record<"B0"|"V1"|"V5"|"V6",Result>>){
 const v1=previous.V1?.schedule??null,v5=previous.V5?.schedule??null,v6=previous.V6?.schedule??null;
 const scores={V1:evidenceScore(v1,ocr),V5:evidenceScore(v5,ocr),V6:evidenceScore(v6,ocr)};
 const doc=documentKind(ocr);
 let chosen:"V1"|"V5"|"V6"="V1",reason="unresolved layout: prefer full-image context";
 if(doc.kind==="catalog"){reason="explicit selection-interface signals: retain catalog, do not score as personal timetable";if(!v1)chosen=v5?"V5":"V6";}
 else if(ocr.grid.status==="mapped"){
  if(v5&&scores.V5.score>=scores.V1.score-0.01){chosen="V5";reason="soft fusion retains or improves explicit OCR evidence";}
  if(v6&&scores.V6.score>scores[chosen].score+0.35){chosen="V6";reason="regional extraction has materially stronger evidence score";}
 }else if(!v1)chosen=v5?"V5":"V6";
 const base=previous[chosen]?.schedule??null;
 const schedule=base?makeSchedule(base.courses,base,ocr)??base:null;
 return {schedule,anchors:anchorsFor(schedule,ocr),diagnostics:{chosen,reason,scores,document:doc,heuristic:true,comparisonOnly:true},chosen};
}
