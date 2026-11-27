import {describe,it,expect} from "vitest";
import {repairWeek,repairRaw,normalizeLossless,validateFields} from "./round41";
describe("round 4.1 normalization",()=>{
 it("normalizes attested suffix without changing week semantics",()=>{
  expect(repairWeek("3-14周上")).toBe("3-14周");
  expect(repairWeek("第2-13周上")).toBe("第2-13周");
  expect(repairWeek("1-15周上(单周)")).toBe("1-15周(单周)");
  expect(repairWeek("3-14周不上")).toBe("3-14周不上");
  expect(repairWeek("第3周上课")).toBe("第3周上课");
  expect(repairWeek("未知")).toBe("未知");
 });
 it("fixes embedded raw text and retains original input",()=>{
  const row={name:"课程甲",day:1,timeLabel:"第1节",weeks:"3-14周上",rawText:"课程甲/(1节)3-14周上/地点"};
  const root={status:"ok",kind:"personal",termWeeks:16,confidence:"medium",warnings:[],courses:[row],coverage:[],unscheduled:[]};
  const n=normalizeLossless(root);
  expect(n.schedule?.courses[0].weekNumbers).toEqual(Array.from({length:12},(_,i)=>i+3));
  expect(row.rawText).toBe("课程甲/(1节)3-14周上/地点");
  expect(n.repairs.length).toBe(2);
 });
 it("keeps missing weeks unknown and explicit parity",()=>{
  const n=normalizeLossless({status:"ok",kind:"personal",termWeeks:16,courses:[{name:"甲课",day:1,timeLabel:"第一节",weeks:"1-15周上(单周)"},{name:"乙课",day:2,timeLabel:"第2节",weeks:null}]});
  expect(n.schedule?.courses[0].weekNumbers).toEqual([1,3,5,7,9,11,13,15]);
  expect(n.schedule?.courses[1].weekNumbers).toBeNull();
  expect(validateFields(n.schedule,null,null).schedule).toEqual(n.schedule);
 });
 it("does not turn negative or out of range expressions into positive weeks",()=>{expect(repairWeek("3-14周不上")).toBe("3-14周不上");expect(repairWeek("9-2周上")).toBe("9-2周上");});
});
