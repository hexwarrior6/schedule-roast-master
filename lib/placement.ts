/** Interpret a visible weekday header, never an unlabelled row or column index. */
export function weekdayHeader(value:unknown):number|null{
  if(typeof value!=="string")return null;
  const s=value.normalize("NFKC").trim().toLowerCase().replace(/\s+/g,"").replace(/\.$/,"");
  const zh=s.match(/^(?:星期|周|礼拜)([一二三四五六日天1-7])$/);
  if(zh){const n=Number(zh[1]);return Number.isInteger(n)?n:Math.min(7,"一二三四五六日天".indexOf(zh[1])+1);}
  const en=[["mon","monday"],["tue","tues","tuesday"],["wed","wednesday"],["thu","thur","thurs","thursday"],["fri","friday"],["sat","saturday"],["sun","sunday"]];
  const i=en.findIndex(a=>a.includes(s));return i>=0?i+1:null;
}
export function slotKey(value:unknown):string|null{
  if(typeof value!=="string")return null;
  const s=value.normalize("NFKC").trim().replace(/[–—−~～至]/g,"-").replace(/\s+/g,"").toLowerCase();
  return s&&s.length<=64?s:null;
}
