import { z } from "zod";

export const dimensions = [
  ["weeks", "周次地狱指数"],
  ["early", "早八地狱指数"],
  ["distribution", "课程分布合理性"],
  ["endurance", "连续上课耐力测试"],
  ["memory", "记忆力挑战赛"],
  ["workload", "课业负担波动性"],
  ["social", "社交生活影响"],
  ["happiness", "总体幸福度预测"],
] as const;
export const dimensionKeys = ["weeks", "early", "distribution", "endurance", "memory", "workload", "social", "happiness"] as const;
const clock = z.string().regex(/^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/).nullable();

export const courseSchema = z.object({
  name: z.string().min(1).max(100),
  day: z.number().int().min(1).max(7),
  start: clock,
  end: clock,
  timeLabel: z.string().max(80).nullable(),
  weeks: z.string().max(120).nullable(),
}).refine(c => !c.start || !c.end || c.start < c.end, { message: "课程结束时间必须晚于开始时间" });

export const coverageSchema = z.array(z.object({
  day: z.number().int().min(1).max(7),
  visibility: z.enum(["shown","not_shown","uncertain"]),
  count: z.number().int().min(0).max(150),
})).length(7).refine(rows => new Set(rows.map(row => row.day)).size === 7);
export const scheduleKindSchema = z.enum(["personal","catalog","uncertain"]);
const termWeeksSchema=z.number().int().min(1).max(60).nullable();
const unscheduledSchema=z.array(z.object({name:z.string().min(1).max(100),weeks:z.string().max(120).nullable()})).max(50);
export const canonicalScheduleSchema=z.object({
  version:z.literal(1),
  kind:scheduleKindSchema,
  termWeeks:termWeeksSchema,
  coverage:coverageSchema,
  courses:z.array(courseSchema.and(z.object({
    id:z.string(),
    periodStart:z.number().int().min(1).max(30).nullable(),
    periodEnd:z.number().int().min(1).max(30).nullable(),
    weekNumbers:z.array(z.number().int().min(1).max(60)).max(60).nullable(),
  }))).min(1).max(150),
  unscheduled:unscheduledSchema,
});
export type CanonicalSchedule=z.infer<typeof canonicalScheduleSchema>;
export const extractionSchema = z.object({
  status: z.literal("ok"),
  kind: scheduleKindSchema,
  termWeeks:termWeeksSchema.optional(),
  unscheduled:unscheduledSchema.optional(),
  confidence: z.enum(["high","medium","low"]),
  warnings: z.array(z.string().max(200)).max(8),
  coverage: coverageSchema,
  courses: z.array(courseSchema).min(1).max(150),
}).superRefine((data,ctx)=>{
  for(const row of data.coverage){
    const count=data.courses.filter(c=>c.day===row.day).length;
    if(count!==row.count || (row.visibility==="not_shown" && count!==0)){
      ctx.addIssue({code:"custom",path:["coverage"],message:"逐日课程块数量不一致"});
    }
  }
  const keys=data.courses.map(c=>JSON.stringify([c.day,c.name,c.start,c.end,c.timeLabel,c.weeks]));
  if(new Set(keys).size!==keys.length)ctx.addIssue({code:"custom",path:["courses"],message:"存在完全重复的课程块"});
});
const unreadableSchema = z.object({ status: z.literal("unreadable"), reason: z.string().min(1).max(200) });
export const extractionResultSchema = z.union([extractionSchema,unreadableSchema]);

export const reportSchema = z.object({
  status: z.literal("ok"),
  title: z.string().min(1).max(40),
  score: z.number().int().min(0).max(100).nullable(),
  summary: z.string().min(1).max(600),
  tags: z.array(z.string().min(1).max(20)).min(1).max(5),
  confidence: z.enum(["high", "medium", "low"]),
  kind: scheduleKindSchema.optional(),
  coverage: coverageSchema.optional(),
  schedule:canonicalScheduleSchema.optional(),
  warnings: z.array(z.string().max(200)).max(8),
  courses: z.array(courseSchema).min(1).max(150),
  reviews: z.array(z.object({
    key: z.enum(dimensionKeys),
    // 统一：分值越高，安排越友好；无法判断时返回 null。
    score: z.number().int().min(0).max(100).nullable(),
    comment: z.string().min(1).max(400),
  })).length(8).refine(items => new Set(items.map(item => item.key)).size === 8),
  advice: z.array(z.string().min(1).max(180)).min(1).max(4),
});
export const modelResultSchema = z.discriminatedUnion("status", [
  reportSchema,
  z.object({ status: z.literal("unreadable"), reason: z.string().min(1).max(200) }),
]);
export const reviewResultSchema = reportSchema.pick({title:true,summary:true,tags:true,reviews:true,advice:true});
export type Extraction = z.infer<typeof extractionSchema>;
export type ReviewResult = z.infer<typeof reviewResultSchema>;
export type Course = z.infer<typeof courseSchema>;
export type Report = z.infer<typeof reportSchema>;
