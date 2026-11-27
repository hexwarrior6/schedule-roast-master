import type {CanonicalSchedule,Course} from "../schema";
import {canonicalScheduleSchema} from "../schema";
import {parsePeriods,parseWeekNumbers,buildTimetable} from "../timetable";
import {parseExtraction} from "../normalize-extraction";
import {canonicalPeriod,refineGraph,evidenceDiagnostics} from "./round4";
import {structuralEvidence,footerEvidence} from "./round3";
import {compact} from "./evidence";
import type {OCR,Layout} from "./round4-types";

type Schedule=CanonicalSchedule;
const obj=(v:unknown):Record<string,unknown>|null=>v&&typeof v==="object"&&!Array.isArray(v)?v as Record<string,unknown>:null;
const key=(s:string)=>compact(s);
const time=(c:Course)=>JSON.stringify(parsePeriods(c.timeLabel)??(c.start&&c.end?[c.start,c.end]:c.timeLabel??null));
const same=(a:Course,b:Course)=>a.day===b.day&&key(a.name)===key(b.name)&&time(a)===time(b);
const weeks=(c:Course,t:number|null)=>parseWeekNumbers(c.weeks,t);
export function repairWeek(v:unknown){
 if(typeof v!=="string")return v;
 const s=v.normalize("NFKC").replace(/[–—−~～至]/g,"-").trim();
 // Only remove the attested presentation suffix "上" on an otherwise explicit
 // week expression. Never strip "不上", invent parity, or change numeric bounds.
 const candidate=s.replace(/周\s*上(?=\s*[,，、;；]|$|\s*\((?:单|双)(?:数)?周?\))/g,"周");
 return candidate!==s&&parseWeekNumbers(candidate,null)?candidate:v;
}
export function repairRaw(v:unknown){
 const root=obj(v);if(!root)return {value:v,repairs:[] as unknown[]};
 const repairs:unknown[]=[];
 const clean=(x:unknown,index:number,section:string)=>{
  const r=obj(x);if(!r)return x;
  const result={...r};
  for(const field of ["weeks","timeLabel"]){
   const old=r[field];
   const next=field==="weeks"?repairWeek(old):typeof old==="string"?canonicalPeriod(old):old;
   if(next!==old){result[field]=next;repairs.push({section,index,field,before:old,after:next});}
  }
  // cleanCourseFields prioritizes embedded source excerpts over structured
  // fields. Repair the explicit week span there as well, with the same guard.
  for(const field of ["rawText","name"]){
   const old=r[field];if(typeof old!=="string")continue;
   const m=old.match(/^([^/／]+[/／]\s*[（(]\s*(?:第)?\d{1,2}(?:\s*[-–—~～至]\s*\d{1,2})?节\s*[）)]\s*)([^/／]*)(.*)$/);
   if(!m)continue;
   const next=repairWeek(m[2]);
   if(typeof next==="string"&&next!==m[2]){result[field]=m[1]+next+m[3];repairs.push({section,index,field,before:old,after:result[field]});}
  }
  return result;
 };
 return {value:{...root,courses:Array.isArray(root.courses)?root.courses.map((x,i)=>clean(x,i,"courses")):root.courses,unscheduled:Array.isArray(root.unscheduled)?root.unscheduled.map((x,i)=>clean(x,i,"unscheduled")):root.unscheduled},repairs};
}
export function normalizeLossless(raw:unknown){
 const repaired=repairRaw(raw),p=parseExtraction(repaired.value).result;
 const schedule=p.success&&p.data.status==="ok"?buildTimetable(p.data):null;
 // Keep originals at API boundary. Report surviving unresolved values rather
 // than claiming that arbitrary syntax is repairable.
 const root=obj(repaired.value);
 const unresolved=(Array.isArray(root?.courses)?root.courses:[]).flatMap((x,i)=>{
  const r=obj(x);return r&&typeof r.weeks==="string"&&r.weeks.trim()&&!parseWeekNumbers(r.weeks,schedule?.termWeeks??null)?[{index:i,name:r.name,weeks:r.weeks}]:[];
 });
 return {schedule,repairs:repaired.repairs,unresolved};
}
export function replayV12(raw:unknown,ocr:OCR|null,layout:Layout|null){
 const n=normalizeLossless(raw);
 const refined=ocr&&layout?refineGraph(n.schedule,ocr,layout):null;
 return {...n,schedule:refined?.schedule??n.schedule,graphChanges:refined?.changes??[]};
}
function rebuild(rows:Course[],base:Schedule,unscheduled=base.unscheduled){
 const candidate={...base,courses:rows.map((c,i)=>{const p=parsePeriods(c.timeLabel);return {...c,id:"c"+(i+1),periodStart:p?.[0]??null,periodEnd:p?.[1]??null,weekNumbers:parseWeekNumbers(c.weeks,base.termWeeks)};}),unscheduled};
 const parsed=canonicalScheduleSchema.safeParse(candidate);return parsed.success?parsed.data:base;
}
/** V17: no blind union; field repairs require independently readable same-day
 * explicit evidence. Keep conflicts and old fields in diagnostics. */
