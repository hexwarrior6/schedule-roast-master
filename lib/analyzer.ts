import type { Course } from "./schema";

export const weekdays = ["周一","周二","周三","周四","周五","周六","周日"];
export function minutes(value: string) {
  const [h,m] = value.split(":").map(Number);
  return h * 60 + m;
}
export function analyzeCourses(courses: Course[]) {
  const visible = courses.filter((c,i,all) => all.findIndex(x =>
    x.day === c.day && x.name === c.name && x.start === c.start &&
    x.end === c.end && x.timeLabel === c.timeLabel && x.weeks === c.weeks) === i);
  const days = weekdays.map((day,i) => ({
    day, count: visible.filter(c=>c.day===i+1).length,
  }));
  const timed = visible.filter(c => c.start !== null);
  return {
    visibleCount: visible.length,
    earlyCount: timed.length ? timed.filter(c=>minutes(c.start!) < 9*60).length : null,
    timedCount: timed.length,
    activeDays: days.filter(d=>d.count>0).length,
    days,
  };
}
