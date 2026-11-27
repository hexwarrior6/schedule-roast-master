"""Round 4: independent geometric evidence. No course name or calendar inference."""
import re
import time
import unicodedata
import cv2
import numpy as np
from ocr_lab.engine import day_label, center, axis_lines

def weekday(s):
    s=unicodedata.normalize("NFKC",s).strip()
    d=day_label(s)
    if d:return d
    # Bare weekday characters are considered only as members of a coherent axis.
    if s in "一二三四五六日天" and len(s)==1:return min(7,"一二三四五六日天".index(s)+1)
    return None

def period(s):
    s=unicodedata.normalize("NFKC",s).strip()
    m=re.fullmatch(r"(?:第)?(\d{1,2}|[一二三四五六七八九十]|十[一二三四五六七八九])(?:节)?",s)
    if not m:return None
    t=m[1]
    n=int(t) if t.isdigit() else 10 if t=="十" else 10+"一二三四五六七八九".index(t[1])+1 if t.startswith("十") else "一二三四五六七八九".index(t)+1
    return n if 1<=n<=30 else None

def box(line):
    a=np.array(line["box"])
    return [float(a[:,0].min()),float(a[:,1].min()),float(a[:,0].max()),float(a[:,1].max())]

def overlap(a,b):
    return max(0,min(a[2],b[2])-max(a[0],b[0]))*max(0,min(a[3],b[3])-max(a[1],b[1]))

def area(a):return max(0,a[2]-a[0])*max(0,a[3]-a[1])
def center_in(line,b):
    x,y=center(line)
    return b[0]<x<b[2] and b[1]<y<b[3]

def header_axis(lines,w,h,orientation):
    candidates=[]
    for i,l in enumerate(lines):
        d=weekday(l["text"])
        if not d or l["score"]<.55:continue
        x,y=center(l);a,b=(x,y) if orientation=="columns" else (y,x)
        candidates.append((i,d,a,b))
    extent=h if orientation=="columns" else w
    span=w if orientation=="columns" else h
    results=[]
    for seed in candidates:
        group=sorted([c for c in candidates if abs(c[3]-seed[3])<=max(5,extent*.009)],key=lambda c:c[2])
        if len(group)<3 or len(group)>7 or len(set(c[1] for c in group))!=len(group):continue
        # Allow missing actual weekday labels; reject unrelated current-day labels and axis sequences.
        diffs=[(b[2]-a[2])/(b[1]-a[1]) for a,b in zip(group,group[1:]) if b[1]>a[1]]
        if len(diffs)!=len(group)-1:continue
        step=float(np.median(diffs))
        if step<span*.035 or any(abs(v-step)>step*.22 for v in diffs):continue
        results.append((len(group),sum(lines[c[0]]["score"] for c in group),group,step))
    if not results:return None
    _,_,group,step=max(results,key=lambda c:(c[0],c[1]))
    return {"orientation":orientation,"headers":[{"lineId":i,"day":d,"center":round(a,2)} for i,d,a,b in group],"cross":float(np.median([c[3] for c in group])),"step":step}

