import {describe,it,expect} from "vitest";
import {canonicalPeriod,layoutGraph,refineGraph,evidenceDiagnostics,selectRegions,mergeIsolated,adaptive} from "./round4";
import type {Layout,Result} from "./round4-types";
import type {OCR} from "./types";
import type {CanonicalSchedule} from "../schema";
const ocr:OCR={engine:"fixture",width:300,height:300,warm:false,loadMs:0,ocrMs:1,totalMs:1,lines:[{text:"高等数学",score:.99,box:[[100,50],[180,50],[180,65],[100,65]]},{text:"非本周",score:.99,box:[[100,70],[150,70],[150,80],[100,80]]}],grid:{status:"unresolved",regions:[],cells:[]}};
const layout:Layout={version:1,kind:"cards",axis:{orientation:"columns",headers:[],cross:20,step:80},regions:[{day:2,bounds:[90,30,190,280],source:"header_axis",reliable:true},{day:3,bounds:[190,30,280,280],source:"header_axis",reliable:true}],ticks:[],blocks:[{id:"P0",day:2,bounds:[92,32,188,110],source:"color",quality:.95,lineIds:[0,1],periods:[1,2]}],listHeaders:{},unassignedLineIds:[],layoutMs:1};
function base(day=2):CanonicalSchedule{
 return {version:1,kind:"personal",termWeeks:16,unscheduled:[],coverage:Array.from({length:7},(_,i)=>({day:i+1,count:i+1===day?1:0,visibility:"uncertain"})),courses:[{id:"c1",name:"高等数学",day,start:null,end:null,timeLabel:"第1节",weeks:"1-8周",periodStart:1,periodEnd:1,weekNumbers:[1,2,3,4,5,6,7,8],rawText:null}]};
}
describe("round four",()=>{
 it("normalizes explicit Chinese period labels, not ambiguous numbers",()=>{expect(canonicalPeriod("第一节")).toBe("第1节");expect(canonicalPeriod("2")).toBe("2");});
 it("records inactive state separately",()=>{expect(layoutGraph(ocr,layout).blocks[0].status).toBe("inactive");});
 it("expands only a uniquely grounded card extent",()=>{const r=refineGraph(base(),ocr,layout);expect(r.schedule?.courses[0].timeLabel).toBe("第1-2节");expect(r.changes).toHaveLength(1);});
 it("does not force another weekday based on matching text",()=>{expect(refineGraph(base(3),ocr,layout).schedule?.courses[0].day).toBe(3);expect(evidenceDiagnostics(base(3),ocr,layout).conflicts).toBe(1);});
 it("selects actual reliable high risk regions",()=>{expect(selectRegions(base(),ocr,layout).map(x=>x.day)).toContain(2);});
 it("does not copy an isolated course into an unrelated region",()=>{const r=mergeIsolated(base(),[{day:3,schedule:base(3)}],ocr,layout);expect(r.schedule?.courses).toHaveLength(1);expect(r.conflicts).toHaveLength(1);});
 it("prefers spatial agreement over unrelated placement",()=>{const r=adaptive(ocr,layout,{V9:{schedule:base(3),status:"ok"} as Result,V12:{schedule:base(),status:"ok"} as Result});expect(r.chosen).toBe("V12");});
});
