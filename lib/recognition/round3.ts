import type {CanonicalSchedule,Course} from "../schema";
import {canonicalScheduleSchema} from "../schema";
import {buildTimetable,parsePeriods,parseWeekNumbers} from "../timetable";
import {parseExtraction} from "../normalize-extraction";
import {cellsOf,compact,parseOCR} from "./evidence";
import {documentKind,makeSchedule} from "./round2";
import type {OCR,Anchor} from "./types";

type Schedule=CanonicalSchedule;
type Evidence={course:Course;cellId:string;lineIds:number[];format:"explicit"|"axis";quality:number};
const key=(s:string)=>compact(s).replace(/[()（）【】[\]《》]/g,"");
const wk=(c:Course,t:number|null)=>JSON.stringify(parseWeekNumbers(c.weeks,t)??key(c.weeks??""));
const tk=(c:Course)=>JSON.stringify(parsePeriods(c.timeLabel)??(c.start&&c.end?[c.start,c.end]:c.timeLabel??null));
const known=(c:Course)=>!!parsePeriods(c.timeLabel)||!!(c.start&&c.end);
const normPeriod=(p:[number,number])=>"第"+p[0]+(p[0]===p[1]?"":"-"+p[1])+"节";
const norm=(s:string)=>s.normalize("NFKC").replace(/[–—−~～至]/g,"-");
const center=(l:OCR["lines"][number])=>[l.box.reduce((n,p)=>n+p[0],0)/4,l.box.reduce((n,p)=>n+p[1],0)/4];
const rect=(l:OCR["lines"][number])=>[Math.min(...l.box.map(p=>p[0])),Math.min(...l.box.map(p=>p[1])),Math.max(...l.box.map(p=>p[0])),Math.max(...l.box.map(p=>p[1]))];
const termOf=(ocr:OCR,base:Schedule|null)=>{
 const hit=ocr.lines.flatMap(l=>Array.from(l.text.matchAll(/(?:共\s*(\d{1,2})\s*周|(?:total|semester)\s*(\d{1,2})\s*weeks)/gi),m=>Number(m[1]??m[2]))).filter(n=>n>=1&&n<=60);
 return new Set(hit).size===1?hit[0]:base?.termWeeks??null;
};
function titleLike(s:string){return /^[\p{L}][^/\n]{1,99}$/u.test(s)&&!/(?:\d+周|\d+节|教室|地点|学分|打印时间|实践课程[:：]|教师[:：])/.test(s);}
function lev(a:string,b:string){let prev=Array.from({length:b.length+1},(_,i)=>i);for(let i=1;i<=a.length;i++){const next=[i];for(let j=1;j<=b.length;j++)next[j]=Math.min(next[j-1]+1,prev[j]+1,prev[j-1]+(a[i-1]===b[j-1]?0:1));prev=next;}return prev[b.length];}
export function nameRelation(a:string,b:string){
 const x=key(a),y=key(b);if(!x||!y)return 0;if(x===y)return 1;
 // Short names and numeric course variants must never be fuzzy matched.
 if(Math.min(x.length,y.length)<5||x.match(/\d+$/)?.[0]!==y.match(/\d+$/)?.[0])return 0;
 if(x.includes(y)||y.includes(x))return .9;
 return 1-lev(x,y)/Math.max(x.length,y.length)>=.88?.8:0;
}
function same(a:Course,b:Course,t:number|null){return a.day===b.day&&key(a.name)===key(b.name)&&tk(a)===tk(b)&&wk(a,t)===wk(b,t);}
function uniq(e:Evidence[],t:number|null){
 const out:Evidence[]=[];
 for(const c of e){const i=out.findIndex(x=>same(x.course,c.course,t)&&x.cellId===c.cellId);if(i<0)out.push(c);else if(c.quality>out[i].quality)out[i]=c;}
 return out;
}
/** Recover adjacent title lines by actual text geometry. Never cross a slash-delimited metadata line. */
export function explicitBlocks(ocr:OCR,base:Schedule|null){
 const term=termOf(ocr,base),out:Evidence[]=[],prior=parseOCR(ocr);
 for(const c of prior.schedule?.courses??[]){
  const a=prior.anchors.find(x=>x.recordId===c.id);if(a)out.push({course:c,cellId:a.cellId,lineIds:a.lineIds,format:"explicit",quality:.85});
 }
 for(const cell of cellsOf(ocr)){
  const lines=cell.lineIds.map(id=>({id,text:norm(ocr.lines[id].text),box:rect(ocr.lines[id])}));
  for(let i=0;i<lines.length;i++){
   const current=lines[i],slash=current.text.indexOf("/");
   if(slash<0||!/^\/\s*\(\s*\d/.test(current.text.slice(slash)))continue;
   let name=current.text.slice(0,slash).trim(),first=i;
   // A trailing name fragment may precede the slash on its own line. Only join
   // nearby, aligned title-like lines; stop at previous record's metadata.
   for(let j=i-1;j>=Math.max(0,i-3);j--){
    const p=lines[j],n=lines[j+1],s=p.text.trim();
    if(!titleLike(s)||p.text.includes("/")||n.box[1]-p.box[3]>Math.max(8,(p.box[3]-p.box[1])*.7)||Math.abs(p.box[0]-n.box[0])>Math.max(12,(cell.bounds[2]-cell.bounds[0])*.2))break;
    // Do not absorb teacher/room fragments when the current line already has a complete title.
    if(name&&first===i&&current.text.slice(0,slash).length<3)break;
    name=s+name;first=j;
   }
   if(!titleLike(name))continue;
   const tail=lines.slice(i,i+6).map((l,j)=>j===0?l.text.slice(slash):l.text).join("").match(/^\/\s*\(\s*((?:第)?\d{1,2}(?:-\d{1,2})?节)\s*\)\s*([^/]+)(?=\/|$)/);
   if(!tail)continue;
   const period=parsePeriods(tail[1]),weeks=tail[2].trim();if(!period||!parseWeekNumbers(weeks,term))continue;
   const c:Course={name,day:cell.day,start:null,end:null,timeLabel:normPeriod(period),weeks,rawText:name+"/("+tail[1]+")"+weeks};
   const ids=lines.slice(first,i+Math.min(6,lines.length-i)).map(l=>l.id);
   // Remove a shorter suffix candidate only in the same physical cell/time/week.
   const ix=out.findIndex(x=>x.cellId===cell.id&&x.course.day===c.day&&tk(x.course)===tk(c)&&wk(x.course,term)===wk(c,term)&&key(c.name).endsWith(key(x.course.name)));
   const e:Evidence={course:c,cellId:cell.id,lineIds:ids,format:"explicit",quality:.98};
   if(ix>=0)out[ix]=e;else out.push(e);
  }
 }
 return {term,items:uniq(out,term)};
}
const dayLabel=(s:string)=>{
 const m=s.trim().match(/^(?:周|星期|礼拜)([一二三四五六日天1-7])$/);
 if(m)return /^\d$/.test(m[1])?Number(m[1]):Math.min(7,"一二三四五六日天".indexOf(m[1])+1);
 const en=["mon","tue","wed","thu","fri","sat","sun"],i=en.findIndex(x=>s.trim().toLowerCase().startsWith(x));return i>=0?i+1:null;
};
function periodNumber(s:string){
 const m=norm(s).replace(/\s+/g,"").match(/^第?([一二三四五六七八九十]|十[一二三四五六七八九]|\d{1,2})节?$/);
 if(!m||!s.includes("第")&&!s.includes("节"))return null;
 const v=m[1],n=/^\d+$/.test(v)?Number(v):v==="十"?10:v.startsWith("十")?10+"一二三四五六七八九".indexOf(v[1])+1:"一二三四五六七八九".indexOf(v)+1;
 return n>=1&&n<=30?n:null;
}
/** Extend the weekday axis only from an actual header and near-uniform existing grid spacing. */
export function weekdayRegions(ocr:OCR){
 const regions=ocr.grid.regions.map(r=>({...r,inferred:false}));
 if(ocr.grid.orientation!=="weekdays_in_columns"||regions.length<3)return regions;
 const sorted=[...regions].sort((a,b)=>a.bounds[0]-b.bounds[0]),widths=sorted.map(r=>r.bounds[2]-r.bounds[0]),w=widths.reduce((n,v)=>n+v,0)/widths.length;
 if(widths.some(v=>Math.abs(v-w)>w*.12))return regions;
 const top=Math.min(...regions.map(r=>r.bounds[1])),bottom=Math.max(...regions.map(r=>r.bounds[3]));
 for(const l of ocr.lines){
  const d=dayLabel(l.text),[x,y]=center(l);
  if(!d||l.score<.85||regions.some(r=>r.day===d)||y>=top+3)continue;
  const near=sorted.reduce((a,b)=>Math.abs((a.bounds[0]+a.bounds[2])/2-x)<Math.abs((b.bounds[0]+b.bounds[2])/2-x)?a:b);
  const mid=(near.bounds[0]+near.bounds[2])/2,step=Math.round((x-mid)/w);
  if(!step||Math.abs(x-mid-step*w)>w*.13||Math.abs(step)>2)continue;
  const left=Math.round(near.bounds[0]+step*w),right=Math.round(near.bounds[2]+step*w);
  if(left<0||right>ocr.width+3||regions.some(r=>left<r.bounds[2]-3&&right>r.bounds[0]+3))continue;
  regions.push({day:d,bounds:[left,top,Math.min(right,ocr.width),bottom],inferred:true});
 }
 return regions;
}
/** Parse explicit duration and recurrence markers, using actual labelled period axis
 * and observed cell intervals; never convert "2节/周" into period 2.
 */
export function axisBlocks(ocr:OCR,term:number|null){
 const regions=weekdayRegions(ocr),out:Evidence[]=[],unresolved:unknown[]=[];
 if(ocr.grid.orientation!=="weekdays_in_columns"||regions.length<3)return {items:out,unresolved,regions};
 const left=Math.min(...regions.map(r=>r.bounds[0]));
 const axis=ocr.lines.flatMap(l=>{const p=periodNumber(l.text),[x,y]=center(l);return p&&x<left&&l.score>=.65?[{p,y}]:[];}).sort((a,b)=>a.y-b.y);
 if(axis.length<4||new Set(axis.map(a=>a.p)).size!==axis.length||axis.some((a,i)=>i>0&&a.p!==axis[i-1].p+1))return {items:out,unresolved,regions};
 const allCells=cellsOf(ocr);
 for(const r of regions){
  const ids=ocr.lines.map((l,i)=>({l,i,xy:center(l)})).filter(x=>x.xy[0]>r.bounds[0]&&x.xy[0]<r.bounds[2]&&x.xy[1]>r.bounds[1]&&x.xy[1]<r.bounds[3]).sort((a,b)=>a.xy[1]-b.xy[1]);
  for(let i=1;i<ids.length;i++){
   const item=ids[i],m=norm(item.l.text).replace(/\s+/g,"").match(/^\{?第?(\d{1,2}(?:-\d{1,2})?)周[|｜](\d{1,2})节\/(单周|双周|周)\}?$/);
   if(!m)continue;
   const title=ids[i-1],name=title.l.text.trim(),duration=Number(m[2]),weeks=m[1]+"周"+(m[3]==="周"?"":"("+m[3]+")");
   if(!titleLike(name)||item.xy[1]-title.xy[1]>Math.max(28,(rect(title.l)[3]-rect(title.l)[1])*2.2)||duration<1||duration>12||!parseWeekNumbers(weeks,term))continue;
   const own=allCells.find(c=>c.day===r.day&&c.bounds[1]<item.xy[1]&&item.xy[1]<c.bounds[3]);
   const bands=allCells.filter(c=>c.bounds[1]<item.xy[1]&&item.xy[1]<c.bounds[3]).map(c=>axis.filter(a=>a.y>c.bounds[1]&&a.y<c.bounds[3]));
   const ownAxis=own?axis.filter(a=>a.y>own.bounds[1]&&a.y<own.bounds[3]):[];
   const exact=bands.filter(b=>b.length===duration).map(b=>b[0].p);
   let start:number|null=null;
   if(ownAxis.length===duration)start=ownAxis[0].p;
   else if(new Set(exact).size===1)start=exact[0];
   else if(ownAxis.length===1&&axis.some(a=>a.p===ownAxis[0].p+duration-1)){
    // A global line may split a merged cell; only extend from the first label
    // when the title is in that cell, and a real subsequent label exists.
    if(title.xy[1]>own!.bounds[1]&&title.xy[1]<own!.bounds[3])start=ownAxis[0].p;
   }
   if(start===null){unresolved.push({day:r.day,name,weeks,duration,lineIds:[title.i,item.i]});continue;}
   const c:Course={name,day:r.day,start:null,end:null,timeLabel:normPeriod([start,start+duration-1]),weeks,rawText:null};
   out.push({course:c,cellId:own?.id??"R"+r.day,lineIds:[title.i,item.i],format:"axis",quality:r.inferred?.83:.93});
  }
 }
 return {items:uniq(out,term),unresolved,regions};
}
export function structuralEvidence(ocr:OCR,base:Schedule|null){
 const explicit=explicitBlocks(ocr,base),axis=axisBlocks(ocr,explicit.term);
 return {term:explicit.term,items:uniq([...explicit.items,...axis.items],explicit.term),unresolved:axis.unresolved,regions:axis.regions};
}
function score(a:Course,b:Course,t:number|null){
 const n=nameRelation(a.name,b.name);if(!n)return -1;
 const time=tk(a)===tk(b),week=wk(a,t)===wk(b,t);
 if(a.day!==b.day&&(!time||!week||n<.9))return -1;
 // For same-day records, different time AND weeks may be independent arrangements.
 if(!time&&!week&&known(a)&&known(b)&&parseWeekNumbers(a.weeks,t)&&parseWeekNumbers(b.weeks,t))return -1;
 return n*4+(a.day===b.day?3:0)+(time?3:0)+(week?2:0);
}
function sourcesOnDay(ocr:OCR,c:Course){return cellsOf(ocr).some(x=>x.day===c.day&&key(x.text).includes(key(c.name)));}
function toSchedule(rows:Course[],base:Schedule,ocr:OCR,days:number[],unscheduled=base.unscheduled){
 const result=makeSchedule(rows,{...base,unscheduled},ocr,days);
 return result??base;
}
function anchorsFor(s:Schedule,items:Evidence[]):Anchor[]{
 return s.courses.flatMap(c=>{const a=items.find(x=>same(x.course,c,s.termWeeks));return a?[{recordId:c.id,cellId:a.cellId,lineIds:a.lineIds.slice(0,100),supported:true}]:[];});
}
/** Independent V8: one-to-one score-ranked alignment, requiring unique competing evidence.
 * No forced source IDs and no cross-day relocation based on a name alone.
 */
export function align(ocr:OCR,base:Schedule|null,items:Evidence[],fieldMode=false){
 const term=termOf(ocr,base),changes:unknown[]=[],conflicts:unknown[]=[],days:number[]=[];
 if(!base){const p=parseOCR(ocr);return {schedule:p.schedule,anchors:p.anchors,diagnostics:{fallback:"B0",changes,conflicts,explicitCount:items.length}};}
 const rows:Course[]=[...base.courses],taken=new Set<number>();
 const ordered=[...items].sort((a,b)=>b.quality-a.quality);
 for(const e of ordered){
  const c=e.course;
  const matches=rows.map((r,i)=>({r,i,s:score(r,c,term)})).filter(x=>!taken.has(x.i)&&x.s>=7).sort((a,b)=>b.s-a.s);
  const best=matches[0],ambiguous=best&&matches[1]&&best.s-matches[1].s<.4;
  if(ambiguous){conflicts.push({type:"ambiguous_alignment",evidence:e,candidates:matches.slice(0,3)});continue;}
  if(best){
   const {r,i}=best;
   if(r.day!==c.day){
    // Both explicit time+weeks and a unique other-day match are needed; never
    // move a course if its original day contains its title or is not mapped.
    const canMove=ocr.grid.regions.some(x=>x.day===r.day)&&!sourcesOnDay(ocr,r)&&!items.some(x=>x.course.day===r.day&&nameRelation(x.course.name,r.name)>=.9&&tk(x.course)===tk(r)&&wk(x.course,term)===wk(r,term));
    if(!canMove){if(rows.length<150){rows.push(c);taken.add(rows.length-1);changes.push({type:"separate_day_evidence",record:c,source:e});days.push(c.day);}continue;}
   }
   // Exact equivalent time/week values are not changed gratuitously.
   // Keep longer complete title when OCR only has a suffix. Fuzzy spelling alone
   // does not justify replacement.
   const name=key(c.name).includes(key(r.name))&&c.name.length>r.name.length?c.name:r.name;
   const sameDay=r.day===c.day;
   const exactName=key(c.name)===key(r.name);
   const sameTime=tk(r)===tk(c),sameWeek=wk(r,term)===wk(c,term);
   const uniquelyTimed=!items.some(x=>x!==e&&x.course.day===c.day&&nameRelation(x.course.name,c.name)>=.9&&tk(x.course)===tk(c)&&wk(x.course,term)!==wk(c,term));
   const timeUpdate=fieldMode&&sameDay&&exactName&&(sameWeek||e.format==="axis")&&known(c)&&(!sameTime);
   const weekUpdate=sameDay&&(sameTime||timeUpdate)&&uniquelyTimed&&!!parseWeekNumbers(c.weeks,term)&&(!sameWeek);
   const changedTime=timeUpdate?c.timeLabel:r.timeLabel;
   const changedWeeks=weekUpdate?c.weeks:r.weeks;
   const next:Course={...r,name,day:c.day,timeLabel:changedTime,weeks:changedWeeks,rawText:(timeUpdate||weekUpdate||name!==r.name)?null:r.rawText};
   // Raw OCR scheduling excerpt can override fields downstream, so clear a
   // stale excerpt when individual fields were reconciled; preserve it in audit.
   if(!same(r,next,term)){rows[i]=next;changes.push({type:"aligned_fields",before:r,after:next,evidence:e,fields:{name:name!==r.name,day:c.day!==r.day,time:timeUpdate,weeks:weekUpdate}});days.push(r.day,c.day);}
   taken.add(i);continue;
  }
  if(rows.some(r=>same(r,c,term)))continue;
  if(rows.length<150){rows.push(c);taken.add(rows.length-1);changes.push({type:"unmatched_explicit_addition",record:c,evidence:e});days.push(c.day);}
 }
 // A redundant cross-day candidate can be suppressed only when its complete
 // content is independently anchored elsewhere and no title is observed on
 // the mapped original day. Retain unanchored or ambiguous candidates.
 const keep=rows.filter((r,i)=>{
  if(taken.has(i)||!known(r)||!parseWeekNumbers(r.weeks,term)||!ocr.grid.regions.some(x=>x.day===r.day)||sourcesOnDay(ocr,r))return true;
  const other=items.filter(x=>x.course.day!==r.day&&nameRelation(x.course.name,r.name)===1&&tk(x.course)===tk(r)&&wk(x.course,term)===wk(r,term));
  if(other.length!==1||!rows.some((x,j)=>j!==i&&same(x,other[0].course,term))||!cellsOf(ocr).some(c=>c.day===r.day&&c.lineIds.length))return true;
  changes.push({type:"suspected_duplicate_suppressed",record:r,evidence:other[0]});days.push(r.day);return false;
 });
 const schedule=toSchedule(keep,base,ocr,days);
 return {schedule,anchors:anchorsFor(schedule,items),diagnostics:{changes,conflicts,explicitCount:items.length,document:documentKind(ocr),fieldMode}};
}
/** Practice candidates from footer OCR: only extract when a literal separator
 * distinguishes title from other metadata, or a model-proposed title is a
 * literal prefix; unresolved concatenated names stay in diagnostics.
 */
export function footerEvidence(ocr:OCR,base:Schedule|null){
 const term=termOf(ocr,base),candidates:Schedule["unscheduled"]=[],unresolved:unknown[]=[];
 for(const [i,l] of ocr.lines.entries()){
  const text=norm(l.text).trim(),[,y]=center(l);
  if(y<ocr.height*.78||!/(?:实践课程|集中实训|实习|课程设计|实践|practicum|internship)/i.test(text))continue;
  const m=text.match(/^(?:实践课程[:：]\s*)?(.{2,100}?)\s*(?:\(共\d+周\))?\s*\/\s*(第?\d{1,2}(?:-\d{1,2})?周)[;；。]?$/);
  if(!m||!parseWeekNumbers(m[2],term))continue;
  const prefix=m[1].replace(/\(共\d+周\)$/,"").trim();
  const known=base?.unscheduled.filter(c=>key(prefix).startsWith(key(c.name))&&parseWeekNumbers(c.weeks,term)&&wk({...c,day:1,start:null,end:null,timeLabel:null},term)===JSON.stringify(parseWeekNumbers(m[2],term)))??[];
  if(known.length===1)candidates.push({name:known[0].name,weeks:m[2]});
  else if(/[|｜]/.test(prefix)){const name=prefix.split(/[|｜]/)[0].trim();if(name)candidates.push({name,weeks:m[2]});}
  else unresolved.push({lineId:i,raw:text,reason:"title/teacher boundary not explicit"});
 }
 return {candidates,unresolved};
}
/** V9: independent structure-conditioned model output; deterministic evidence
 * repairs formatting and explicit schedules, with V1 as explicit fallback. */
export function reconstruct(ocr:OCR,raw:unknown,base:Schedule|null){
 const parsed=parseExtraction(raw).result;
 const candidate=parsed.success&&parsed.data.status==="ok"?buildTimetable(parsed.data):null;
 const selected=candidate??base;
 const structure=structuralEvidence(ocr,selected);
 const result=align(ocr,selected,structure.items,true);
 if(!result.schedule)return {...result,diagnostics:{...result.diagnostics,raw,structure, fallback:candidate?null:"V1"},partial:true};
 const footer=footerEvidence(ocr,result.schedule),unscheduled=[...result.schedule.unscheduled];
 for(const c of footer.candidates)if(!unscheduled.some(x=>key(x.name)===key(c.name)&&JSON.stringify(parseWeekNumbers(x.weeks,result.schedule!.termWeeks))===JSON.stringify(parseWeekNumbers(c.weeks,result.schedule!.termWeeks))))unscheduled.push(c);
 const schedule=toSchedule(result.schedule.courses,result.schedule,ocr,[],unscheduled.slice(0,50));
 return {...result,schedule,anchors:anchorsFor(schedule,structure.items),diagnostics:{...result.diagnostics,raw,structure,footer,fallback:candidate?null:"V1"},partial:!candidate};
}
/** V10: keep V8 candidate set, use structural evidence for each explicit field
 * and V9 only as corroboration, not as an unconditional union. */
export function fieldFusion(ocr:OCR,v1:Schedule|null,v8:Schedule|null,v9:Schedule|null){
 const base=v8??v1??v9,structure=structuralEvidence(ocr,base);
 const result=align(ocr,base,structure.items,true);
 if(!result.schedule)return result;
 const term=result.schedule.termWeeks,rows:Course[]=[...result.schedule.courses],updates:unknown[]=[];
 if(v9){
  for(const [i,r] of rows.entries()){
   const matches=v9.courses.filter(c=>c.day===r.day&&nameRelation(c.name,r.name)>=.9&&tk(c)===tk(r)&&wk(c,term)===wk(r,term));
   if(matches.length===1&&key(matches[0].name).includes(key(r.name))&&matches[0].name.length>r.name.length){
    const c=matches[0];
    if(cellsOf(ocr).some(x=>x.day===r.day&&key(x.text).includes(key(c.name)))){rows[i]={...r,name:c.name,rawText:null};updates.push({type:"corroborated_full_title",before:r,after:rows[i]});}
   }
  }
 }
 const unscheduled=[...result.schedule.unscheduled];
 // A new practice entry requires OCR evidence of both title and week range.
 for(const c of v9?.unscheduled??[]){
  if(unscheduled.some(x=>nameRelation(x.name,c.name)>=.9&&JSON.stringify(parseWeekNumbers(x.weeks,term))===JSON.stringify(parseWeekNumbers(c.weeks,term))))continue;
  if(c.weeks&&parseWeekNumbers(c.weeks,term)&&ocr.lines.some(l=>center(l)[1]>ocr.height*.78&&key(l.text).includes(key(c.name))&&key(l.text).includes(key(c.weeks!)))){unscheduled.push(c);updates.push({type:"footer_corroborated",record:c});}
 }
 const schedule=toSchedule(rows,result.schedule,ocr,[],unscheduled.slice(0,50));
 return {...result,schedule,anchors:anchorsFor(schedule,structure.items),diagnostics:{...result.diagnostics,updates,structure,footer:footerEvidence(ocr,schedule),fallback:!v8?"V1 or V9":null}};
}
