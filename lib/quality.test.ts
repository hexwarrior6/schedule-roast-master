import {describe,it,expect} from "vitest";
import {parseExtraction} from "./normalize-extraction";
import {buildTimetable} from "./timetable";
import {qualityOf,mergeRecheck,needsRecheck} from "./quality";
import {weekdayHeader} from "./placement";
import {scoreTimetable} from "./score";
import type {Course,Extraction} from "./schema";
const c=(name:string,day:number,timeLabel:string|null,weeks:string|null,rawText:string|null=null):Course=>({name,day,timeLabel,weeks,rawText,start:null,end:null});
function fixture(courses:Course[]):Extraction{return {status:"ok",kind:"personal",confidence:"medium",termWeeks:19,warnings:[],courses,coverage:Array.from({length:7},(_,i)=>({day:i+1,visibility:"shown",count:courses.filter(c=>c.day===i+1).length}))};}
describe("证据保留与质量保护",()=>{
  it("原文优先覆盖错误的节次和周次，去除教师地点",()=>{
    const x=fixture([c("高数",1,"第3节","6-7周","高数/(6-7节)1-3周,5-16周/校区/教师")]);
    const {result}=parseExtraction(x);
    if(!result.success||result.data.status!=="ok")throw Error("invalid");
    expect(result.data.courses[0]).toMatchObject({timeLabel:"第6-7节",weeks:"1-3周,5-16周",rawText:"高数/(6-7节)1-3周,5-16周"});
  });
  it("错位的节次不能变成周次",()=>{
    const {result}=parseExtraction(fixture([c("工图",1,"第4节","8-9节")]));
    if(!result.success||result.data.status!=="ok")throw Error("invalid");
    expect(result.data.courses[0]).toMatchObject({timeLabel:null,weeks:null});
  });
  it("六条可解析、十条未知时不给幸福度",()=>{
    const x=fixture(Array.from({length:16},(_,i)=>c("C"+i,1+i%5,"第1-2节",i<6?"1-16周":null)));
    const s=buildTimetable(x);expect(qualityOf(s).bothKnown).toBe(6);
    expect(needsRecheck(x)).toBe(true);expect(scoreTimetable(s).score).toBeNull();
    expect(scoreTimetable(s).metrics.endurance.score).toBeNull();
  });
  it("不覆盖非目标日期，接受补齐周次的候选日期",()=>{
    const a=fixture([c("A",1,"第4节",null),c("B",2,"第1-2节","第1周","B/(1-2节)第1周")]);
    const b=fixture([c("A",1,"第8-9节","第6周","A/(8-9节)第6周"),c("C",1,"第1-2节","第1周","C/(1-2节)第1周")]);
    const merged=mergeRecheck(a,b,[1]);expect(merged.courses).toHaveLength(3);
    expect(merged.courses.find(x=>x.name==="B")).toEqual(a.courses[1]);
    expect(qualityOf(buildTimetable(merged)).bothKnown).toBe(3);
  });
  it("拒绝丢失已完整识别的记录",()=>{
    const a=fixture([c("A",1,"第1-2节","第1周","A/(1-2节)第1周"),c("B",1,"第4节",null)]);
    const b=fixture([c("A",1,"第3-4节","第2周","A/(3-4节)第2周"),c("B",1,"第4节","第2周","B/(4节)第2周")]);
    expect(mergeRecheck(a,b,[1])).toEqual(a);
  });
  it("完整记录不触发复核",()=>expect(needsRecheck(fixture([c("A",1,"第1-2节","第1周","A/(1-2节)第1周")]))).toBe(false));
});

describe("通用位置证据与跨日核对",()=>{
  const located=(day:number,header:string,slot="09:00–10:00")=>({...c("课程X",day,"第1-2节","1-8周","课程X/(1-2节)1-8周"),sourceDayLabel:header,sourceSlotLabel:slot});
  it("识别中英文实际星期标题，不将无标题序号当星期",()=>{
    expect(weekdayHeader("星期三")).toBe(3);
    expect(weekdayHeader("Fri.")).toBe(5);
    expect(weekdayHeader("星期日")).toBe(7);
    expect(weekdayHeader("第3节")).toBeNull();
    expect(weekdayHeader("3")).toBeNull();
  });
  it("相同安排跨日触发核对，但不自动删除合法重复课程",()=>{
    const a=fixture([located(1,"Monday"),located(3,"Wednesday")]);
    expect(needsRecheck(a)).toBe(true);
    expect(qualityOf(buildTimetable(a)).crossDayGroups).toEqual([[1,3]]);
    expect(mergeRecheck(a,a,[1,3]).courses).toHaveLength(2);
  });
  it("仅凭第二次漏读不能删除首次跨日重复记录",()=>{
    const a=fixture([located(1,"Monday"),located(3,"Wednesday")]);
    const b=fixture([located(1,"Monday")]);
    expect(mergeRecheck(a,b,[1,3]).courses).toHaveLength(2);
  });
  it("有独立空格证据与另一日确认时才允许移除可疑记录",()=>{
    const a=fixture([located(1,"Monday"),located(3,"Wednesday")]);
    const b=fixture([located(1,"Monday")]);
    b.coverage[2].emptySlots=["09:00-10:00"];
    expect(mergeRecheck(a,b,[1,3]).courses.map(r=>r.day)).toEqual([1]);
    expect(mergeRecheck(a,b,[3]).courses).toHaveLength(2);
  });
  it("星期证据冲突时保留原始记录并标记两日不确定",()=>{
    const {result}=parseExtraction(fixture([located(1,"Wednesday")]));
    if(!result.success||result.data.status!=="ok")throw Error("invalid");
    expect(result.data.courses[0].day).toBe(1);
    expect(result.data.coverage[0].visibility).toBe("uncertain");
    expect(result.data.coverage[2].visibility).toBe("uncertain");
  });
  it("同一格不同课程或周次不合并",()=>{
    const a=fixture([located(1,"周一"),{...located(1,"周一"),name:"课程Y",rawText:"课程Y/(1-2节)1-8周"},{...located(1,"周一"),weeks:"9-16周",rawText:"课程X/(1-2节)9-16周"}]);
    const {result}=parseExtraction(a);
    if(!result.success||result.data.status!=="ok")throw Error("invalid");
    expect(result.data.courses).toHaveLength(3);
  });
});
