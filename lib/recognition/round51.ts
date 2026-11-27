import type {OCR,Topology,Cell} from "./round5-types";
import type {Layout} from "./round4-types";
import type {Crop,Local} from "./round51-types";
import {parsePeriods} from "../timetable";
import {compact} from "./evidence";

const overlap=(a:number[],b:number[])=>Math.max(0,Math.min(a[2],b[2])-Math.max(a[0],b[0]))*Math.max(0,Math.min(a[3],b[3])-Math.max(a[1],b[1]));
const area=(a:number[])=>Math.max(0,a[2]-a[0])*Math.max(0,a[3]-a[1]);
const box=(l:OCR["lines"][number])=>[Math.min(...l.box.map(p=>p[0])),Math.min(...l.box.map(p=>p[1])),Math.max(...l.box.map(p=>p[0])),Math.max(...l.box.map(p=>p[1]))];
const center=(l:OCR["lines"][number])=>[l.box.reduce((n,p)=>n+p[0],0)/4,l.box.reduce((n,p)=>n+p[1],0)/4];
const label=(s:string)=>{const v=s.normalize("NFKC").replace(/\s/g,"").toLowerCase().replace(/\.$/,"");const m=v.match(/^(?:星期|周|礼拜)?([一二三四五六日天1-7])$/);if(m)return /^\d$/.test(m[1])?null:Math.min(7,"一二三四五六日天".indexOf(m[1])+1);return ["mon","tue","wed","thu","fri","sat","sun"].findIndex((x,i)=>v===x||v===["monday","tuesday","wednesday","thursday","friday","saturday","sunday"][i])+1||null;};
function validBounds(b:number[],o:OCR){return b[0]>=0&&b[1]>=0&&b[2]<=o.width&&b[3]<=o.height&&b[2]-b[0]>=8&&b[3]-b[1]>=8;}
function explicitSpans(s:string){
 return Array.from(s.normalize("NFKC").matchAll(/(?:第)?\d{1,2}\s*[-–—~至]\s*\d{1,2}\s*节|第\d{1,2}\s*节/g),m=>parsePeriods(m[0])).filter((x):x is [number,number]=>!!x);
}
export function assess(ocr:OCR|null,layout:Layout|null,topology:Topology|null){
 const src=topology?.geometry;
 if(!ocr||!layout||src?.status!=="ok")return {route:"context" as const,reasons:["missing reliable structure"],cells:[],rejected:[],axes:{day:false,period:false},coverage:0};
 const orient=layout.axis?.orientation??"columns";
 const regions=layout.regions.filter(r=>r.reliable&&validBounds(r.bounds,ocr));
 const observed=regions.filter(r=>ocr.lines.some(l=>{
  if(l.score<.65||label(l.text)!==r.day)return false;
  const [x,y]=center(l),b=r.bounds;
  return orient==="columns"?x>b[0]&&x<b[2]&&y<b[1]&&b[1]-y<Math.max(ocr.height*.10,30):y>b[1]&&y<b[3]&&x<b[0]&&b[0]-x<Math.max(ocr.width*.10,30);
 }));
 const sorted=[...observed].sort((a,b)=>a.bounds[orient==="columns"?0:1]-b.bounds[orient==="columns"?0:1]);
 // An explicitly observed contiguous 5- or 7-day axis is usable. Partial axes
 // are not proof of absence and never relabel an unobserved weekday.
 const day=sorted.length>=5&&sorted[0].day===1&&sorted.every((r,i)=>r.day===i+1);
 const ticks=src.ticks;
 const period=ticks.length>=4&&ticks.every((t,i)=>t.lineId<ocr.lines.length&&(!i||t.period===ticks[i-1].period+1&&t.position>ticks[i-1].position));
 const accepted:({id:string;bounds:Cell["bounds"];day:number;periods:number[];text:string;lineIds:number[];source:string;spanConflict:boolean})[]=[],rejected:{id:string;reasons:string[]}[]=[];
 for(const c of src.cells){
  if(!c.lineIds.length)continue;
  const reasons:string[]=[];
  const r=observed.find(r=>r.day===c.day&&overlap(c.bounds,r.bounds)/Math.max(1,area(c.bounds))>=.90);
  if(!day||!r||!c.day)reasons.push("unverified weekday axis");
  if(!validBounds(c.bounds,ocr))reasons.push("invalid bounds");
  const ls=c.lineIds.map(i=>ocr.lines[i]);
  if(ls.some(l=>!l||overlap(box(l),c.bounds)/Math.max(1,area(box(l)))<.65))reasons.push("ambiguous text ownership");
  if(!ls.some(l=>l&&l.score>=.7&&/[\p{L}\p{Script=Han}]{2,}/u.test(l.text)))reasons.push("no readable text");
  if(c.source==="local_edges"&&(c.quality??0)<.8||c.source==="color"&&(c.quality??0)<.65||!["local_edges","color"].includes(c.source))reasons.push("weak physical boundary");
  if(reasons.length){rejected.push({id:c.id,reasons});continue;}
  const span=period&&c.periods.length>0&&c.periods.every((n,i)=>!i||n===c.periods[i-1]+1)?c.periods:[];
  const conflict=span.length>0&&explicitSpans(c.text).some(p=>p[0]!==span[0]||p[1]!==span.at(-1));
  accepted.push({id:c.id,bounds:c.bounds,day:c.day!,periods:conflict?[]:span,text:c.text,lineIds:c.lineIds,source:c.source,spanConflict:conflict});
 }
 const candidates=src.cells.filter(c=>c.lineIds.length).length;
 const coverage=candidates?accepted.length/candidates:0;
 const route=day&&accepted.length>0&&coverage>=.65?"structured" as const:"context" as const;
 return {route,reasons:[...(!day?["incomplete observed weekday axis"]:[]),...(!period?["period axis incomplete"]:[]),...(coverage<.65?["low usable cell coverage"]:[])],cells:route==="structured"?accepted:[],rejected,axes:{day,period},coverage};
}
export function planCrops(ocr:OCR|null,layout:Layout|null,topology:Topology|null):Crop[]{
 if(!ocr||!layout)return [];
 const out:Crop[]=[];
 const add=(b:number[],reason:string)=>{
  const bounds=[Math.max(0,Math.floor(b[0])),Math.max(0,Math.floor(b[1])),Math.min(ocr.width,Math.ceil(b[2])),Math.min(ocr.height,Math.ceil(b[3]))] as Crop["bounds"];
  if(out.length>=4||!validBounds(bounds,ocr)||area(bounds)>ocr.width*ocr.height*.18||out.some(c=>overlap(bounds,c.bounds)/Math.min(area(bounds),area(c.bounds))>.65))return;
  out.push({id:"C"+out.length,bounds,reason});
 };
 const axis=layout.axis;
 if(axis&&axis.headers.length>=3&&axis.step>0){
  const h=[...axis.headers].sort((a,b)=>a.day-b.day);
  // Only propose a neighboring header crop, never infer the missing label.
  const missing=[...Array.from({length:h.at(-1)!.day-h[0].day+1},(_,i)=>h[0].day+i).filter(d=>!h.some(x=>x.day===d)),...(h[0].day===2?[1]:[])];
  for(const d of missing){
   const pos=h[0].center+(d-h[0].day)*axis.step,cross=axis.cross,half=Math.max(12,axis.step*.44),depth=Math.max(12,Math.min(45,axis.step*.35));
   add(axis.orientation==="columns"?[pos-half,cross-depth,pos+half,cross+depth]:[cross-depth,pos-half,cross+depth,pos+half],"verify missing weekday header, not assumed day "+d);
  }
 }
 const cells=topology?.geometry.cells??[];
 const weak=cells.filter(c=>c.lineIds.length&&c.lineIds.some(i=>ocr.lines[i]?.score<.8||box(ocr.lines[i])[3]-box(ocr.lines[i])[1]<13)).sort((a,b)=>Math.min(...a.lineIds.map(i=>ocr.lines[i]?.score??1))-Math.min(...b.lineIds.map(i=>ocr.lines[i]?.score??1)));
 for(const c of weak)add(c.bounds,"small or low-confidence cell text");
 // For unresolved layouts, re-read a bounded low-confidence individual line.
 for(const l of [...ocr.lines].sort((a,b)=>a.score-b.score).filter(l=>l.score<.7&&l.text.trim().length>=2)){
  const b=box(l);add([b[0]-8,b[1]-6,b[2]+8,b[3]+6],"low-confidence OCR line");
 }
 return out;
}
export function localEvidence(plan:Crop[],local:Local|null){
 return plan.flatMap(c=>{const value=local?.cells.find(x=>x.id===c.id);return value&&value.text.trim()?[{...c,text:value.text}]:[];});
}
