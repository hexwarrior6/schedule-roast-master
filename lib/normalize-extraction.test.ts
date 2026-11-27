import {describe,it,expect} from "vitest";
import {parseExtraction} from "./normalize-extraction";
const input={status:"ok",kind:"personal",confidence:"high",courses:[{name:"测试课程",day:"周一",start:"8:00",end:"9:40",weeks:[1,2]},{name:"测试课程二",day:"2",timeLabel:"第3-4节",weeks:null}],coverage:[{day:1,visibility:"shown",count:2},{day:2,visibility:"shown",count:1}]};
describe("容错识别结构",()=>{
  it("规范化字符串星期、时间、周次和遗漏的可选字段",()=>{
    const {result,repaired}=parseExtraction(input);
    expect(repaired).toBe(true);
    expect(result.success).toBe(true);
    if(!result.success||result.data.status!=="ok")throw Error("expected extraction");
    expect(result.data.courses[0]).toMatchObject({day:1,start:"08:00",end:"09:40",weeks:"1、2",timeLabel:null});
    expect(result.data.coverage[0]).toEqual({day:1,count:1,visibility:"uncertain"});
    expect(result.data.coverage[2].visibility).toBe("uncertain");
    expect(result.data.confidence).toBe("low");
  });
  it("不为缺失星期的记录编造日期",()=>{
    const {result}=parseExtraction({...input,courses:[...input.courses,{name:"不明星期"}]});
    if(!result.success||result.data.status!=="ok")throw Error("expected extraction");
    expect(result.data.courses).toHaveLength(2);
    expect(result.data.warnings.join(" ")).toContain("缺少可确认的星期");
  });
  it("没有可确认课程时保持失败",()=>expect(parseExtraction({status:"ok",courses:[{name:"未知星期"}]}).result.success).toBe(false));
  it("不把节次转换成钟表时间",()=>{
    const {result}=parseExtraction({...input,courses:[{name:"测试",day:1,start:"第1节",timeLabel:"第1-2节"}]});
    if(!result.success||result.data.status!=="ok")throw Error("expected extraction");
    expect(result.data.courses[0].start).toBeNull();
  });
  it("保留明确不可读结果",()=>expect(parseExtraction({status:"unreadable",reason:"不是课表"}).result.success).toBe(true));
});
