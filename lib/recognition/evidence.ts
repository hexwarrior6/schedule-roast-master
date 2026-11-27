import type {CanonicalSchedule,Course,Extraction} from "../schema";
import {parsePeriods,parseWeekNumbers,buildTimetable} from "../timetable";
import {parseExtraction} from "../normalize-extraction";
import type {OCR,Anchor} from "./types";

export const compact=(s:string)=>s.normalize("NFKC").toLowerCase().replace(/[\s、，,；;。:：]/g,"").replace(/[–—−~～至]/g,"-");
export function cellsOf(ocr:OCR){return ocr.grid.cells.map((c,i)=>({...c,id:"C"+i}));}
export function recordKey(c:Course,term:number|null){
 const p=parsePeriods(c.timeLabel),w=parseWeekNumbers(c.weeks,term);
 return JSON.stringify([compact(c.name),c.day,p??c.timeLabel,c.start,c.end,w??compact(c.weeks??"")]);
}
export function contentKey(c:Course,term:number|null){return recordKey({...c,day:1},term);}
export function supported(c:Course,text:string,term:number|null){
 const s=compact(text),name=compact(c.name);
 if(!name||!s.includes(name))return false;
 const p=parsePeriods(c.timeLabel);
 if(p&&!s.includes(p[0]===p[1]?p[0]+"节":p[0]+"-"+p[1]+"节"))return false;
 if(c.start&&(!s.includes(c.start.replace(":",""))||!c.end||!s.includes(c.end.replace(":",""))))return false;
 // Check the literal week label as well as parsed validity, not a bag of digits.
 if(c.weeks&&parseWeekNumbers(c.weeks,term)&&!s.includes(compact(c.weeks)))return false;
 return true;
}
function termOf(ocr:OCR){
 const hits=ocr.lines.flatMap(l=>[...l.text.matchAll(/(?:共\s*(\d{1,2})\s*周|(?:total|semester)\s*(\d{1,2})\s*weeks)/gi)].map(m=>Number(m[1]??m[2]))).filter(n=>n>0&&n<=60);
 return new Set(hits).size===1?hits[0]:null;
}
export function canonical(courses:Course[],term:number|null,ocr:OCR,base?:CanonicalSchedule){
 if(!courses.length)return null;
 const days=new Set(ocr.grid.regions.map(r=>r.day));
 const extraction={status:"ok",kind:base?.kind??"uncertain",termWeeks:term,unscheduled:base?.unscheduled??[],confidence:"low",warnings:[],
 coverage:Array.from({length:7},(_,i)=>({day:i+1,count:courses.filter(c=>c.day===i+1).length,visibility:base?.coverage.find(d=>d.day===i+1)?.visibility==="not_shown"&&!courses.some(c=>c.day===i+1)?"not_shown":days.has(i+1)||courses.some(c=>c.day===i+1)?"uncertain":"not_shown"})),courses};
 const p=parseExtraction(extraction).result;
 return p.success&&p.data.status==="ok"?buildTimetable(p.data):null;
}
/** Deterministic OCR-only baseline. Explicit formats only, never infer a missing time or week. */
export function parseOCR(ocr:OCR){
 const term=termOf(ocr),rows:Course[]=[],sources:{key:string;cellId:string;lineIds:number[]}[]=[];
 for(const cell of cellsOf(ocr)){
  const parts=cell.lineIds.map(id=>ocr.lines[id]?.text??"").join("\n").normalize("NFKC");
  // The prefix may wrap across up to three lines. Do not absorb numeric-only metadata lines.
  const matches=parts.matchAll(/(?:^|\n)([\p{L}][^/\n]{0,99}(?:\n[\p{L}][^/\n]{0,99}){0,2})\/\s*\(\s*((?:第)?\d{1,2}(?:\s*[-–—~～至]\s*\d{1,2})?节)\s*\)\s*([^/]*?)(?=\/|$)/gu);
  for(const m of matches){
   const name=m[1].replace(/\n/g,"").trim(),label=m[2].trim(),week=m[3].replace(/\s+/g,"").trim();
   if(!parsePeriods(label)||!parseWeekNumbers(week,term)||!name||name.length>100)continue;
   const c:Course={name,day:cell.day,start:null,end:null,timeLabel:label,weeks:week,rawText:name+"/("+label+")"+week};
   rows.push(c);sources.push({key:recordKey(c,term),cellId:cell.id,lineIds:cell.lineIds});
  }
  // Explicit English clock/week layout, no inference from a course title alone.
  const english=parts.match(/^([A-Za-z][^\n/]{0,99})\n\s*(\d{1,2}:\d{2})\s*[-–—]\s*(\d{1,2}:\d{2})\s*\n\s*(?:Weeks?|Wks?)\s*[: ]?\s*([0-9,\s-]+)\s*$/i);
  if(english){
    const clock=(x:string)=>x.padStart(5,"0");
    const c:Course={name:english[1],day:cell.day,start:clock(english[2]),end:clock(english[3]),timeLabel:null,weeks:english[4].trim(),rawText:parts.slice(0,300)};
    if(parseWeekNumbers(c.weeks,term)&&c.start!<c.end!){rows.push(c);sources.push({key:recordKey(c,term),cellId:cell.id,lineIds:cell.lineIds});}
  }
 }
 const schedule=canonical(rows,term,ocr);
 const anchors:Anchor[]=(schedule?.courses??[]).flatMap(c=>{const s=sources.find(x=>x.key===recordKey(c,term));return s?[{cellId:s.cellId,lineIds:s.lineIds,supported:true,recordId:c.id}]:[]});
 return {schedule,anchors,diagnostics:{parsedCells:new Set(anchors.map(a=>a.cellId)).size,unparsedCells:cellsOf(ocr).filter(c=>!anchors.some(a=>a.cellId===c.id)).map(c=>c.id)}};
}
export function fuse(ocr:OCR,a:CanonicalSchedule|null,b:CanonicalSchedule|null,ocrAnchors:Anchor[]){
 if(!a||!b)return {schedule:a??b,diagnostics:{fallback:a?"OCR only":b?"VLM only":"neither",matches:0},anchors:a?ocrAnchors:[]};
 const term=a.termWeeks??b.termWeeks,rows:Course[]=[],taken=new Set<number>(),conflicts:unknown[]=[];
 // One-to-one exact record matching. Then match by same day/name and compatible time,
 // requiring a unique candidate. Never collapse legitimate repeated classes across days.
 let matches=0;
 const compatible=(x:Course,y:Course)=>x.day===y.day&&compact(x.name)===compact(y.name)&&(
   (parsePeriods(x.timeLabel)&&JSON.stringify(parsePeriods(x.timeLabel))===JSON.stringify(parsePeriods(y.timeLabel)))||
   (x.start&&x.end&&x.start===y.start&&x.end===y.end));
 for(const x of a.courses){
  let i=b.courses.findIndex((y,j)=>!taken.has(j)&&recordKey(x,term)===recordKey(y,term));
  if(i<0){const possible=b.courses.map((y,j)=>({y,j})).filter(({y,j})=>!taken.has(j)&&compatible(x,y));if(possible.length===1)i=possible[0].j;}
  if(i>=0){const y=b.courses[i];taken.add(i);matches++;if(recordKey(x,term)!==recordKey(y,term))conflicts.push({type:"same_position_field_conflict",ocr:x,vlm:y});}
  rows.push(x);
 }
 for(const [i,y] of b.courses.entries()){
  if(taken.has(i))continue;
  // Unmatched VLM records remain candidates; cross-day similarity alone is never grounds for deletion.
  // Reject only if same physical OCR cell supports this content on another day AND
  // current day has no corresponding evidence, marking the retained candidate uncertain instead.
  const sameContent=a.courses.filter(x=>contentKey(x,term)===contentKey(y,term));
  if(sameContent.length)conflicts.push({type:"possible_cross_day_duplicate",vlm:y,ocrDays:sameContent.map(x=>x.day)});
  rows.push(y);
 }
 const schedule=canonical(rows.slice(0,150),term,ocr,b);
 const anchors=(schedule?.courses??[]).flatMap(c=>{const prev=a.courses.find(x=>recordKey(x,term)===recordKey(c,term));const an=ocrAnchors.find(x=>x.recordId===prev?.id);return an?[{...an,recordId:c.id}]:[]});
 return {schedule,anchors,diagnostics:{matches,conflicts,ocrOnly:a.courses.length-matches,vlmOnly:b.courses.length-matches,truncated:rows.length>150}};
}
export function fromModel(value:unknown){const p=parseExtraction(value).result;return p.success&&p.data.status==="ok"?{schedule:buildTimetable(p.data),extraction:p.data}:null;}
export function anchored(value:unknown,ocr:OCR){
 const root=value as {courses?:unknown[]};const cells=cellsOf(ocr);const rows:Record<string,unknown>[]=[];const refs:{cellId:string;lineIds:number[];supported:boolean;key:string}[]=[];const issues:unknown[]=[];
 const term=typeof (value as {termWeeks?:unknown})?.termWeeks==="number"?Number((value as {termWeeks:number}).termWeeks):termOf(ocr);
 for(const [index,item] of (Array.isArray(root?.courses)?root.courses:[]).entries()){
  if(!item||typeof item!=="object")continue;
  const c=item as Record<string,unknown>;const cell=cells.find(x=>x.id===c.sourceCell);
  if(!cell){issues.push({index,reason:"invalid cell reference",candidate:c});continue;}
  const ids=Array.isArray(c.evidenceIds)?[...new Set(c.evidenceIds.filter((i):i is number=>Number.isInteger(i)&&cell.lineIds.includes(Number(i))))]:[];
  const raw={...c,day:cell.day,sourceDayLabel:"周"+"一二三四五六日"[cell.day-1]};
  const p=parseExtraction({status:"ok",kind:"uncertain",termWeeks:term,confidence:"low",warnings:[],courses:[raw],coverage:Array.from({length:7},(_,i)=>({day:i+1,visibility:"uncertain",count:i+1===cell.day?1:0}))}).result;
  if(!p.success||p.data.status!=="ok"){issues.push({index,reason:"invalid record"});continue;}
  const course=p.data.courses[0],key=recordKey(course,term),text=ids.map(i=>ocr.lines[i].text).join("");
  const ok=ids.length>0&&supported(course,text,term);
  // Multiple records may share a line (OCR merged text). Flag overlapping evidence, do not silently discard.
  if(!ok)issues.push({index,reason:"incomplete OCR support",cellId:cell.id,record:course});
  if(ids.some(id=>refs.some(r=>r.lineIds.includes(id)&&r.cellId===cell.id)))issues.push({index,reason:"shared evidence",cellId:cell.id});
  refs.push({cellId:cell.id,lineIds:ids,supported:ok,key});rows.push(course);
 }
 const p=fromModel({...value as object,termWeeks:term,courses:rows,coverage:Array.from({length:7},(_,i)=>({day:i+1,visibility:ocr.grid.regions.some(r=>r.day===i+1)?"uncertain":"not_shown",count:rows.filter(r=>r.day===i+1).length}))});
 const anchors=(p?.schedule.courses??[]).flatMap(c=>{const ref=refs.find(r=>r.key===recordKey(c,term));return ref?[{recordId:c.id,cellId:ref.cellId,lineIds:ref.lineIds,supported:ref.supported}]:[]});
 const used=new Set(anchors.flatMap(a=>a.lineIds));
 return {schedule:p?.schedule??null,confidence:p?.extraction.confidence??"low" as const,anchors,diagnostics:{issues,unclaimedCells:cells.filter(c=>!anchors.some(a=>a.cellId===c.id)).map(c=>c.id),unclaimedLineIds:ocr.lines.map((_,i)=>i).filter(i=>!used.has(i))}};
}
function overlaps(c:{bounds:number[]},box:number[][]){const x=Math.min(...box.map(p=>p[0])),y=Math.min(...box.map(p=>p[1])),r=Math.max(...box.map(p=>p[0])),b=Math.max(...box.map(p=>p[1]));return Math.max(0,Math.min(c.bounds[2],r)-Math.max(c.bounds[0],x))*Math.max(0,Math.min(c.bounds[3],b)-Math.max(c.bounds[1],y))>0;}
export function risks(ocr:OCR,anchors:Anchor[]){
 const used=new Set(ocr.grid.cells.flatMap(c=>c.lineIds));
 return cellsOf(ocr).map(c=>{
  const records=anchors.filter(a=>a.cellId===c.id);
  const crossing=ocr.lines.some((l,i)=>!used.has(i)&&overlaps(c,l.box));
  const low=c.lineIds.some(i=>ocr.lines[i]?.score<0.8);
  const looksSchedule=/节|周|week|\d{1,2}:\d{2}/i.test(c.text);
  const score=(crossing?5:0)+(records.some(a=>!a.supported)?4:0)+(looksSchedule&&!records.length?3:0)+(low?1:0);
  return {...c,score,reasons:{crossing,low,unsupported:records.some(a=>!a.supported),unclaimed:looksSchedule&&!records.length}};
 }).filter(c=>c.score>0).sort((a,b)=>b.score-a.score||a.id.localeCompare(b.id));
}
