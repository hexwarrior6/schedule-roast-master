import type { CanonicalSchedule, Report } from "./schema";
import { summarizeTimetable } from "./timetable";
type Key=Report["reviews"][number]["key"];
type Metric={score:number|null;fact:string};
const clamp=(n:number)=>Math.max(0,Math.min(100,Math.round(n)));
const dayName=(n:number)=>"周"+"一二三四五六日"[n-1];
const join=(items:number[])=>items.map(n=>"第"+n+"周").join("、");

/** Deterministic entertainment rubric, not a measure of academic difficulty. */
export function scoreTimetable(schedule:CanonicalSchedule){
  const f=summarizeTimetable(schedule);
  const active=f.weekly.filter(w=>w.knownOccurrences>0);
  const courses=schedule.courses;
  const dayRows=active.flatMap(w=>w.days.map(d=>({...d,week:w.week}))).filter(d=>d.occurrences>0);
  const maxPeriods=Math.max(0,...dayRows.map(d=>d.knownOccupiedPeriods));
  const maxRun=Math.max(0,...dayRows.map(d=>d.longestKnownConsecutivePeriods));
  const singleRun=Math.max(0,...courses.map(c=>c.periodStart!==null&&c.periodEnd!==null?c.periodEnd-c.periodStart+1:0));
  const runRows=dayRows.filter(d=>d.longestKnownConsecutivePeriods===maxRun&&maxRun>0);
  const runSample=runRows[0];
  const busiest=dayRows.find(d=>d.knownOccupiedPeriods===maxPeriods&&maxPeriods>0);
  const peak=Math.max(0,...active.map(w=>w.knownOccurrences));
  const low=active.length?Math.min(...active.map(w=>w.knownOccurrences)):0;
  const peakWeeks=active.filter(w=>w.knownOccurrences===peak).map(w=>w.week);
  const weekendWeeks=active.filter(w=>w.days.some(d=>d.day>=6&&d.occurrences>0)).map(w=>w.week);
  const shownEmpty=schedule.coverage.filter(d=>d.visibility==="shown"&&d.count===0).map(d=>dayName(d.day));
  const unknownDays=schedule.coverage.filter(d=>d.visibility!=="shown").map(d=>dayName(d.day));
  const unknownWeeks=f.unknownWeekRecords;
  const weekendShown=schedule.coverage.filter(d=>d.day>=6).every(d=>d.visibility==="shown");
  const partial=!f.complete;
  const scope=partial?"已知记录":"可见课表";
  const allClock=courses.every(c=>c.start!==null);
  const early=courses.filter(c=>c.start!==null&&c.start<"09:00").length;
  const irregular=courses.filter(c=>{const w=c.weekNumbers;return w!==null&&(w.length===1||w.some((n,i)=>i>0&&n!==w[i-1]+1));}).length;
  const visibleDayCounts=f.visibleDays.filter(d=>d.records>0).map(d=>d.records);
  const dayMax=active.length?Math.max(...dayRows.map(d=>d.occurrences)):Math.max(...visibleDayCounts);
  const avg=active.length?dayRows.reduce((n,d)=>n+d.occurrences,0)/dayRows.length:visibleDayCounts.reduce((n,c)=>n+c,0)/visibleDayCounts.length;
  const distribution=clamp(95-12*Math.max(0,dayMax-avg)-3*Math.max(0,dayMax-3));
  const weekendRecords=courses.filter(c=>c.day>=6).length;
  const metrics:Record<Key,Metric>={
    weeks:{score:unknownWeeks?null:clamp(95-65*irregular/courses.length),fact:unknownWeeks?"有 "+unknownWeeks+" 条排课记录周次未知；已解析记录中有 "+irregular+" 条指定周或不连续周次安排。":"已解析周次的 "+courses.length+" 条记录中，有 "+irregular+" 条指定周或不连续周次安排。"},
    early:{score:allClock?clamp(100-75*early/courses.length):null,fact:allClock?"可见排课记录中 "+early+" 条在 9 点前开始。":"缺少部分或全部准确钟表时间，无法确定早八；节次编号不能直接换算时刻。"},
    distribution:{score:distribution,fact:active.length?scope+"中单日最多 "+dayMax+" 条排课记录；不是 "+dayMax+" 节课。":"周次无法展开；仅比较可见排课记录，单日最多 "+dayMax+" 条。"},
    endurance:{score:maxRun?clamp(100-9*maxRun):singleRun?clamp(100-9*singleRun):null,fact:runSample?"已知最长连续节次编号为 "+maxRun+"（第"+runSample.week+"周"+dayName(runSample.day)+"）；不代表没有课间休息。":singleRun?"最长单条可见记录覆盖 "+singleRun+" 节，无法确认同周连续安排。":"没有足够的明确节次，无法计算连续节次。"},
    memory:{score:clamp(100-3*f.distinctCourseNames-2*Math.max(0,courses.length-f.distinctCourseNames)),fact:"共 "+f.distinctCourseNames+" 个不同的可见课程名称、"+courses.length+" 条排课记录；分数仅反映记忆安排的复杂度。"},
    workload:{score:active.length>=2?clamp(100-80*(peak-low)/Math.max(1,peak)):null,fact:active.length>=2?"在已知有课的周次中，排课记录数从 "+low+" 到 "+peak+"；不含未知周次、实践课时与作业量。":"可比较的明确有课周不足，无法判断排课波动。"},
    social:{score:weekendShown&&active.length?clamp(100-65*weekendWeeks.length/active.length):weekendShown?clamp(100-65*weekendRecords/courses.length):null,fact:(weekendWeeks.length?"已知周末有排课的周次："+join(weekendWeeks)+"。":"没有解析出周末的明确周次记录。")+(shownEmpty.length?"图中可见空白日："+shownEmpty.join("、")+"。":"")+(weekendShown?"":"周末显示不完整，不能断言休息。")},
    happiness:{score:null,fact:""},
  };
  const values=Object.entries(metrics).filter(([k,m])=>k!=="happiness"&&m.score!==null).map(([,m])=>m.score!);
  const score=values.length>=3?clamp(values.reduce((a,b)=>a+b,0)/values.length):null;
  metrics.happiness={score,fact:score===null?"可评分维度不足，暂不计算综合分。":"综合分来自 "+values.length+" 个可计算维度的平均值，仅作娱乐参考。"};
  const peakText=peakWeeks.length?"已知排课记录峰值为 "+join(peakWeeks)+"（每周 "+peak+" 条）。":"暂无可展开的明确周次。";
  const peakPeriodText=busiest?"单日已知最多占用 "+maxPeriods+" 节（第"+busiest.week+"周"+dayName(busiest.day)+"）。":"";
  const uncertainty=(unknownWeeks?"另有 "+unknownWeeks+" 条记录周次未明。":"")+(schedule.unscheduled.length?"另有 "+schedule.unscheduled.length+" 条未指定星期的实践安排。":"")+(unknownDays.length?"部分日期覆盖不确定："+unknownDays.join("、")+"。":"");
  const summary="共识别 "+courses.length+" 条排课记录，"+f.distinctCourseNames+" 个不同课程名称。"+peakText+peakPeriodText+uncertainty+(partial?" 以上均为已识别部分，不能据此认定完整学期负担。":"");
  const tags=[maxRun>=6?"连堂挑战":"节次拼图",irregular>0?"周次迷宫":"排课观察",weekendWeeks.length?"周末有课记录":"周末待核对",partial?"信息待核对":"规则趣味评分"];
  const advice=[
    ...(unknownWeeks||unknownDays.length||schedule.unscheduled.length?["核对原图中未确定的周次、星期及实践安排，再据此制定计划。"]:[]),
    ...(!allClock?["确认学校实际的各节次上下课时间，再设置闹钟和出行提醒。"]:[]),
    ...(runSample?["第"+runSample.week+"周"+dayName(runSample.day)+"的已知连续节次较长，提前安排休息与用餐。"]:[]),
    ...(weekendWeeks.length?["把 "+join(weekendWeeks)+" 的周末已知课程单独加入日历。"]:[]),
    "按实际周次设置课程提醒，避免把不同周次的同名课程误当成同时上课。",
  ].slice(0,4);
  return {score,metrics,summary,tags,advice,partial,peakWeeks,maxRun,maxPeriods,weekendWeeks,shownEmpty,unknownDays};
}
