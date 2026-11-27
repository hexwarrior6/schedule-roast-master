import {describe,it,expect} from "vitest";
import {normalize5,jointEvidence,validateTopology} from "./round5";
import type {Topology} from "./round5-types";
const cell={id:"G0",bounds:[0,0,100,100] as [number,number,number,number],day:1,periods:[1,2],logical:null,source:"local_edges",quality:.9,lineIds:[0],text:"高等数学\n1-16周"};
const source={status:"ok" as const,source:"test",cells:[cell],ticks:[],elapsedMs:1};
const t:Topology={geometry:source,learned:{...source,cells:[{...cell,id:"T0",source:"slanet_plus"}]}};
describe("round 5",()=>{
 it("recognizes independent agreement only when logical span and day agree",()=>{expect(jointEvidence(t)[0].periods).toEqual([1,2]);expect(jointEvidence({...t,learned:{...t.learned,cells:[{...cell,periods:[1,2,3]}]}})[0].periods).toBeNull()});
 it("repairs explicit footer prefix without dropping title",()=>{const r=normalize5({status:"ok",kind:"personal",termWeeks:18,courses:[{name:"高等数学",day:1,timeLabel:"第1节",weeks:"1-16周"}],unscheduled:[{name:"实践/备注：认识实习",weeks:"第17周"}]});expect(r.schedule?.unscheduled[0].name).toBe("认识实习");expect(validateTopology(r.schedule,t).schedule?.courses[0].periodEnd).toBe(2)});
});
