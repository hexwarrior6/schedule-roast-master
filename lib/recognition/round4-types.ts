import {z} from "zod";
import {resultSchema,ocrSchema} from "./types";
export const methods=["V1","V9","V11","V12","V13","V14"] as const;
export type Method=typeof methods[number];
export const methodNames:Record<Method,string>={V1:"原版上下文（对照）",V9:"第三轮结构重建（对照）",V11:"物理课程块检测",V12:"布局图推理",V13:"区域隔离复核",V14:"自适应布局融合"};
export const round4ResultSchema=resultSchema.extend({method:z.enum(methods),dependencies:z.array(z.enum(methods))});
export type Result=z.infer<typeof round4ResultSchema>;
export type Inputs=Partial<Record<Method,Result>>;
const bounds=z.tuple([z.number(),z.number(),z.number(),z.number()]);
const day=z.number().int().min(1).max(7);
export const layoutSchema=z.object({
 version:z.literal(1),kind:z.enum(["grid","cards","header_axis","list","unresolved"]),
 axis:z.object({orientation:z.enum(["columns","rows"]),headers:z.array(z.object({lineId:z.number().int().nonnegative(),day,center:z.number()})).max(7),cross:z.number(),step:z.number()}).nullable(),
 regions:z.array(z.object({day,bounds,source:z.enum(["grid","header_axis"]),reliable:z.boolean()})).max(7),
 ticks:z.array(z.object({period:z.number().int().min(1).max(30),position:z.number(),lineId:z.number().int().nonnegative(),explicit:z.boolean()})).max(30),
 blocks:z.array(z.object({id:z.string().regex(/^P\d+$/),bounds,day:day.nullable(),lineIds:z.array(z.number().int().nonnegative()).max(1600),source:z.enum(["grid","color","column","list_row"]),quality:z.number().min(0).max(1),periods:z.array(z.number().int().min(1).max(30)).max(30)})).max(150),
 listHeaders:z.record(z.string(),z.object({lineId:z.number().int().nonnegative(),center:z.tuple([z.number(),z.number()])})),unassignedLineIds:z.array(z.number().int().nonnegative()).max(1600),layoutMs:z.number().nonnegative()
});
export type Layout=z.infer<typeof layoutSchema>;
export type Block=Layout["blocks"][number];
export type OCR=z.infer<typeof ocrSchema>&{layout?:Layout};
export const bundleSchema=z.object({ocr:ocrSchema,layout:layoutSchema}).superRefine(({ocr,layout},ctx)=>{
 const valid=(b:number[])=>b[0]>=0&&b[1]>=0&&b[2]<=ocr.width&&b[3]<=ocr.height&&b[2]>b[0]&&b[3]>b[1];
 for(const b of [...layout.blocks,...layout.regions])if(!valid(b.bounds))ctx.addIssue({code:"custom",message:"Invalid layout bounds"});
 for(const b of layout.blocks)if(b.lineIds.some(i=>i>=ocr.lines.length))ctx.addIssue({code:"custom",message:"Invalid layout reference"});
 if(layout.ticks.some(t=>t.lineId>=ocr.lines.length)||layout.axis?.headers.some(t=>t.lineId>=ocr.lines.length)||layout.unassignedLineIds.some(i=>i>=ocr.lines.length))ctx.addIssue({code:"custom",message:"Invalid line reference"});
});
