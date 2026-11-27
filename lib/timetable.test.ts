import {describe,it,expect} from "vitest";
import {buildTimetable,cleanCourseFields,parsePeriods,parseWeekNumbers,summarizeTimetable} from "./timetable";
import {parseExtraction} from "./normalize-extraction";
import {canonicalScheduleSchema,type Course,type Extraction} from "./schema";
const course=(name:string,day:number,timeLabel:string|null,weeks:string|null):Course=>({name,day,start:null,end:null,timeLabel,weeks});
const fixture=(courses:Course[],termWeeks:number|null=19):Extraction=>({status:"ok",kind:"personal",termWeeks,confidence:"medium",warnings:[],courses,coverage:Array.from({length:7},(_,i)=>({day:i+1,visibility:"shown",count:courses.filter(c=>c.day===i+1).length}))});
describe("统一课表和周次引擎",()=>{
  it("解析完整字段而不是将时段编号当节次",()=>{
    expect(cleanCourseFields({name:"高等数学A1/(1-2节)1-3周，5-15周/校区/教室/教师/80/5.0",timeLabel:"第一节",weeks:["1-2节","3周","5-15周"]},19)).toMatchObject({name:"高等数学A1",timeLabel:"第1-2节",weeks:"1-3周，5-15周"});
  });
  it("截断的正文不能补全节次与周次",()=>expect(cleanCourseFields({name:"高等数学A1/(6-",timeLabel:"第三节",weeks:"6-"},19)).toMatchObject({name:"高等数学A1",timeLabel:null,weeks:null,incomplete:true}));
  it("解析周次列表、单双周与明确学期长度",()=>{
    expect(parseWeekNumbers("1-3周、5-7周")).toEqual([1,2,3,5,6,7]);
    expect(parseWeekNumbers("第9周")).toEqual([9]);
    expect(parseWeekNumbers("1-8周(双)")).toEqual([2,4,6,8]);
    expect(parseWeekNumbers("单周",6)).toEqual([1,3,5]);
    expect(parseWeekNumbers("单周")).toBeNull();
    expect(parseWeekNumbers("6-")).toBeNull();
    expect(parseWeekNumbers("1-25周",19)).toBeNull();
    expect(parsePeriods("第一节")).toBeNull();
  });
  it("按周次拆开不同安排、只在第9周计算周日课程",()=>{
    const s=buildTimetable(fixture([course("程序设计",4,"第3-5节","1-11周"),course("程序设计",4,"第3-4节","第12周"),course("职业指导",7,"第10-11节","第9周")]));
    expect(canonicalScheduleSchema.safeParse(s).success).toBe(true);
    const f=summarizeTimetable(s);
    expect(f.weekly[8].knownOccurrences).toBe(2);
    expect(f.weekly[8].days[6].occurrences).toBe(1);
    expect(f.weekly[9].days[6].occurrences).toBe(0);
    expect(f.weekly[11].days[3].knownOccupiedPeriods).toBe(2);
    expect(f.weekly[11].days[3].conflictPairCount).toBe(0);
  });
  it("重叠节次取并集并提示同周冲突，区分空节",()=>{
    const s=buildTimetable(fixture([course("A",4,"第1-3节","第1周"),course("B",4,"第3-4节","第1周"),course("C",4,"第6-7节","第1周")],1));
    const d=summarizeTimetable(s).weekly[0].days[3];
    expect(d.knownOccupiedPeriods).toBe(6);
    expect(d.longestKnownConsecutivePeriods).toBe(4);
    expect(d.internalUnoccupiedPeriods).toBe(1);
    expect(d.conflictPairCount).toBe(1);
  });
  it("未知周次、不可见日期不当作无课",()=>{
    const x=fixture([course("A",1,"第1-2节",null),course("B",2,"第2节","第1周")],2);
    x.coverage[6].visibility="not_shown";
    const f=summarizeTimetable(buildTimetable(x));
    expect(f.complete).toBe(false);
    expect(f.weekly[0].days[0].confirmedNoClass).toBe(false);
    expect(f.weekly[0].days[6].confirmedNoClass).toBe(false);
  });
  it("即使模型返回结构合法仍清洗字段",()=>{
    const x=fixture([course("高等数学/(1-2节)1-3周/校区/教师",1,"第一节","3周")]);
    const {result}=parseExtraction(x);
    if(!result.success||result.data.status!=="ok")throw Error("expected success");
    expect(result.data.courses[0]).toMatchObject({name:"高等数学",timeLabel:"第1-2节",weeks:"1-3周"});
  });
});
