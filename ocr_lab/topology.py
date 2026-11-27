"""Independent topology proposals, not inferred courses. Round 5."""
import time
import re
import cv2
import numpy as np
from functools import lru_cache
from ocr_lab.engine import center, axis_lines, day_label
from ocr_lab.layout import period, box, overlap, area

def assign(cells, lines):
    # One OCR line may have at most one physical owner; ambiguous lines remain unassigned.
    for c in cells:c["lineIds"]=[]
    unassigned=[]
    for i,l in enumerate(lines):
        b=box(l);a=max(1,area(b))
        ranked=sorted([(overlap(b,c["bounds"])/a,j) for j,c in enumerate(cells)],reverse=True)
        if ranked and ranked[0][0]>=.65 and (len(ranked)==1 or ranked[0][0]-ranked[1][0]>=.18):
            cells[ranked[0][1]]["lineIds"].append(i)
        else:unassigned.append(i)
    for c in cells:
        c["lineIds"].sort(key=lambda i:(center(lines[i])[1],center(lines[i])[0]))
        c["text"]="\n".join(lines[i]["text"] for i in c["lineIds"])
    return unassigned

def tick_axis(lines, regions, orientation):
    if not regions:return []
    cross=min(r["bounds"][0 if orientation=="columns" else 1] for r in regions)
    start=min(r["bounds"][1 if orientation=="columns" else 0] for r in regions)
    end=max(r["bounds"][3 if orientation=="columns" else 2] for r in regions)
    candidates=[]
    for i,l in enumerate(lines):
        p=period(l["text"]);x,y=center(l);a,b=(x,y) if orientation=="columns" else (y,x)
        if p and l["score"]>=.65 and a<cross and start<b<end:
            candidates.append((p,b,a,i))
    runs=[]
    for c in sorted(candidates,key=lambda x:x[1]):
        if not runs or c[0]!=runs[-1][-1][0]+1:runs.append([c])
        else:runs[-1].append(c)
    if not runs:return []
    run=max(runs,key=len)
    if len(run)<4:return []
    gaps=np.diff([c[1] for c in run])
    if min(gaps)<=0 or max(gaps)>min(gaps)*3.2:return []
    if max(c[2] for c in run)-min(c[2] for c in run)>max(12,float(np.median(gaps))*.65):return []
    return [{"period":c[0],"position":round(c[1],2),"lineId":c[3]} for c in run]

def periods(bounds,ticks,orientation):
    a,b=(bounds[1],bounds[3]) if orientation=="columns" else (bounds[0],bounds[2])
    return [t["period"] for t in ticks if a<t["position"]<b]

