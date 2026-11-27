"""Experimental OCR; no uploads persisted, no generative model."""
import io
import math
import re
import threading
import time
import unicodedata
from functools import lru_cache
import cv2
import numpy as np
from PIL import Image, ImageOps

MAX_PIXELS = 12_000_000
LOCK = threading.Lock()
DAYS = {"mon":1,"monday":1,"tue":2,"tues":2,"tuesday":2,"wed":3,"wednesday":3,"thu":4,"thur":4,"thurs":4,"thursday":4,"fri":5,"friday":5,"sat":6,"saturday":6,"sun":7,"sunday":7}

def day_label(value):
    s = re.sub(r"\s+", "", unicodedata.normalize("NFKC", value)).lower().rstrip(".")
    if s in DAYS:
        return DAYS[s]
    m = re.fullmatch(r"(?:星期|周|礼拜)([一二三四五六日天1-7])", s)
    if m:
        c = m[1]
        return int(c) if c.isdigit() else min(7, "一二三四五六日天".index(c) + 1)
    return None

def decode(data):
    with Image.open(io.BytesIO(data)) as im:
        if im.format not in ("PNG", "JPEG", "WEBP") or im.width * im.height > MAX_PIXELS:
            raise ValueError("Unsupported or oversized image")
        im = ImageOps.exif_transpose(im).convert("RGB")
        # Keep original resolution on ordinary screenshots.
        im.thumbnail((2600,2600))
        return cv2.cvtColor(np.asarray(im), cv2.COLOR_RGB2BGR)

@lru_cache(maxsize=1)
def get_engine():
    from rapidocr import RapidOCR
    return RapidOCR()

