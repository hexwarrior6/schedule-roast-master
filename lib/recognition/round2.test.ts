import {describe,it,expect} from "vitest";
import {softFusion,explicitEvidence,regionalMerge,adaptive,documentKind} from "./round2";
import {parseOCR} from "./evidence";
import type {OCR} from "./types";
import type {Result} from "./round2-types";
const box=(x:number,y:number,r:number,b:number):[number,number][]=>[[x,y],[r,y],[r,b],[x,b]];
function fixture():OCR{
 const texts=["课程甲","/(1-2节)1-8周/地点","课程乙/(3-4节)第9周/地点","课程甲/(1-2节)1-8周/地点"];
 return {engine:"fixture",width:200,height:200,warm:false,loadMs:0,ocrMs:1,totalMs:1,lines:texts.map((text,i)=>({text,score:.99,box:box(i===3?110:10,30+i*10,i===3?180:80,38+i*10)})),grid:{status:"mapped",regions:[{day:1,bounds:[0,20,100,180]},{day:3,bounds:[100,20,200,180]}],cells:[{day:1,bounds:[0,20,100,100],lineIds:[0,1,2],text:texts.slice(0,3).join("\n")},{day:3,bounds:[100,20,200,100],lineIds:[3],text:texts[3]}],unassignedLineIds:[]}};
}
describe("round two",()=>{
 it("recovers a title wrapped immediately before the slash",()=>{expect(explicitEvidence(fixture()).rows.map(c=>[c.name,c.day])).toContainEqual(["课程甲",1]);});
 it("keeps legitimate repeated courses and repairs omissions",()=>{
  const o=fixture(),base=parseOCR(o).schedule!,out=softFusion(o,base);
  expect(out.schedule?.courses.map(c=>[c.name,c.day])).toContainEqual(["课程甲",1]);
  expect(out.schedule?.courses.map(c=>[c.name,c.day])).toContainEqual(["课程甲",3]);
 });
 it("retains records with missing region ids",()=>{
  const o=fixture(),base=parseOCR(o).schedule!,raw={...base,status:"ok",confidence:"medium",warnings:[],courses:base.courses.map(c=>({...c,sourceRegion:undefined}))};
  const out=regionalMerge(o,raw,base);
  expect(out.schedule?.courses.length).toBe(base.courses.length);expect(out.partial).toBe(false);
 });
 it("detects explicit selection signals without relying on counts",()=>{
  const o=fixture();expect(documentKind(o).kind).toBe("unknown");o.lines.push({text:"已选 预选 剩余名额",score:.99,box:box(0,0,20,10)});expect(documentKind(o).kind).toBe("catalog");
 });
 it("uses full context if grid cannot be resolved",()=>{
  const o=fixture(),base=parseOCR(o).schedule!;o.grid={status:"unresolved",regions:[],cells:[]};
  const result={method:"V1",schedule:base} as Result;expect(adaptive(o,{V1:result}).chosen).toBe("V1");
 });
});
