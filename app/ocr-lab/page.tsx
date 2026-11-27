"use client";
import {useState,useEffect} from "react";
type Line={text:string;score:number;box:number[][]};
type Cell={day:number;text:string;bounds:number[];lineIds:number[]};
type Result={engine:string;width:number;height:number;warm:boolean;loadMs:number;ocrMs:number;totalMs:number;lines:Line[];grid:{status:string;orientation?:string;reason?:string;cells:Cell[];unassignedLineIds?:number[]}};
export default function Lab(){
 const [file,setFile]=useState<File|null>(null),[url,setUrl]=useState(""),[result,setResult]=useState<Result|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(""),[code,setCode]=useState(""),[smoke,setSmoke]=useState<string>("");
 useEffect(()=>{if(!file){setUrl("");return;}const u=URL.createObjectURL(file);setUrl(u);return()=>URL.revokeObjectURL(u)},[file]);
 async function run(test:boolean){
  setBusy(true);setError("");setResult(null);setSmoke("");
  try{
   const r=await fetch("/api/ocr",{method:test?"GET":"POST",headers:{"x-analysis-code":code,...(!test?{"Content-Type":file!.type}:{})},...(!test?{body:file}:{}),cache:"no-store"});
   const j=await r.json();if(!r.ok)throw Error(j.error||"请求失败");
   if(test)setSmoke(JSON.stringify(j,null,2));else setResult(j);
  }catch(e){setError(e instanceof Error?e.message:"请求失败");}finally{setBusy(false)}
 }
 function save(){if(!result)return;const u=URL.createObjectURL(new Blob([JSON.stringify(result,null,2)],{type:"application/json"}));const a=document.createElement("a");a.href=u;a.download="ocr-lab.json";a.click();setTimeout(()=>URL.revokeObjectURL(u),1000)}
 return <main style={{maxWidth:1000,margin:"32px auto",padding:"0 18px"}}>
 <a href="/">返回原版课表评价</a> · <a href="/recognition-lab">批量融合实验台</a><h1>OCR 实验室</h1><p>RapidOCR + ONNX Runtime CPU · 仅测试文字、坐标和真实网格定位，不生成正式评价。</p>
 <p>仅预览环境可用。上传不超过 3 MB 的 PNG、JPEG 或 WebP，图片不发送给大模型，也不持久化。</p>
 <label>访问码（如已配置） <input type="password" value={code} onChange={e=>setCode(e.target.value)}/></label>
 <div style={{margin:"16px 0",display:"flex",flexWrap:"wrap",gap:12}}><input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={e=>{setFile(e.target.files?.[0]??null);setResult(null)}}/><button className="primary-button compact" disabled={busy||!file} onClick={()=>run(false)}>{busy?"识别中…":"开始 OCR"}</button><button className="secondary-button" disabled={busy} onClick={()=>run(true)}>运行内置测试</button></div>
 {error&&<p role="alert">{error}</p>}{smoke&&<pre style={{whiteSpace:"pre-wrap"}}>{smoke}</pre>}
 {url&&<div style={{position:"relative",margin:"16px 0"}}><img src={url} alt="上传课表" style={{width:"100%",display:"block"}}/>{result&&<svg viewBox={`0 0 ${result.width} ${result.height}`} preserveAspectRatio="none" style={{position:"absolute",inset:0,width:"100%",height:"100%",pointerEvents:"none"}}>{result.lines.map((l,i)=><polygon key={i} points={l.box.map(p=>p.join(",")).join(" ")} fill="none" stroke={l.score<0.7?"#e48020":"#16824a"} strokeWidth={1.5}/>)}{result.grid.cells.map((c,i)=><rect key={i} x={c.bounds[0]} y={c.bounds[1]} width={c.bounds[2]-c.bounds[0]} height={c.bounds[3]-c.bounds[1]} stroke="#2663cb" strokeWidth={2} fill="none"/>)}</svg>}</div>}
 {result&&<><h2>识别结果</h2><p>{result.engine} · {result.lines.length} 个文字框 · 加载 {result.loadMs} ms · OCR {result.ocrMs} ms · 总计 {result.totalMs} ms · {result.warm?"热实例":"首次加载"}</p><button className="secondary-button" onClick={save}>导出 OCR JSON</button><h2>表格定位</h2><p>{result.grid.status==="mapped"?result.grid.orientation+" · "+result.grid.cells.length+" 个非空单元格（不等于课程记录数）":"未可靠定位，保留全部文字坐标供核对"}</p>
 <div className="table-wrap"><table><thead><tr><th>星期</th><th>原始单元格文字</th></tr></thead><tbody>{result.grid.cells.map((c,i)=><tr key={i}><td>周{"一二三四五六日"[c.day-1]}</td><td style={{whiteSpace:"pre-wrap"}}>{c.text}</td></tr>)}</tbody></table></div>
 <h2>全部文字框</h2><div className="table-wrap"><table><thead><tr><th>文字</th><th>OCR 置信度</th></tr></thead><tbody>{result.lines.map((l,i)=><tr key={i}><td>{l.text}</td><td>{(l.score*100).toFixed(1)}%</td></tr>)}</tbody></table></div></>}
 </main>
}