def color_blocks(image,lines,regions,axis):
    # Detect connected, similarly coloured physical cards; independently of OCR wording.
    h,w=image.shape[:2];scale=min(1,850/max(h,w))
    small=cv2.resize(image,(max(1,round(w*scale)),max(1,round(h*scale))),interpolation=cv2.INTER_AREA)
    hsv=cv2.cvtColor(small,cv2.COLOR_BGR2HSV)
    hue,sat,val=cv2.split(hsv)
    proposals=[]
    for shift in (0,12):
        q=((hue.astype(np.int16)+shift)%180)//24
        for k in range(8):
            mask=((q==k)&(sat>=28)&(val>=75)).astype(np.uint8)*255
            mask=cv2.morphologyEx(mask,cv2.MORPH_CLOSE,np.ones((3,3),np.uint8))
            n,_,stats,_=cv2.connectedComponentsWithStats(mask,8)
            for x,y,bw,bh,pixels in stats[1:]:
                if bw<7 or bh<8 or pixels/(bw*bh)<.52:continue
                b=[int(round(v/scale)) for v in (x,y,x+bw,y+bh)]
                b=[max(0,b[0]),max(0,b[1]),min(w,b[2]),min(h,b[3])]
                if not area(b) or area(b)>w*h*.22:continue
                match=[r for r in regions if overlap(b,r["bounds"])/area(b)>.72]
                if len(match)!=1:continue
                r=match[0];rb=r["bounds"]
                if axis["orientation"]=="columns" and not .34<=(b[2]-b[0])/(rb[2]-rb[0])<=1.12:continue
                if axis["orientation"]=="rows" and not .34<=(b[3]-b[1])/(rb[3]-rb[1])<=1.12:continue
                ids=[i for i,l in enumerate(lines) if center_in(l,b) and overlap(box(l),b)/max(1,area(box(l)))>.65]
                if not ids:continue
                proposals.append({"bounds":b,"day":r["day"],"lineIds":ids,"source":"color","quality":round(float(pixels/(bw*bh)),3)})
    result=[]
    for p in sorted(proposals,key=lambda a:area(a["bounds"])*a["quality"],reverse=True):
        if any(overlap(p["bounds"],q["bounds"])/min(area(p["bounds"]),area(q["bounds"]))>.75 for q in result):continue
        result.append(p)
    return sorted(result,key=lambda b:(b["day"],b["bounds"][1],b["bounds"][0]))[:150]

