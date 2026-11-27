import type {CanonicalSchedule,Extraction} from "./schema";
import {buildTimetable,parsePeriods,parseWeekNumbers} from "./timetable";
export const MIN_FIELD_COVERAGE=0.8;
export function qualityOf(schedule:CanonicalSchedule){
  const rows=schedule.courses;
  const n=rows.length;
  const timed=(c:typeof rows[number])=>c.periodStart!==null&&c.periodEnd!==null||c.start!==null&&c.end!==null;
  const weekKnown=rows.filter(c=>c.weekNumbers!==null).length;
  const timeKnown=rows.filter(timed).length;
  const bothKnown=rows.filter(c=>c.weekNumbers!==null&&timed(c)).length;
  const rawKnown=rows.filter(c=>!!c.rawText).length;
  const uncertainDays=schedule.coverage.filter(d=>d.visibility==="uncertain").map(d=>d.day);
  const sufficient=n>0&&bothKnown/n>=MIN_FIELD_COVERAGE;
  const reviewDays=schedule.coverage.filter(d=>d.visibility==="uncertain"||
    rows.some(c=>c.day===d.day&&(!c.rawText||c.weekNumbers===null||!timed(c)))).map(d=>d.day);
  return {total:n,weekKnown,timeKnown,bothKnown,rawKnown,sufficient,uncertainDays,reviewDays};
}
export function needsRecheck(extraction:Extraction){
  const q=qualityOf(buildTimetable(extraction));
  // Avoid a second call just because an older timetable does not print exact clock times.
  return !q.sufficient||q.uncertainDays.length>0||q.rawKnown<q.total;
}
function usable(c:Extraction["courses"][number],term:number|null){
  return !!parseWeekNumbers(c.weeks,term)&&(!!parsePeriods(c.timeLabel)||!!(c.start&&c.end));
}
function signature(c:Extraction["courses"][number],term:number|null){
  return JSON.stringify([c.name,c.day,c.start,c.end,parsePeriods(c.timeLabel),parseWeekNumbers(c.weeks,term)]);
}
/** Adopt only clearly improved target-day candidates. Retain complete prior records. */
export function mergeRecheck(initial:Extraction,candidate:Extraction,days:number[]):Extraction{
  const term=initial.termWeeks??candidate.termWeeks??null;
  if(initial.termWeeks&&candidate.termWeeks&&initial.termWeeks!==candidate.termWeeks)return initial;
  let courses=[...initial.courses],coverage=[...initial.coverage],accepted=0;
  for(const day of days){
    const previous=courses.filter(c=>c.day===day),next=candidate.courses.filter(c=>c.day===day);
    const oldCoverage=coverage.find(c=>c.day===day),newCoverage=candidate.coverage.find(c=>c.day===day);
    if(!oldCoverage||!newCoverage||newCoverage.visibility!=="shown"||next.length<previous.length)continue;
    const oldNames=new Map<string,number>(),newNames=new Map<string,number>();
    for(const c of previous)oldNames.set(c.name,(oldNames.get(c.name)??0)+1);
    for(const c of next)newNames.set(c.name,(newNames.get(c.name)??0)+1);
    if([...oldNames].some(([name,count])=>(newNames.get(name)??0)<count))continue;
    const completeOld=previous.filter(c=>usable(c,term)&&!!c.rawText);
    const signatures=new Set(next.filter(c=>usable(c,term)&&!!c.rawText).map(c=>signature(c,term)));
    if(completeOld.some(c=>!signatures.has(signature(c,term))))continue;
    const oldGood=previous.filter(c=>usable(c,term)).length;
    const newGood=next.filter(c=>usable(c,term)).length;
    const oldEvidence=previous.filter(c=>!!c.rawText).length;
    const newEvidence=next.filter(c=>!!c.rawText).length;
    if(newGood<oldGood||newEvidence<oldEvidence||newGood-oldGood<next.length-previous.length||courses.length-previous.length+next.length>150)continue;
    if(newGood===oldGood&&newEvidence===oldEvidence&&oldCoverage.visibility==="shown")continue;
    courses=[...courses.filter(c=>c.day!==day),...next];coverage=coverage.map(c=>c.day===day?newCoverage:c);accepted++;
  }
  if(!accepted)return initial;
  return {...initial,termWeeks:term,courses:courses.sort((a,b)=>a.day-b.day),coverage,confidence:initial.confidence==="high"?"medium":initial.confidence,
    warnings:["已对 "+accepted+" 个星期的排课记录进行二次图片核对；仍请核对原图。",...initial.warnings].slice(0,8)};
}
