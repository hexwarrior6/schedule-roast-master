import {describe,it,expect} from "vitest";
import {parseOCR,anchored,fuse,risks} from "./evidence";
import type {OCR} from "./types";
const box=(x:number,y:number,r:number,b:number):[number,number][]=>[[x,y],[r,y],[r,b],[x,b]];
function fixture():OCR{
 const texts=["课程甲/(1-","2节)1-8周/地点","课程乙/(3-4节)第9周/地点","课程甲/(1-2节)1-8周/地点"];
 const lines=texts.map((text,i)=>({text,score:0.99,box:box(i===3?110:10,30+i*10,i===3?180:80,38+i*10)}));
 return {engine:"fixture",width:200,height:200,warm:false,loadMs:0,ocrMs:1,totalMs:1,lines,grid:{status:"mapped",regions:[{day:1,bounds:[0,20,100,180]},{day:3,bounds:[100,20,200,180]}],cells:[{day:1,bounds:[0,20,100,100],lineIds:[0,1,2],text:texts.slice(0,3).join("\n")},{day:3,bounds:[100,20,200,100],lineIds:[3],text:texts[3]}],unassignedLineIds:[]}};
}
describe("recognition lab",()=>{
 it("extracts wrapped records and legitimate repetitions",()=>{
  const a=parseOCR(fixture());
  expect(a.schedule?.courses.map(c=>[c.name,c.day])).toEqual([["课程甲",1],["课程乙",1],["课程甲",3]]);
 });
 it("anchors weekday to actual source cell, rejecting unknown ids",()=>{
  const o=fixture();
  const row={name:"课程甲",day:5,timeLabel:"第1-2节",weeks:"1-8周",start:null,end:null,rawText:"课程甲/(1-2节)1-8周",sourceCell:"C0",evidenceIds:[0,1]};
  const r=anchored({status:"ok",kind:"personal",termWeeks:18,confidence:"medium",warnings:[],courses:[row,{...row,sourceCell:"C99"}]},o);
  expect(r.schedule?.courses).toHaveLength(1);
  expect(r.schedule?.courses[0].day).toBe(1);
  expect(r.anchors[0].supported).toBe(true);
  expect((r.diagnostics.issues as unknown[]).length).toBe(1);
 });
 it("does not delete legitimate repeated arrangements in independent fusion",()=>{
  const o=fixture(),a=parseOCR(o);
  const b=a.schedule!;
  const r=fuse(o,b,b,a.anchors);
  expect(r.schedule?.courses).toHaveLength(3);
  expect(r.diagnostics.matches).toBe(3);
 });
 it("targets crossing evidence without treating it as duplicated coursework",()=>{
  const o=fixture();o.lines.push({text:"unassigned",score:.96,box:box(80,40,120,48)});o.grid.unassignedLineIds=[4];
  expect(risks(o,[]).filter(x=>x.reasons.crossing).map(x=>x.id)).toEqual(["C0","C1"]);
 });
 it("unresolved OCR grid fails closed",()=>{
  const o=fixture();o.grid={status:"unresolved",regions:[],cells:[]};
  expect(parseOCR(o).schedule).toBeNull();
 });
});