def local_topology(image,ocr,layout):
    start=time.perf_counter();lines=ocr["lines"];grid=ocr["grid"]
    regions=(layout or {}).get("regions",[])
    orientation=((layout or {}).get("axis") or {}).get("orientation","columns")
    ticks=tick_axis(lines,regions,orientation)
    cells=[];boundaries=[]
    if grid["status"]=="mapped" and regions:
        gray=cv2.cvtColor(image,cv2.COLOR_BGR2GRAY)
        if orientation=="rows":gray=gray.T
        binary=cv2.adaptiveThreshold(gray,255,cv2.ADAPTIVE_THRESH_MEAN_C,cv2.THRESH_BINARY_INV,31,12)
        for j,r in enumerate(regions):
            x,y,X,Y=r["bounds"] if orientation=="columns" else [r["bounds"][1],r["bounds"][0],r["bounds"][3],r["bounds"][2]]
            x,y,X,Y=map(int,(x,y,X,Y))
            if X-x<12 or Y-y<12:continue
            # Local line projection, not global horizontal cuts. Morphology removes most text.
            inset=max(2,round((X-x)*.04))
            crop=binary[y:Y,x+inset:X-inset]
            if not crop.size:continue
            mask=cv2.morphologyEx(crop,cv2.MORPH_OPEN,cv2.getStructuringElement(cv2.MORPH_RECT,(max(8,crop.shape[1]//3),1)))
            support=(mask>0).mean(axis=1)
            ys=np.flatnonzero(support>=.66)
            clusters=[]
            for k in ys:
                if not clusters or k-clusters[-1][-1]>4:clusters.append([int(k)])
                else:clusters[-1].append(int(k))
            cuts=[y+round(sum(c)/len(c)) for c in clusters]
            cuts=sorted(set([y,Y]+[v for v in cuts if y+5<v<Y-5]))
            # No local interior edge means a single broad proposal, not proof of a merged course.
            for a,b in zip(cuts,cuts[1:]):
                if b-a<7:continue
                bounds=[x,a,X,b] if orientation=="columns" else [a,x,b,X]
                p=periods(bounds,ticks,orientation)
                cells.append({"id":"G"+str(len(cells)),"bounds":bounds,"day":r["day"],"periods":p,"logical":[p[0]-1,p[-1]-1,j,j] if p else None,"source":"local_edges","quality":.9 if len(cuts)>2 and p else .55})
            boundaries.append({"day":r["day"],"localCuts":cuts})
    else:
        for b in (layout or {}).get("blocks",[]):
            if b["source"] not in ("color","list_row"):continue
            p=periods(b["bounds"],ticks,orientation) if b["source"]=="color" else []
            cells.append({"id":"G"+str(len(cells)),"bounds":b["bounds"],"day":b["day"],"periods":p,"logical":None,"source":b["source"],"quality":b["quality"]})
    cells=cells[:300];unassigned=assign(cells,lines)
    return {"status":"ok" if cells else "unresolved","source":"opencv","cells":cells,"ticks":ticks,"boundaries":boundaries,"unassignedLineIds":unassigned,"elapsedMs":round((time.perf_counter()-start)*1000)}

@lru_cache(maxsize=1)
def table_engine():
    from rapid_table import RapidTable, RapidTableInput, ModelType
    # No second OCR model or PyTorch. SLANet-plus is shipped in the wheel.
    return RapidTable(RapidTableInput(model_type=ModelType.SLANETPLUS,use_ocr=False,engine_cfg={"intra_op_num_threads":1,"inter_op_num_threads":1}))

def learned_topology(image,ocr,layout):
    start=time.perf_counter();engine=table_engine();loaded=time.perf_counter()
    result=engine(image);h,w=image.shape[:2]
    raw=result.cell_bboxes[0];logic=result.logic_points[0]
    if len(raw)!=len(logic) or len(raw)>300:raise ValueError("Invalid table cell sequence")
    orientation=((layout or {}).get("axis") or {}).get("orientation","columns")
    regions=(layout or {}).get("regions",[]);ticks=tick_axis(ocr["lines"],regions,orientation)
    cells=[]
    for i,(b,l) in enumerate(zip(raw,logic)):
        b=np.asarray(b).reshape(-1)
        if len(b) not in (4,8) or not np.isfinite(b).all():continue
        x,y,X,Y=(min(b[::2]),min(b[1::2]),max(b[::2]),max(b[1::2]))
        bounds=[max(0,round(float(x))),max(0,round(float(y))),min(w,round(float(X))),min(h,round(float(Y)))]
        if area(bounds)<20:continue
        matches=[r for r in regions if overlap(bounds,r["bounds"])/area(bounds)>=.75 and r["reliable"]]
        day=matches[0]["day"] if len(matches)==1 else None
        p=periods(bounds,ticks,orientation) if day else []
        logical=[int(v) for v in l]
        if len(logical)!=4:continue
        cells.append({"id":"T"+str(i),"bounds":bounds,"day":day,"periods":p,"logical":logical,"source":"slanet_plus","quality":None})
    unassigned=assign(cells,ocr["lines"])
    return {"status":"ok" if cells else "unresolved","source":"rapidtable-3.0.0/slanet-plus","cells":cells,"ticks":ticks,"unassignedLineIds":unassigned,"loadMs":round((loaded-start)*1000),"elapsedMs":round((time.perf_counter()-start)*1000)}

def both(image,ocr,layout):
    out={}
    for name,fn in (("geometry",local_topology),("learned",learned_topology)):
        try:out[name]=fn(image,ocr,layout)
        except Exception as exc:
            print("Round5 structure failure",name,type(exc).__name__)
            out[name]={"status":"failed","source":name,"cells":[],"ticks":[],"error":type(exc).__name__,"elapsedMs":0}
    return out

def smoke():
    from ocr_lab.engine import synthetic,recognize
    from ocr_lab.layout import build_layout
    image=synthetic();ocr=recognize(image);layout=build_layout(image,ocr)
    r=both(image,ocr,layout)
    return {"ok":all(x["status"]=="ok" for x in r.values()),"methods":{k:{"status":v["status"],"cells":len(v["cells"]),"elapsedMs":v["elapsedMs"],"error":v.get("error")} for k,v in r.items()}}
