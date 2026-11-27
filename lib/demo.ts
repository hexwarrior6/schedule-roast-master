import type { Report } from "./schema";

export const demoReport: Report = {
  status: "ok", title: "早八特种兵", score: 42,
  summary: "别人的大学生活是探索世界，你的大学生活是探索教学楼之间的最短路径。周一早八开局，周三连堂暴击，建议把闹钟列入本学期的必修教材。",
  tags: ["早八刺客","教室常驻人口","周五回血"],
  confidence: "high", warnings: ["这是虚构的示例课表，仅用于体验报告。"],
  courses: [
    {name:"高等数学",day:1,start:"08:00",end:"09:40",timeLabel:null,weeks:"1-16周"},
    {name:"计算机网络",day:1,start:"10:00",end:"11:40",timeLabel:null,weeks:"1-16周"},
    {name:"大学英语",day:1,start:"14:00",end:"15:40",timeLabel:null,weeks:"1-16周"},
    {name:"概率论",day:2,start:"08:00",end:"09:40",timeLabel:null,weeks:"1-16周"},
    {name:"数据结构",day:3,start:"08:00",end:"09:40",timeLabel:null,weeks:"1-16周"},
    {name:"操作系统",day:3,start:"10:00",end:"11:40",timeLabel:null,weeks:"1-16周"},
    {name:"实验课",day:3,start:"14:00",end:"17:40",timeLabel:null,weeks:"双周"},
    {name:"体育",day:4,start:"08:00",end:"09:40",timeLabel:null,weeks:"1-16周"},
    {name:"人工智能导论",day:4,start:"15:00",end:"16:40",timeLabel:null,weeks:"单周"},
  ],
  reviews:[
    {key:"weeks",score:57,comment:"单双周交替，建议给周三安排一个专属提醒。你的记忆力不是教务系统的备份服务器。"},
    {key:"early",score:20,comment:"四天九点前开课，闹钟恐怕已经学会了替你思考人生。"},
    {key:"distribution",score:47,comment:"周三塞得很满，周五倒是留了喘息空间。这就是排课版的先苦后甜。"},
    {key:"endurance",score:35,comment:"上午两门接力，下午还有长实验。午饭时间请务必保护好。"},
    {key:"memory",score:55,comment:"单周双周叠加，别把去空教室当成校园探索成就。"},
    {key:"workload",score:48,comment:"双周长实验让课程密度有明显变化。真实作业压力还得看课程要求。"},
    {key:"social",score:50,comment:"周五的空白看起来很诱人，但别忘了它也可能是补觉专区。"},
    {key:"happiness",score:42,comment:"不是不能活，是需要一套精确到闹钟和饭点的生存策略。"},
  ],
  advice:["提前设置单双周提醒。","周三留出午饭和休息时间，不要再塞额外活动。","利用相对空闲的周五整理本周课程。"],
};
