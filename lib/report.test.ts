import {describe,it,expect} from "vitest";
import {extractionSchema,type Extraction} from "./schema";
import {buildReport} from "./report";
import {demoReport} from "./demo";
const counts=[3,2,2,5,4,0,0];
const sample:Extraction={
  status:"ok",kind:"personal",confidence:"medium",warnings:[],
  coverage:counts.map((count,i)=>({day:i+1,count,visibility:i<5?"shown":"not_shown"})),
  courses:counts.flatMap((count,i)=>Array.from({length:count},(_,j)=>({name:"测试课程"+i+"-"+j,day:i+1,start:null,end:null,timeLabel:"节次"+(j+1),weeks:null}))),
};
const review={title:demoReport.title,summary:demoReport.summary,tags:demoReport.tags,reviews:demoReport.reviews,advice:demoReport.advice};
describe("识别与评价分离",()=>{
  it("接受五日16块的合成回归数据",()=>expect(extractionSchema.safeParse(sample).success).toBe(true));
  it("拒绝逐日计数与课程明细不一致",()=>expect(extractionSchema.safeParse({...sample,courses:sample.courses.filter(c=>c.day!==4)}).success).toBe(false));
  it("拒绝未显示日期存在课程",()=>expect(extractionSchema.safeParse({...sample,coverage:sample.coverage.map(r=>r.day===4?{...r,visibility:"not_shown"}:r)}).success).toBe(false));
  it("课程目录仍正常生成假设性评价",()=>{const r=buildReport({...sample,kind:"catalog"},review);expect(r.score).toBeNull();expect(r.courses).toHaveLength(16);expect(r.reviews.some(x=>x.score!==null)).toBe(true);expect(r.warnings[0]).toContain("假设性");});
  it("评分不受模型分数影响，过滤明显错误的具体文案",()=>{
    const a=buildReport(sample,review);
    const b=buildReport(sample,{...review,title:"周末全休",summary:"每天早八",reviews:review.reviews.map(r=>({...r,score:100,comment:"周四连续7节"}))});
    expect(a.score).toEqual(b.score);
    expect(a.reviews.map(r=>r.score)).toEqual(b.reviews.map(r=>r.score));
    expect(b.title).not.toContain("周末全休");
    expect(b.summary).not.toContain("每天早八");
    expect(b.reviews.every(r=>!r.comment.includes("周四连续7节"))).toBe(true);
  });
  it("没有钟表时间或周次时覆盖模型错误评分",()=>{const r=buildReport(sample,review);expect(r.reviews.find(x=>x.key==="early")?.score).toBeNull();expect(r.reviews.find(x=>x.key==="weeks")?.score).toBeNull();expect(r.courses).toHaveLength(16);});
});