def axis_lines(gray, vertical):
    """Long straight dark lines only. Return candidate boundary centers."""
    h,w = gray.shape
    binary = cv2.adaptiveThreshold(gray,255,cv2.ADAPTIVE_THRESH_MEAN_C,cv2.THRESH_BINARY_INV,31,12)
    k = (1,max(12,h//4)) if vertical else (max(12,w//4),1)
    mask = cv2.morphologyEx(binary,cv2.MORPH_OPEN,cv2.getStructuringElement(cv2.MORPH_RECT,k))
    counts = (mask>0).sum(axis=0 if vertical else 1)
    indices = np.flatnonzero(counts >= (h if vertical else w)*0.40)
    clusters=[]
    for n in indices:
        if not clusters or n-clusters[-1][-1]>3: clusters.append([int(n)])
        else: clusters[-1].append(int(n))
    return [round(sum(c)/len(c)) for c in clusters]

def center(line):
    b=line["box"]
    return sum(p[0] for p in b)/4,sum(p[1] for p in b)/4

def interval(edges, pos):
    return next(((a,b) for a,b in zip(edges,edges[1:]) if a<pos<b),None)

def map_grid(image, lines):
    """Map OCR lines by labelled header and observed grid boundaries.
    Fail closed if layout is ambiguous, including unruled or merged weekday axes.
    Does not infer a course or a week from an OCR line.
    """
    h,w=image.shape[:2]
    gray=cv2.cvtColor(image,cv2.COLOR_BGR2GRAY)
    xs,ys=axis_lines(gray,True),axis_lines(gray,False)
    candidates=[(day_label(l["text"]),*center(l)) for l in lines if l["score"]>=0.65 and day_label(l["text"]) is not None]
    layouts=[]
    for transposed in (False,True):
        ae,be=(ys,xs) if transposed else (xs,ys)
        if len(ae)<4 or len(be)<3: continue
        groups={}
        for day,x,y in candidates:
            a,b=(y,x) if transposed else (x,y)
            ar,br=interval(ae,a),interval(be,b)
            if ar and br: groups.setdefault(br,[]).append((day,ar))
        for header,items in groups.items():
            if len(items)<3 or len({d for d,_ in items})!=len(items) or len({r for _,r in items})!=len(items): continue
            # Require adjacent weekday-axis regions, actual labels (not assumed order).
            regions=sorted(items,key=lambda item:item[1][0])
            if any(a[1][1]!=b[1][0] for a,b in zip(regions,regions[1:])):continue
            layouts.append((len(items),transposed,header,regions,be))
    layouts.sort(key=lambda x:x[0],reverse=True)
    if not layouts or (len(layouts)>1 and layouts[0][0]==layouts[1][0]):
        return {"status":"unresolved","reason":"No unique labelled grid; inspect OCR boxes.","regions":[],"cells":[]}
    _,transposed,header,regions,be=layouts[0]
    if header[1]>=be[-1]:return {"status":"unresolved","reason":"No body below header","regions":[],"cells":[]}
    region_rows=[]
    cells=[]
    for day,(a0,a1) in regions:
        # The header's following boundary is the start of the body.
        region_rows.append({"day":day,"bounds":[header[1],a0,be[-1],a1] if transposed else [a0,header[1],a1,be[-1]]})
        for b0,b1 in zip(be,be[1:]):
            if b0<header[1]:continue
            bounds=[b0,a0,b1,a1] if transposed else [a0,b0,a1,b1]
            selected=[]
            for i,line in enumerate(lines):
                box=line["box"]
                # A line must lie almost entirely within the cell: never duplicate across cells.
                if all(bounds[0]-2<=x<=bounds[2]+2 and bounds[1]-2<=y<=bounds[3]+2 for x,y in box):
                    x,y=center(line)
                    if bounds[0]<x<bounds[2] and bounds[1]<y<bounds[3]:selected.append(i)
            selected.sort(key=lambda i:(center(lines[i])[1],center(lines[i])[0]))
            if selected:
                cells.append({"day":day,"bounds":bounds,"lineIds":selected,"text":"\n".join(lines[i]["text"] for i in selected)})
    used={i for c in cells for i in c["lineIds"]}
    return {"status":"mapped","orientation":"weekdays_in_rows" if transposed else "weekdays_in_columns","regions":region_rows,"cells":cells,"unassignedLineIds":[i for i in range(len(lines)) if i not in used]}

def recognize(image):
    start=time.perf_counter()
    with LOCK:
        warm=get_engine.cache_info().currsize>0
        engine=get_engine()
        loaded=time.perf_counter()
        result=engine(image)
    inferred=time.perf_counter()
    lines=[]
    if result.boxes is not None and result.txts is not None and result.scores is not None:
        for box,txt,score in zip(result.boxes,result.txts,result.scores):
            points=[[round(float(x),1),round(float(y),1)] for x,y in box]
            if len(points)!=4 or not math.isfinite(float(score)):continue
            lines.append({"text":str(txt),"score":round(float(score),4),"box":points})
    grid=map_grid(image,lines)
    return {"engine":"RapidOCR 3.10.0 / ONNX Runtime CPU","width":image.shape[1],"height":image.shape[0],"warm":warm,
            "loadMs":round((loaded-start)*1000),"ocrMs":round((inferred-loaded)*1000),"totalMs":round((time.perf_counter()-start)*1000),"lines":lines,"grid":grid}

def synthetic(transposed=False):
    # Generated test, not a user screenshot. Includes a legitimate repeated course.
    labels=["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"]
    im=np.full((440,1500,3),255,np.uint8)
    for i in range(8):cv2.line(im,(40+i*200,30),(40+i*200,410),(0,0,0),2)
    for y in (30,90,195,300,410):cv2.line(im,(40,y),(1440,y),(0,0,0),2)
    for i,label in enumerate(labels):cv2.putText(im,label,(47+i*200,65),cv2.FONT_HERSHEY_SIMPLEX,0.63,(0,0,0),1,cv2.LINE_AA)
    for i,y,label in [(0,145,"Math 1-2"),(2,145,"Math 1-2"),(4,250,"Physics"),(6,365,"Project")]:
        cv2.putText(im,label,(50+i*200,y),cv2.FONT_HERSHEY_SIMPLEX,0.72,(0,0,0),2,cv2.LINE_AA)
    return im

def smoke():
    report=recognize(synthetic())
    observed=[(c["day"],re.sub(r"\s+","",c["text"]).lower()) for c in report["grid"]["cells"]]
    expected=[(1,"math1-2"),(3,"math1-2"),(5,"physics"),(7,"project")]
    matched=sum(item in observed for item in expected)
    return {"ok":matched==len(expected) and len(observed)==len(expected),"expected":expected,"observed":observed,"matched":matched,
            "expectedCount":len(expected),"observedCount":len(observed),"loadMs":report["loadMs"],"ocrMs":report["ocrMs"],
            "totalMs":report["totalMs"],"warm":report["warm"],"grid":report["grid"]["status"],"engine":report["engine"]}


def refine_regions(image, regions):
    """Re-run OCR on at most four selected cells, using normalized image coordinates."""
    if not isinstance(regions,list) or not 1<=len(regions)<=4:
        raise ValueError("Invalid region count")
    h,w=image.shape[:2]
    started=time.perf_counter()
    out=[]
    for region in regions:
        ident=region["id"]
        if not isinstance(ident,str) or not re.fullmatch(r"C\d{1,3}",ident):
            raise ValueError("Invalid cell id")
        rect=region["bounds"]
        if not isinstance(rect,list) or len(rect)!=4 or not all(isinstance(v,(int,float)) and math.isfinite(v) for v in rect):
            raise ValueError("Invalid bounds")
        x,y,r,b=map(round,rect)
        if not (0<=x<r<=w and 0<=y<b<=h and r-x>=8 and b-y>=8):
            raise ValueError("Out-of-bounds crop")
        crop=image[y:b,x:r].copy()
        # Upscale small text, preserving aspect ratio; no interpolation across cells.
        scale=min(2.0,1600/max(crop.shape[:2]))
        if scale>1:crop=cv2.resize(crop,None,fx=scale,fy=scale,interpolation=cv2.INTER_CUBIC)
        with LOCK: result=get_engine()(crop)
        text=""
        if result.boxes is not None and result.txts is not None:
            ordered=sorted(zip(result.boxes,result.txts),key=lambda p:(float(np.asarray(p[0])[:,1].mean()),float(np.asarray(p[0])[:,0].mean())))
            text="\n".join(str(t) for _,t in ordered)[:16000]
        out.append({"id":ident,"text":text})
    return {"cells":out,"totalMs":round((time.perf_counter()-started)*1000)}
