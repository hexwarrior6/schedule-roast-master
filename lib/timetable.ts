import type { CanonicalSchedule, Course, Extraction } from "./schema";

const punctuation=(s:string)=>s.normalize("NFKC").replace(/[–—−~～至]/g,"-").replace(/[，、；;]/g,",").replace(/\s+/g,"");
const maxWeek=60;
export function parsePeriods(label:string|null):[number,number]|null {
  if(!label)return null;
  // Only explicit numeric periods, not "第一节"/row labels or arbitrary numbers.
  const m=punctuation(label).match(/^(?:上午|下午|晚上|晚间)?第?(\d{1,2})(?:-(\d{1,2}))?节$/);
  if(!m)return null;
  const first=Number(m[1]),last=Number(m[2]??m[1]);
  return first>=1&&last>=first&&last<=30?[first,last]:null;
}
export function parseWeekNumbers(label:string|null,termWeeks:number|null=null):number[]|null {
  if(!label)return null;
  const limit=termWeeks??maxWeek;
  let s=punctuation(label).replace(/^[\[\]{}]+|[\[\]{}]+$/g,"").replace(/^周次[:：]/,"");
  if(/^(?:全周|每周|全学期)$/.test(s))return termWeeks?Array.from({length:termWeeks},(_,i)=>i+1):null;
  // A pure parity rule is only meaningful with a known semester length.
  const only=s.match(/^(单|双)(?:数)?周$/);
  if(only)return termWeeks?Array.from({length:termWeeks},(_,i)=>i+1).filter(n=>n%2===(only[1]==="单"?1:0)):null;
  const out=new Set<number>();
  // Accept explicit ranges, lists, single weeks and per-range parity.
  // Do not extract isolated digits from incomplete or unrecognized text.
  for(const token of s.split(",")){
    const m=token.match(/^第?(\d{1,2})(?:-第?(\d{1,2}))?周?(?:\((单|双)(?:数)?周?\)|(单|双)(?:数)?周?)?$/);
    if(!m)return null;
    const from=Number(m[1]),to=Number(m[2]??m[1]),parity=m[3]??m[4];
    if(from<1||to<from||to>limit)return null;
    for(let w=from;w<=to;w++)if(!parity||w%2===(parity==="单"?1:0))out.add(w);
  }
  return out.size?[...out].sort((a,b)=>a-b):null;
}
function text(value:unknown):string|null {
  if(typeof value==="number"&&Number.isFinite(value))return String(value);
  if(Array.isArray(value)&&value.every(v=>typeof v==="number"||typeof v==="string"))return value.join("、");
  return typeof value==="string"&&value.trim()?value.trim():null;
}
export function cleanCourseFields(row:Record<string,unknown>,termWeeks:number|null){
  const providedName=text(row.name)??"课程名称不清晰";
  // Evidence is the literal scheduling excerpt, not a reconstructed string.
  const evidence=text(row.rawText);
  const original=evidence??providedName;
  let name=providedName,timeLabel=text(row.timeLabel),weeks=text(row.weeks);
  let embedded=false,incomplete=false;
  // Chinese university course cells frequently use name/(1-2节)1-3周,5-15周/campus/room/teacher/hours/credits.
  // Parse only explicit delimiters, never infer a clock from periods.
  const full=original.match(/^([^/／]+)[/／]\s*[（(]\s*((?:第)?\d{1,2}(?:\s*[-–—~～至]\s*\d{1,2})?节)\s*[）)]\s*([^/／]*)/);
  if(full){
    embedded=true;
    name=full[1].trim();
    const p=parsePeriods(full[2]);
    if(p)timeLabel="第"+p[0]+(p[1]===p[0]?"":"-"+p[1])+"节";
    const explicit=full[3].trim();
    if(parseWeekNumbers(explicit,termWeeks))weeks=explicit;
    else if(explicit){weeks=null;incomplete=true;}
  }else if(/[/／]\s*[（(]\s*\d/.test(original)){
    // A clipped cell still has a usable title, but the truncated schedule is unknown.
    name=original.split(/[/／]/)[0].trim();timeLabel=null;weeks=null;incomplete=true;
  }else if(/[/／]/.test(original)){
    // Strip obvious slash-delimited metadata only when the source has a scheduling marker.
    if(/[/／].*(?:\d+周|\d+节|教室)/.test(original)){name=original.split(/[/／]/)[0].trim();incomplete=true;}
  }
  // A period string in the week field is not a week range. Never convert 节 to 周.
  // When it is the only explicit numeric period evidence, use it instead of a row ordinal.
  const misplacedPeriod=parsePeriods(weeks);
  if(misplacedPeriod){
    if(!embedded){
      const existing=parsePeriods(timeLabel);
      // Without source evidence, conflicting numeric periods are ambiguous.
      timeLabel=existing&&(existing[0]!==misplacedPeriod[0]||existing[1]!==misplacedPeriod[1])?null:
        "第"+misplacedPeriod[0]+(misplacedPeriod[0]===misplacedPeriod[1]?"":"-"+misplacedPeriod[1])+"节";
    }
    weeks=null;incomplete=true;
  }
  if(weeks&&!parseWeekNumbers(weeks,termWeeks)){
    // Remove separately delimited period labels from a polluted week field.
    const parts=punctuation(weeks).split(",");
    const filtered=parts.filter(part=>!parsePeriods(part));
    if(filtered.length!==parts.length&&parseWeekNumbers(filtered.join(","),termWeeks))weeks=filtered.join("、");
    else if(!/^(?:单|双)(?:数)?周$|^(?:每周|全周|全学期)$/.test(weeks)){weeks=null;incomplete=true;}
  }
  const periods=parsePeriods(timeLabel);
  if(periods)timeLabel="第"+periods[0]+(periods[1]===periods[0]?"":"-"+periods[1])+"节";
  // Group labels written in Chinese numerals are ambiguous. Preserve the label but do not turn it into a numeric period.
  // Retain only the necessary schedule excerpt (exclude trailing campus/teacher metadata).
  const rawText=full?original.slice(0,full[0].length).trim().slice(0,300):
    evidence?evidence.split(/[/／]/).slice(0,2).join("/").slice(0,300):
    /[/／]\s*[（(]\s*\d/.test(original)?original.split(/[/／]/).slice(0,2).join("/").slice(0,300):null;
  return {name:name||"课程名称不清晰",timeLabel,weeks,rawText,embedded,incomplete};
}
export function buildTimetable(extraction:Extraction):CanonicalSchedule {
  const termWeeks=extraction.termWeeks??null;
  return {
    version:1,kind:extraction.kind,termWeeks,coverage:extraction.coverage,
    courses:extraction.courses.map((c,i)=>{
      const p=parsePeriods(c.timeLabel);
      return {...c,id:"c"+(i+1),periodStart:p?.[0]??null,periodEnd:p?.[1]??null,weekNumbers:parseWeekNumbers(c.weeks,termWeeks)};
    }),
    unscheduled:extraction.unscheduled??[],
  };
}
type RecordItem=CanonicalSchedule["courses"][number];
function numericRange(c:RecordItem):[number,number]|null{
  return c.periodStart!==null&&c.periodEnd!==null?[c.periodStart,c.periodEnd]:null;
}
function clockMinute(s:string){const [h,m]=s.split(":").map(Number);return h*60+m;}
function dayMetrics(records:RecordItem[]){
  const slots=new Set<number>();
  for(const c of records){const r=numericRange(c);if(r)for(let n=r[0];n<=r[1];n++)slots.add(n);}
  const ordered=[...slots].sort((a,b)=>a-b);
  let longest=0,run=0,prev=-2;
  for(const n of ordered){run=n===prev+1?run+1:1;longest=Math.max(longest,run);prev=n;}
  const missingPeriods=records.filter(c=>!numericRange(c)).length;
  const gaps:number[]=[];
  for(let i=1;i<ordered.length;i++)if(ordered[i]-ordered[i-1]>1)gaps.push(ordered[i]-ordered[i-1]-1);
  const possibleConflicts:string[][]=[];
  for(let i=0;i<records.length;i++)for(let j=i+1;j<records.length;j++){
    const a=records[i],b=records[j],ar=numericRange(a),br=numericRange(b);
    const periodOverlap=ar&&br&&ar[0]<=br[1]&&br[0]<=ar[1];
    const clockOverlap=a.start&&a.end&&b.start&&b.end&&clockMinute(a.start)<clockMinute(b.end)&&clockMinute(b.start)<clockMinute(a.end);
    if(periodOverlap||clockOverlap)possibleConflicts.push([a.id,b.id]);
  }
  return {occurrences:records.length,knownOccupiedPeriods:ordered.length,unknownPeriodRecords:missingPeriods,
    longestKnownConsecutivePeriods:longest,internalUnoccupiedPeriods:missingPeriods?null:gaps.reduce((a,b)=>a+b,0),
    possibleConflicts:possibleConflicts.slice(0,50),conflictPairCount:possibleConflicts.length,
    knownStartsBefore9:records.filter(c=>c.start&&clockMinute(c.start)<540).length,
    unknownClockRecords:records.filter(c=>!c.start).length};
}
export function summarizeTimetable(schedule:CanonicalSchedule){
  const {courses,coverage,termWeeks,kind}=schedule;
  const known=courses.filter(c=>c.weekNumbers!==null);
  const unknown=courses.filter(c=>c.weekNumbers===null);
  const observedWeeks=[...new Set(known.flatMap(c=>c.weekNumbers??[]))].sort((a,b)=>a-b);
  const weeks=termWeeks?Array.from({length:termWeeks},(_,i)=>i+1):observedWeeks;
  const coverageComplete=coverage.every(d=>d.visibility==="shown");
  const complete=kind==="personal"&&coverageComplete&&unknown.length===0&&schedule.unscheduled.length===0&&termWeeks!==null;
  const visibleDays=coverage.map(d=>({day:d.day,visibility:d.visibility,records:d.count}));
  const practice=schedule.unscheduled.map(c=>({...c,weekNumbers:parseWeekNumbers(c.weeks,termWeeks)}));
  const weekly=weeks.map(week=>{
    const unscheduledCount=practice.filter(c=>c.weekNumbers?.includes(week)).length;
    const unknownUnscheduledCount=practice.filter(c=>c.weekNumbers===null).length;
    const active=known.filter(c=>c.weekNumbers?.includes(week));
    const days=visibleDays.map(d=>{
      const records=active.filter(c=>c.day===d.day);
      const unknownWeekRecords=unknown.filter(c=>c.day===d.day).length;
      const m=dayMetrics(records);
      return {day:d.day,visibility:d.visibility,unknownWeekRecords,...m,
        confirmedNoClass:kind==="personal"&&d.visibility==="shown"&&unknownWeekRecords===0&&unscheduledCount===0&&unknownUnscheduledCount===0&&records.length===0};
    });
    return {week,unscheduledCount,unknownUnscheduledCount,unknownWeekRecords:unknown.length,knownOccurrences:active.length,knownActiveDays:days.filter(d=>d.occurrences>0).length,
      knownOccupiedPeriods:days.reduce((n,d)=>n+d.knownOccupiedPeriods,0),
      unknownPeriodRecords:days.reduce((n,d)=>n+d.unknownPeriodRecords,0),
      days};
  });
  const peak=weekly.reduce<typeof weekly[number]|null>((a,b)=>!a||b.knownOccurrences>a.knownOccurrences?b:a,null);
  const light=weekly.reduce<typeof weekly[number]|null>((a,b)=>!a||b.knownOccurrences<a.knownOccurrences?b:a,null);
  return {termWeeks,complete,scope:complete?"完整可见且周次可解析":"仅明确周次的可见记录，可能不完整或为候选课程",
    distinctCourseNames:new Set(courses.map(c=>c.name)).size,visibleRecords:courses.length,
    knownWeekRecords:known.length,unknownWeekRecords:unknown.length,unscheduledRecords:schedule.unscheduled.length,
    confirmedEmptyVisibleDays:kind==="personal"?visibleDays.filter(d=>d.visibility==="shown"&&d.records===0).map(d=>d.day):[],
    visibleDays,peakKnownWeek:peak?{week:peak.week,occurrences:peak.knownOccurrences}:null,
    lightKnownWeek:light?{week:light.week,occurrences:light.knownOccurrences}:null,
    weekly};
}