def build_layout(image,ocr):
    started=time.perf_counter();h,w=image.shape[:2];lines=ocr["lines"];grid=ocr["grid"]
    axes=[a for a in (header_axis(lines,w,h,"columns"),header_axis(lines,w,h,"rows")) if a]
    axes.sort(key=lambda a:len(a["headers"]),reverse=True)
    axis=axes[0] if axes and (len(axes)==1 or len(axes[0]["headers"])>len(axes[1]["headers"])) else None
    regions=[];blocks=[];ticks=[];layout="unresolved"
    if grid["status"]=="mapped":
        regions=[{"day":r["day"],"bounds":r["bounds"],"source":"grid","reliable":True} for r in grid["regions"]]
        orient="columns" if grid.get("orientation")=="weekdays_in_columns" else "rows"
        if not axis or axis["orientation"]!=orient:
            axis={"orientation":orient,"headers":[],"cross":0,"step":0}
        layout="grid"
        blocks=[{"bounds":c["bounds"],"day":c["day"],"lineIds":c["lineIds"],"source":"grid","quality":.85} for c in grid["cells"]]
    elif axis:
        # Only observed headers, plus gaps bracketed by observed headers. No
        # guessed unseen weekdays outside the observed axis.
        headers=axis["headers"];step=axis["step"];cross=axis["cross"]
        lo,hi=headers[0]["day"],headers[-1]["day"]
        for d in range(lo,hi+1):
            actual=next((x for x in headers if x["day"]==d),None)
            pos=actual["center"] if actual else headers[0]["center"]+(d-lo)*step
            a,b=max(0,round(pos-step/2)),min(w if axis["orientation"]=="columns" else h,round(pos+step/2))
            if b-a<5:continue
            top=max(0,round(cross+max(7,step*.12)))
            rb=[a,top,b,h] if axis["orientation"]=="columns" else [top,a,w,b]
            if area(rb)>0:regions.append({"day":d,"bounds":rb,"source":"header_axis","reliable":bool(actual)})
        layout="header_axis"
    if axis and regions:
        colors=color_blocks(image,lines,regions,axis)
        # For solid colour cards use their physical bounds, not the OCR line extent.
        if len(colors)>=3 and len({b["day"] for b in colors})>=2 and grid["status"]!="mapped":
            blocks=colors;layout="cards"
        elif not blocks:
            # Text regions are weak proposals, not actual course blocks.
            blocks=[{"bounds":r["bounds"],"day":r["day"],"lineIds":[i for i,l in enumerate(lines) if center_in(l,r["bounds"])],"source":"column","quality":.45} for r in regions]
        orient=axis["orientation"]
        start=min(r["bounds"][0 if orient=="columns" else 1] for r in regions)
        end=min(r["bounds"][1 if orient=="columns" else 0] for r in regions)
        candidates=[]
        for i,l in enumerate(lines):
            p=period(l["text"])
            x,y=center(l);a,b=(x,y) if orient=="columns" else (y,x)
            if p and a<start and b>end and l["score"]>=.65:
                candidates.append({"period":p,"position":round(b,2),"lineId":i,"explicit":"节" in l["text"]})
        candidates.sort(key=lambda a:a["position"])
        # Longest consecutive monotone run, with plausible same-axis spacing.
        runs=[]
        for c in candidates:
            if not runs or c["period"]!=runs[-1][-1]["period"]+1:runs.append([c])
            else:runs[-1].append(c)
        if runs:
            run=max(runs,key=len)
            if len(run)>=4 and (sum(t["explicit"] for t in run)>=3 or layout=="cards"):
                gaps=np.diff([t["position"] for t in run])
                if len(gaps) and min(gaps)>0 and max(gaps)<min(gaps)*3.2:ticks=run
        for b in blocks:
            rb=b["bounds"];a,z=(rb[1],rb[3]) if orient=="columns" else (rb[0],rb[2])
            contained=[t["period"] for t in ticks if a<t["position"]<z]
            b["periods"]=contained if b["source"] in ("grid","color") else []
    # List header detection: date + title + time column signals, no weekday guessed.
    header_words={"date":r"^(?:日期|星期|date|day)$","course":r"^(?:课程名称|课程名|course(?: name)?)$","time":r"^(?:上课时间|时间|time)$","weeks":r"^(?:开课周|周次|weeks?)$"}
    list_headers={}
    for i,l in enumerate(lines):
        for k,pat in header_words.items():
            if re.fullmatch(pat,l["text"].strip(),re.I):list_headers[k]={"lineId":i,"center":list(center(l))}
    if len(list_headers)>=3 and "course" in list_headers and "date" in list_headers and "time" in list_headers and max(x["center"][1] for x in list_headers.values())-min(x["center"][1] for x in list_headers.values())<max(8,h*.025) and layout=="unresolved":
        layout="list"
        # Row anchors from explicit time range fields; use center-distance grouping.
        tc=list_headers["time"]["center"];anchors=[]
        for i,l in enumerate(lines):
            x,y=center(l)
            if abs(x-tc[0])<w*.09 and y>tc[1] and re.search(r"\d{1,2}:\d{2}\s*[-–—~至]\s*\d{1,2}:\d{2}",l["text"]):anchors.append((i,y))
        anchors.sort(key=lambda a:a[1])
        for i,(idx,y) in enumerate(anchors):
            top=(anchors[i-1][1]+y)/2 if i else max(tc[1]+3,y-(anchors[i+1][1]-y)/2) if len(anchors)>1 else y-8
            bottom=(y+anchors[i+1][1])/2 if i+1<len(anchors) else min(h,y+(y-anchors[i-1][1])/2) if i else y+8
            rb=[0,int(top),w,int(bottom)]
            blocks.append({"bounds":rb,"day":None,"lineIds":[j for j,l in enumerate(lines) if center_in(l,rb)],"source":"list_row","quality":.65,"periods":[]})
    for i,b in enumerate(blocks):b["id"]="P"+str(i)
    assigned=set(i for b in blocks for i in b["lineIds"])
    return {"version":1,"kind":layout,"axis":axis,"regions":regions,"ticks":ticks,"blocks":blocks[:150],"listHeaders":list_headers,"unassignedLineIds":[i for i in range(len(lines)) if i not in assigned],"layoutMs":round((time.perf_counter()-started)*1000)}
