import { dimensions, type Extraction, type Report, type ReviewResult, type CanonicalSchedule } from "./schema";
import {buildTimetable} from "./timetable";
import {scoreTimetable} from "./score";
import {crossDayMatches} from "./quality";

// Model output supplies figurative wording only. Numerical claims and schedule
// facts always come from code. Reject common factual claims in decorative copy.
function creative(value:string|undefined,fallback:string,max:number){
  const s=value?.trim();
  if(!s||s.length>max||/[\d０-９]|[一二三四五六七八九十百千万]+(?:天|节|周|门|小时|分钟)|星期|周[一二三四五六日末天]|早八|上午|下午|晚上|晚间|凌晨|无课|没课|休息日|全休|满课|空课|学分|挂科|老师|教师|教室|不吃不喝|不吃饭|不上厕所|膀胱|自残|死亡|作业|考试|线代|高数|数理化|生物|化学|物理|英语|程设|地理/.test(s))return fallback;
  return s;
}
const fallback={
  weeks:"教务系统的拼图，不宜靠直觉通关。",
  early:"闹钟暂时保留申诉权。",
  distribution:"排课的艺术，有时更像俄罗斯方块。",
  endurance:"耐力条记得及时补充。",
  memory:"脑内缓存也需要定期清理。",
  workload:"节奏这件事，教务系统有自己的理解。",
  social:"自由时间值得认真保护。",
  happiness:"大学生活是一款需要存档的游戏。",
};
export function buildReport(extraction: Extraction, review?: ReviewResult, schedule:CanonicalSchedule=buildTimetable(extraction)): Report {
  const {kind,coverage,courses}=extraction;
  const rules=scoreTimetable(schedule);
  const warnings=[...extraction.warnings];
  const sameDays=crossDayMatches(schedule);
  if(sameDays.length)warnings.unshift("发现 "+sameDays.length+" 组不同日期的相同排课安排（可能是正常重复上课）；请核对原图星期定位，未仅凭相同内容删除。");
  const confidence=coverage.some(d=>d.visibility==="uncertain")&&extraction.confidence==="high"?"medium":extraction.confidence;
  if(kind!=="personal")warnings.unshift("图片可能包含候选或重叠课程。以下仅按可见排课进行假设性趣味评价，不代表实际选课负担。");
  if(!review)warnings.push("评价模型未返回有效文案，已使用规则统计及本地趣味文案。");
  const title=creative(review?.title,"课表俄罗斯方块",40);
  const joke=creative(review?.summary,"教务系统的拼图，还是得靠攻略通关。",120);
  const reviews=dimensions.map(([key])=>({key,score:rules.metrics[key].score,comment:rules.metrics[key].fact+" "+creative(review?.reviews.find(r=>r.key===key)?.comment,fallback[key],120)}));
  return {status:"ok",kind,coverage,courses,confidence,warnings:warnings.slice(0,8),schedule,
    title,summary:rules.summary+" "+joke,score:rules.score,tags:rules.tags,reviews,advice:rules.advice};
}
