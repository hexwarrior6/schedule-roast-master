import { analyzeCourses } from "./analyzer";
import { dimensions, type Extraction, type Report, type ReviewResult } from "./schema";

export function buildReport(extraction: Extraction, review?: ReviewResult): Report {
  const {kind,coverage,courses}=extraction;
  const stats=analyzeCourses(courses);
  const warnings=[...extraction.warnings];
  const confidence=coverage.some(d=>d.visibility==="uncertain")&&extraction.confidence==="high"?"medium":extraction.confidence;
  const base={status:"ok" as const,kind,coverage,courses,confidence,warnings};
  if(kind!=="personal" || !review){
    const reason=kind==="catalog"?"图片看起来是课程汇总或备选课程列表，不能确认哪些课程属于同一名学生。": "无法确认所有课程块是否属于同一名学生的个人排课。";
    return {...base,title:"选课还是上课？",summary:reason+" 已保留可见课程块，暂不计算个人幸福度。",score:null,tags:["先确认课表"],reviews:dimensions.map(([key])=>({key,score:null,comment:"缺少已选课程信息，暂不评价个人课业安排。"})),advice:["如果你想评价个人课表，请上传已选课后的个人课表截图。"]};
  }
  const reviews=review.reviews.map(item=>{
    if(item.key==="early"&&stats.timedCount<stats.visibleCount)return {...item,score:null,comment:"图中缺少部分或全部课程的准确钟表时间，不能确定早八次数。"};
    if(item.key==="weeks"&&courses.some(c=>!c.weeks))return {...item,score:null,comment:"部分课程周次不清晰，无法完整判断单双周及周次安排。"};
    return item;
  });
  const scores=reviews.filter(r=>r.key!=="happiness"&&r.score!==null).map(r=>r.score as number);
  const score=scores.length>=3?Math.round(scores.reduce((sum,n)=>sum+n,0)/scores.length):null;
  return {...base,...review,score,reviews:reviews.map(r=>r.key==="happiness"?{...r,score}:r)};
}
