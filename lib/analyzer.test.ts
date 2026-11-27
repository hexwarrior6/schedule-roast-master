import { describe,it,expect } from "vitest";
import { analyzeCourses } from "./analyzer";
import { demoReport } from "./demo";
import { reportSchema } from "./schema";
import { detectedImageType } from "./image";
describe("课表统计",()=>{
  it("示例符合报告 schema",()=>expect(reportSchema.safeParse(demoReport).success).toBe(true));
  it("统计可见块而不是假定周课时",()=>{
    const stats=analyzeCourses(demoReport.courses);
    expect(stats.visibleCount).toBe(9);
    expect(stats.earlyCount).toBe(4);
    expect(stats.activeDays).toBe(4);
    expect(stats.days.map(d=>d.count)).toEqual([3,1,3,2,0,0,0]);
  });
  it("去除完全重复的课程块",()=>expect(analyzeCourses([demoReport.courses[0],demoReport.courses[0]]).visibleCount).toBe(1));
  it("未知时刻不伪造早八数据",()=>expect(analyzeCourses([{...demoReport.courses[0],start:null,end:null}]).earlyCount).toBeNull());
  it("拒绝重复评价维度",()=>expect(reportSchema.safeParse({...demoReport,reviews:Array(8).fill(demoReport.reviews[0])}).success).toBe(false));
  it("识别图片魔数并拒绝普通文本",()=>{
    expect(detectedImageType(new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,0]))).toBe("image/png");
    expect(detectedImageType(new TextEncoder().encode("not a valid image"))).toBeNull();
  });
});
