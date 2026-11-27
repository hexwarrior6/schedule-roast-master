import {describe,it,expect} from "vitest";
import {explicitBlocks,align,nameRelation,axisBlocks,fieldFusion,weekdayRegions} from "./round3";
import type {OCR} from "./types";
import {parseOCR} from "./evidence";
import type {CanonicalSchedule} from "../schema";
const box=(x:number,y:number,r:number,b:number):[number,number][]=>[[x,y],[r,y],[r,b],[x,b]];
function fixture():OCR{
 const texts=["Advanced machine","learning algorithms","/(1-2节)1-8周/地点","课程乙/(3-4节)第9周/地点","课程乙/(3-4节)第9周/地点"];
 return {engine:"fixture",width:200,height:200,warm:false,loadMs:0,ocrMs:1,totalMs:1,lines:texts.map((text,i)=>({text,score:.99,box:box(i===4?110:10,30+i*10,i===4?180:80,38+i*10)})),grid:{status:"mapped",orientation:"weekdays_in_columns",regions:[{day:1,bounds:[0,20,100,180]},{day:3,bounds:[100,20,200,180]}],cells:[{day:1,bounds:[0,20,100,100],lineIds:[0,1,2,3],text:texts.slice(0,4).join("\n")},{day:3,bounds:[100,20,200,100],lineIds:[4],text:texts[4]}],unassignedLineIds:[]}};
}
function base(o:OCR):CanonicalSchedule{
 const p=parseOCR(o).schedule!;
 const c={...p.courses[0],name:"Advanced machinelearning algorithms",day:1,timeLabel:"第1-2节",weeks:"1-8周",rawText:null,periodStart:1,periodEnd:2,weekNumbers:[1,2,3,4,5,6,7,8],id:"full"};
 return {...p,courses:[...p.courses,c],coverage:p.coverage.map(r=>({...r,count:r.count+(r.day===1?1:0)}))};
}
describe("round 3",()=>{
 it("reconstructs a multi-line title before a slash",()=>{
  const e=explicitBlocks(fixture(),null);expect(e.items.map(x=>x.course.name)).toContain("Advanced machinelearning algorithms");
 });
 it("does not add a suffix-only duplicate to a full name",()=>{
  const o=fixture(),b=base(o),out=align(o,b,explicitBlocks(o,b).items);
  expect(out.schedule?.courses.filter(c=>c.name.includes("algorithms"))).toHaveLength(1);
 });
 it("retains legitimate repeated courses on different days",()=>{
  const o=fixture(),b=base(o),out=align(o,b,explicitBlocks(o,b).items);
  expect(out.schedule?.courses.filter(c=>c.name==="课程乙").map(c=>c.day)).toEqual([1,3]);
 });
 it("does not conflate different numbered courses",()=>{expect(nameRelation("Advanced mathematics 1","Advanced mathematics 2")).toBe(0);});
 it("does not infer weekdays without actual header evidence",()=>{
  const o=fixture();expect(weekdayRegions(o)).toHaveLength(2);expect(axisBlocks(o,null).items).toHaveLength(0);
 });
 it("keeps the baseline if no structure is available",()=>{
  const o=fixture(),b=base(o);o.grid={status:"unresolved",regions:[],cells:[]};
  expect(fieldFusion(o,b,b,null).schedule?.courses.length).toBe(b.courses.length);
 });
});
