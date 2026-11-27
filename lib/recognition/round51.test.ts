import {describe,it,expect} from "vitest";
import {assess,planCrops,localEvidence} from "./round51";
import type {OCR,Topology} from "./round5-types";
import type {Layout} from "./round4-types";
const line=(text:string,x:number,y:number)=>({text,score:.99,box:[[x-5,y-4],[x+5,y-4],[x+5,y+4],[x-5,y+4]]});
const o:OCR={engine:"test",width:600,height:400,warm:true,loadMs:0,ocrMs:1,totalMs:1,lines:[...["周一","周二","周三","周四","周五"].map((s,i)=>line(s,100+i*100,30)),line("高等数学",100,90),...Array.from({length:4},(_,i)=>line(String(i+1),20,70+i*50))],grid:{status:"unresolved",regions:[],cells:[]}};
const l:Layout={version:1,kind:"grid",axis:{orientation:"columns",headers:[],cross:30,step:100},regions:Array.from({length:5},(_,i)=>({day:i+1,bounds:[50+i*100,50,150+i*100,350],source:"grid",reliable:true})),ticks:[],blocks:[],listHeaders:{},unassignedLineIds:[],layoutMs:1};
const source={status:"ok" as const,source:"cv",cells:[{id:"G0",bounds:[50,50,150,150] as [number,number,number,number],day:1,periods:[1,2],logical:null,source:"local_edges",quality:.9,lineIds:[5],text:"高等数学"}],ticks:Array.from({length:4},(_,i)=>({period:i+1,position:70+i*50,lineId:i+6})),elapsedMs:1};
const t:Topology={geometry:source,learned:{status:"unresolved",source:"not requested",cells:[],ticks:[],elapsedMs:0}};
describe("5.1 evidence",()=>{
 it("accepts complete observed weekday axis",()=>expect(assess(o,l,t).route).toBe("structured"));
 it("rejects missing observed weekday",()=>expect(assess({...o,lines:o.lines.map((x,i)=>i===0?{...x,text:""}:x)},l,t).route).toBe("context"));
 it("withholds geometric span when explicit period conflicts",()=>{const r=assess(o,l,{...t,geometry:{...source,cells:[{...source.cells[0],text:"高等数学 第1-3节"}]}});expect(r.cells[0].periods).toEqual([]);expect(r.cells[0].spanConflict).toBe(true);});
 it("only proposes a missing header crop; does not invent its content",()=>{const p=planCrops(o,{...l,axis:{orientation:"columns",headers:[2,3,4,5].map(day=>({day,center:day*100,lineId:day-1})),cross:30,step:100}},t);expect(p[0].reason).toContain("not assumed day 1");expect(localEvidence(p,null)).toEqual([]);});
});
