import { extractionResultSchema, type Course } from "./schema";
import {cleanCourseFields} from "./timetable";

const object=(value:unknown):Record<string,unknown>|null=>value!==null&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:null;
const unknownText=/^(?:未知|不详|不明确|无法辨认|无|unknown|null|n\/a|—|-)$/i;
function optionalText(value:unknown,max:number):string|null {
  if(typeof value==="number"&&Number.isFinite(value))value=String(value);
  if(Array.isArray(value)&&value.every(v=>typeof v==="number"||typeof v==="string"))value=value.join("、");
  if(typeof value!=="string")return null;
  const s=value.trim();
  return s&&!unknownText.test(s)?s.slice(0,max):null;
}
function dayNumber(value:unknown):number|null {
  if(typeof value==="number"&&Number.isInteger(value)&&value>=1&&value<=7)return value;
  if(typeof value!=="string")return null;
  const s=value.trim();
  if(/^[1-7]$/.test(s))return Number(s);
  const day=s.match(/^(?:周|星期|礼拜)?([一二三四五六日天])$/);
  if(day)return "一二三四五六日天".indexOf(day[1])===7?7:"一二三四五六日天".indexOf(day[1])+1;
  const english=["monday","tuesday","wednesday","thursday","friday","saturday","sunday"];
  const index=english.findIndex(d=>s.toLowerCase()===d||s.toLowerCase()===d.slice(0,3));
  return index<0?null:index+1;
}
function clock(value:unknown):string|null {
  if(typeof value!=="string")return null;
  const m=value.trim().match(/^([01]?\d|2[0-3])[:：]([0-5]\d)$/);
  return m?m[1].padStart(2,"0")+":"+m[2]:null;
}

/** Repair presentation-only differences; never infer a missing weekday or clock time. */
export function normalizeExtraction(input:unknown):unknown {
  const root=object(input);
  if(!root||root.status==="unreadable"||!Array.isArray(root.courses))return input;
  if(root.status!==undefined&&root.status!=="ok")return input;
  // Enforce size limits before processing; do not silently truncate courses.
  if(root.courses.length>150)return input;
  const termText=String(root.termWeeks??"").trim().match(/^(\d{1,2})(?:周)?$/);
  const termWeeks=termText&&Number(termText[1])>=1&&Number(termText[1])<=60?Number(termText[1]):null;
  let incomplete=false,unplaced=0,duplicates=0,cleaned=0;
  const warnings=Array.isArray(root.warnings)?root.warnings.map(w=>optionalText(w,200)).filter((w):w is string=>w!==null):[];
  const courses:Course[]=[];
  const keys=new Set<string>();
  for(const entry of root.courses){
    const row=object(entry);
    const day=dayNumber(row?.day);
    if(!row||day===null){unplaced++;incomplete=true;continue;}
    const fields=cleanCourseFields(row,termWeeks);
    if(fields.embedded)cleaned++;
    if(fields.incomplete)incomplete=true;
    const name=optionalText(fields.name,100);
    let start=clock(row.start),end=clock(row.end);
    if(start&&end&&start>=end){start=null;end=null;incomplete=true;}
    if((optionalText(row.start,80)&&!start)||(optionalText(row.end,80)&&!end))incomplete=true;
    if(!name)incomplete=true;
    const course={name:name??"课程名称不清晰",day,start,end,timeLabel:optionalText(fields.timeLabel,80),weeks:optionalText(fields.weeks,120)};
    const key=JSON.stringify(course);
    // Unreadable names may describe separate blocks. Keep them distinguishable only
    // when the model provided distinct time/period/week data; otherwise flag uncertainty.
    if(keys.has(key)){duplicates++;incomplete=true;continue;}
    keys.add(key);courses.push(course);
  }
  if(!courses.length)return input;
  if(cleaned)warnings.unshift("已从 "+cleaned+" 条完整课程文本中分离课程名、节次与周次。");
  if(unplaced)warnings.unshift("有 "+unplaced+" 条记录缺少可确认的星期，未纳入统计；识别可能不完整。");
  if(duplicates)warnings.unshift("已去除 "+duplicates+" 条完全重复的识别记录，可能存在重叠或重复识别。");
  const rows=Array.isArray(root.coverage)?root.coverage.map(object).filter((r):r is Record<string,unknown>=>r!==null):[];
  let mismatch=false;
  const coverage=Array.from({length:7},(_,i)=>{
    const day=i+1,count=courses.filter(c=>c.day===day).length;
    const matches=rows.filter(r=>dayNumber(r.day)===day);
    const row=matches[0];
    const visibility=row?.visibility;
    const reported=typeof row?.count==="number"?row.count:typeof row?.count==="string"&&/^\d+$/.test(row.count.trim())?Number(row.count):null;
    if(matches.length!==1||reported!==count||(visibility!=="shown"&&visibility!=="not_shown"&&visibility!=="uncertain")||(visibility==="not_shown"&&count>0)){
      mismatch=true;
      return {day,count,visibility:"uncertain" as const};
    }
    return {day,count,visibility};
  });
  if(mismatch){incomplete=true;warnings.unshift("模型逐日覆盖范围或计数不一致，已按可确认课程明细重新统计；不确定日期不视为无课。");}
  if(incomplete)warnings.unshift("部分识别字段不完整，以下结果仅为可确认记录，请核对原图。");
  const kind=root.kind==="personal"||root.kind==="catalog"?root.kind:"uncertain";
  const confidence=incomplete?"low":root.confidence==="high"||root.confidence==="medium"||root.confidence==="low"?root.confidence:"medium";
  const unscheduled=Array.isArray(root.unscheduled)?root.unscheduled.slice(0,50).flatMap(entry=>{const row=object(entry);if(!row)return [];const name=optionalText(cleanCourseFields(row,termWeeks).name,100);return name?[{name,weeks:optionalText(row.weeks,120)}]:[];}):[];
  return {status:"ok",kind,confidence,termWeeks,unscheduled,warnings:warnings.slice(0,8),coverage,courses};
}
export function parseExtraction(input:unknown){
  const direct=extractionResultSchema.safeParse(input);
  if(direct.success&&direct.data.status==="unreadable")return {result:direct,repaired:false};
  const result=extractionResultSchema.safeParse(normalizeExtraction(input));
  return {result,repaired:result.success&&(!direct.success||JSON.stringify(result.data)!==JSON.stringify(direct.data))};
}
