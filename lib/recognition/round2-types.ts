
import {z} from "zod";
import {resultSchema} from "./types";
export const methods=["B0","V1","V5","V6","V7"] as const;
export type Method=typeof methods[number];
export const methodNames:Record<Method,string>={B0:"纯 OCR（原版）",V1:"上下文融合（原版）",V5:"软证据融合",V6:"区域级识别",V7:"自适应路由"};
export const round2ResultSchema=resultSchema.extend({method:z.enum(methods),dependencies:z.array(z.enum(methods))});
export type Result=z.infer<typeof round2ResultSchema>;
export type Inputs=Partial<Record<Method,Result>>;
export type {OCR} from "./types";
