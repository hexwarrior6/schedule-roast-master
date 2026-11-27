
import {z} from "zod";
import {resultSchema} from "./types";
export const methods=["B0","V1","V5","V8","V9","V10"] as const;
export type Method=typeof methods[number];
export const methodNames:Record<Method,string>={B0:"纯 OCR（原版）",V1:"上下文融合（原版）",V5:"软证据融合（原版）",V8:"语义空间对齐",V9:"结构感知重建",V10:"字段级证据融合"};
export const round3ResultSchema=resultSchema.extend({method:z.enum(methods),dependencies:z.array(z.enum(methods))});
export type Result=z.infer<typeof round3ResultSchema>;
export type Inputs=Partial<Record<Method,Result>>;
export type {OCR} from "./types";
