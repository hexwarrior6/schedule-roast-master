
import {z} from "zod";
import {canonicalScheduleSchema} from "../schema";
export const methods=["B0","B1","V1","V2","V3","V4"] as const;
export type Method=typeof methods[number];
export const methodNames:Record<Method,string>={B0:"纯 OCR",B1:"纯 VLM",V1:"上下文增强",V2:"空间锚定",V3:"双路独立融合",V4:"主动局部复核"};
const rect=z.tuple([z.number(),z.number(),z.number(),z.number()]);
const point=z.tuple([z.number(),z.number()]);
export const ocrSchema=z.object({
 engine:z.string().max(120),width:z.number().int().positive().max(2600),height:z.number().int().positive().max(2600),warm:z.boolean(),loadMs:z.number().nonnegative(),ocrMs:z.number().nonnegative(),totalMs:z.number().nonnegative(),
 lines:z.array(z.object({text:z.string().max(1200),score:z.number().min(0).max(1),box:z.array(point).length(4)})).max(1600),
 grid:z.object({status:z.enum(["mapped","unresolved"]),orientation:z.string().optional(),reason:z.string().optional(),regions:z.array(z.object({day:z.number().int().min(1).max(7),bounds:rect})).max(7),cells:z.array(z.object({day:z.number().int().min(1).max(7),bounds:rect,lineIds:z.array(z.number().int().nonnegative()).max(1600),text:z.string().max(16000)})).max(400),unassignedLineIds:z.array(z.number().int().nonnegative()).optional()})
}).superRefine((o,ctx)=>{
 for(const c of [...o.grid.regions,...o.grid.cells]){const [x,y,r,b]=c.bounds;if(x<0||y<0||r>o.width||b>o.height||r<=x||b<=y)ctx.addIssue({code:"custom",message:"Invalid OCR region"});}
 for(const c of o.grid.cells)if(c.lineIds.some(i=>i>=o.lines.length))ctx.addIssue({code:"custom",message:"Invalid OCR line reference"});
});
export type OCR=z.infer<typeof ocrSchema>;
export const anchorSchema=z.object({cellId:z.string().max(20),lineIds:z.array(z.number().int().nonnegative()).max(100),supported:z.boolean(),recordId:z.string().max(20)});
export type Anchor=z.infer<typeof anchorSchema>;
export const resultSchema=z.object({
 method:z.enum(methods),status:z.enum(["ok","partial","failed"]),schedule:canonicalScheduleSchema.nullable(),confidence:z.enum(["high","medium","low"]).optional(),warnings:z.array(z.string()).max(100),anchors:z.array(anchorSchema).max(150),diagnostics:z.record(z.string(),z.unknown()),model:z.string().nullable(),vlmCalls:z.number().int().nonnegative(),promptTokens:z.number().int().nonnegative(),completionTokens:z.number().int().nonnegative(),elapsedMs:z.number().nonnegative(),ocrMs:z.number().nonnegative(),dependencies:z.array(z.enum(methods)),error:z.string().optional()
});
export type Result=z.infer<typeof resultSchema>;
export type Inputs=Partial<Record<Method,Result>>;
