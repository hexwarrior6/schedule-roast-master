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

export const reportSchema = z.object({
  status: z.literal("ok"),
  title: z.string().min(1).max(40),
  score: z.number().int().min(0).max(100),
  summary: z.string().min(1).max(600),
  tags: z.array(z.string().min(1).max(20)).min(1).max(5),
  confidence: z.enum(["high", "medium", "low"]),
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
export type Course = z.infer<typeof courseSchema>;
export type Report = z.infer<typeof reportSchema>;
