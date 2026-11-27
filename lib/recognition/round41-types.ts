import {z} from "zod";
import {resultSchema} from "./types";
export const methods=["V1","V9","V12","V15","V16","V17"] as const;
export type Method=typeof methods[number];
export const methodNames:Record<Method,string>={V1:"原版上下文（历史对照）",V9:"结构重建（历史对照）",V12:"布局图（历史对照）",V15:"无损标准化",V16:"结构与布局联合",V17:"字段级证据校验"};
export const result41Schema=resultSchema.extend({method:z.enum(methods),dependencies:z.array(z.enum(methods))});
export type Result=z.infer<typeof result41Schema>;
export type Inputs=Partial<Record<Method,Result>>;
export type {OCR} from "./round4-types";