export function validateFields(base:Schedule|null,ocr:OCR|null,layout:Layout|null){
 if(!base||!ocr)return {schedule:base,changes:[] as unknown[],conflicts:[] as unknown[],footer:[] as unknown[],evidenceAvailable:false};
 const structure=structuralEvidence(ocr,base),changes:unknown[]=[],conflicts:unknown[]=[];
 const rows=base.courses.map(c=>{
  const named=structure.items.filter(e=>e.course.day===c.day&&key(e.course.name)===key(c.name));
  const compatible=named.filter(e=>time(e.course)===time(c)||(!c.start&&!c.end&&!parsePeriods(c.timeLabel)&&weeks(c,base.termWeeks)&&JSON.stringify(weeks(c,base.termWeeks))===JSON.stringify(weeks(e.course,base.termWeeks))));
  if(compatible.length!==1){if(named.length)conflicts.push({recordId:c.id,reason:"ambiguous or conflicting structure",candidates:named});return c;}
  const evidence=compatible[0],e=evidence.course;
  const oldW=weeks(c,base.termWeeks),newW=weeks(e,base.termWeeks),oldP=parsePeriods(c.timeLabel),newP=parsePeriods(e.timeLabel);
  const next={...c};
  if(!oldW&&newW)next.weeks=e.weeks;
  else if(oldW&&newW&&JSON.stringify(oldW)!==JSON.stringify(newW))conflicts.push({recordId:c.id,field:"weeks",model:c.weeks,evidence:e.weeks,lineIds:evidence.lineIds});
  if(!oldP&&!c.start&&!c.end&&newP)next.timeLabel=e.timeLabel;
  if(next.weeks!==c.weeks||next.timeLabel!==c.timeLabel){next.rawText=null;changes.push({recordId:c.id,before:c,after:next,lineIds:evidence.lineIds,cellId:evidence.cellId});}
  return next;
 });
 const footer=footerEvidence(ocr,base);
 const unscheduled=[...base.unscheduled];
 // No invented title/teacher boundaries, only explicit/footer corroboration.
 for(const e of footer.candidates)if(!unscheduled.some(c=>key(c.name)===key(e.name)&&JSON.stringify(parseWeekNumbers(c.weeks,base.termWeeks))===JSON.stringify(parseWeekNumbers(e.weeks,base.termWeeks)))&&unscheduled.length<50)unscheduled.push(e);
 const s=rebuild(rows,base,unscheduled);
 const refined=layout?refineGraph(s,ocr,layout):null;
 return {schedule:refined?.schedule??s,changes:[...changes,...(refined?.changes??[])],conflicts,footer:footer.unresolved,evidenceAvailable:structure.items.length>0||!!layout?.blocks.length,diagnostics:layout?evidenceDiagnostics(refined?.schedule??s,ocr,layout):null,structureCount:structure.items.length};
}
