import type {CanonicalSchedule} from "../schema";
import {canonicalScheduleSchema} from "../schema";
import {normalizeLossless} from "./round41";
import {parsePeriods} from "../timetable";
import {compact} from "./evidence";
import type {Cell,Topology} from "./round5-types";
type Row=CanonicalSchedule["courses"][number];
const key=(s:string)=>compact(s);
const area=(b:number[])=>Math.max(0,b[2]-b[0])*Math.max(0,b[3]-b[1]);
function iou(a:number[],b:number[]){const v=area([Math.max(a[0],b[0]),Math.max(a[1],b[1]),Math.min(a[2],b[2]),Math.min(a[3],b[3])]);return v/Math.max(1,area(a)+area(b)-v);}
function span(c:Cell){const p=c.periods;return p.length&&p.every((n,i)=>!i||n===p[i-1]+1)?[p[0],p[p.length-1]]:null;}
export function jointEvidence(t:Topology){
 const pairs=t.geometry.cells.flatMap(g=>{
  const candidates=t.learned.cells.map(l=>({l,overlap:iou(g.bounds,l.bounds)})).filter(x=>x.overlap>=.65).sort((a,b)=>b.overlap-a.overlap);
  if(!candidates.length||candidates[1]&&candidates[0].overlap-candidates[1].overlap<.15)return [];
  const {l,overlap}=candidates[0];
  if(t.geometry.cells.filter(x=>iou(x.bounds,l.bounds)>=.65).length!==1)return [];
  return [{geometry:g.id,learned:l.id,iou:overlap,day:g.day!==null&&g.day===l.day?g.day:null,periods:span(g)&&JSON.stringify(span(g))===JSON.stringify(span(l))?span(g):null}];
 });
 return pairs;
}
export function normalize5(raw:unknown){
 const prefixRepairs:unknown[]=[];
 if(raw&&typeof raw==="object"&&!Array.isArray(raw)){
  const o=raw as Record<string,unknown>;
  if(Array.isArray(o.unscheduled))raw={...o,unscheduled:o.unscheduled.map((x,i)=>{
   if(!x||typeof x!=="object")return x;
   const r=x as Record<string,unknown>;if(typeof r.name!=="string")return x;
   const name=r.name.replace(/^(?:实践\s*[/／]\s*备注|实践课程|实践安排|备注)\s*[:：]\s*/,"").trim();
   if(name&&name!==r.name){prefixRepairs.push({section:"unscheduled",index:i,before:r.name,after:name});return {...r,name};}return x;
  })};
 }
 const n=normalizeLossless(raw);return {...n,repairs:[...prefixRepairs,...n.repairs]};
}
export function validateTopology(s:CanonicalSchedule|null,t:Topology|null){
 const changes:unknown[]=[],conflicts:unknown[]=[];
 if(!s||!t)return {schedule:s,changes,conflicts,pairs:[]};
 const pairs=jointEvidence(t);
 const matches=(r:Row)=>pairs.filter(p=>p.day===r.day&&p.periods&&t.geometry.cells.some(c=>c.id===p.geometry&&key(c.text).includes(key(r.name)))&&t.learned.cells.some(c=>c.id===p.learned&&key(c.text).includes(key(r.name))));
 const rows=s.courses.map(r=>{
  const m=matches(r);if(m.length!==1||!m[0].periods)return r;
  const [a,b]=m[0].periods;
  const old=parsePeriods(r.timeLabel);
  if(r.start||r.end||old&&(old[0]!==a||old[1]!==old[0])||a===b)return r;
  const g=t.geometry.cells.find(c=>c.id===m[0].geometry)!;
  // Do not expand a block containing multiple distinct course candidates or
  // explicit conflicting scheduling text. Geometry can represent several
  // alternating courses within one cell, so require a unique candidate.
  if(s.courses.some(c=>c.id!==r.id&&c.day===r.day&&key(g.text).includes(key(c.name))))return r;
  if(/(?:第?\d{1,2}\s*[-–—~至]\s*\d{1,2}节|第\d{1,2}节)/.test(g.text)){conflicts.push({id:r.id,reason:"explicit period text present",pair:m[0]});return r;}
  const next={...r,timeLabel:"第"+a+"-"+b+"节",periodStart:a,periodEnd:b,rawText:null};
  changes.push({type:"agreed_span",before:r,after:next,pair:m[0]});return next;
 });
 // Only suppress literal generic placeholders, never a real candidate title.
 // Require a named record with consensus support covering the placeholder.
 const kept=rows.filter(r=>{
  if(!/^(?:课程名称不清晰|课程名称不详|课程名称未知|未知课程|不清晰课程|unknown course)$/i.test(r.name.trim()))return true;
  const p=parsePeriods(r.timeLabel);if(!p)return true;
  const other=rows.find(c=>c.id!==r.id&&c.day===r.day&&matches(c).some(m=>m.periods&&m.periods[0]<=p[0]&&m.periods[1]>=p[1])&&c.periodStart!==null&&c.periodEnd!==null&&c.periodStart<=p[0]&&c.periodEnd>=p[1]);
  if(!other)return true;
  changes.push({type:"covered_generic_placeholder",record:r,coveringRecord:other.id});return false;
 });
 const coverage=s.coverage.map(c=>({...c,count:kept.filter(r=>r.day===c.day).length,visibility:kept.filter(r=>r.day===c.day).length!==c.count?"uncertain" as const:c.visibility}));
 const candidate=canonicalScheduleSchema.safeParse({...s,courses:kept,coverage});
 return {schedule:candidate.success?candidate.data:s,changes,conflicts,pairs};
}
