import {describe,it,expect} from "vitest";
import {scoreTimetable} from "./score";
import {buildTimetable,summarizeTimetable} from "./timetable";
import type {Course,Extraction} from "./schema";
const c=(name:string,day:number,timeLabel:string,weeks:string|null):Course=>({name,day,timeLabel,weeks,start:null,end:null});
function fixture(courses:Course[]):Extraction{return {status:"ok",kind:"personal",confidence:"medium",termWeeks:19,warnings:[],courses,coverage:Array.from({length:7},(_,i)=>({day:i+1,visibility:"shown",count:courses.filter(c=>c.day===i+1).length}))};}
describe("规则评分与事实摘要",()=>{
  it("不把周日一次课程说成每周上课，并区分最长连续与占用节次",()=>{
    const s=buildTimetable(fixture([c("A",4,"第1-4节","第6周"),c("B",4,"第6-8节","第6周"),c("C",4,"第10-12节","第6周"),c("D",7,"第10-11节","第9周")]));
    const r=scoreTimetable(s);
    expect(r.weekendWeeks).toEqual([9]);
    expect(r.maxRun).toBe(4);
    expect(r.maxPeriods).toBe(10);
    expect(r.metrics.early.score).toBeNull();
  });
  it("缺失周末覆盖时不计算社交分，不把未识别周当休息",()=>{
    const x=fixture([c("A",1,"第1-2节",null)]);
    x.coverage[6].visibility="not_shown";
    const r=scoreTimetable(buildTimetable(x));
    expect(r.partial).toBe(true);
    expect(r.metrics.social.score).toBeNull();
    expect(r.metrics.weeks.score).toBeNull();
    expect(r.summary).toContain("周次未明");
  });
  it("第16周实践安排不伪造节次，并阻止确认无课",()=>{
    const x=fixture([c("A",1,"第1-2节","1-15周")]);x.unscheduled=[{name:"实践课",weeks:"第16周"}];
    const w=summarizeTimetable(buildTimetable(x)).weekly[15];
    expect(w.unscheduledCount).toBe(1);
    expect(w.knownOccupiedPeriods).toBe(0);
    expect(w.days.every(d=>!d.confirmedNoClass)).toBe(true);
  });
});
