"""Generated geometry regression: no real user images included."""
import cv2
import numpy as np
from ocr_lab.layout import build_layout
def line(s,x,y):
    return {"text":s,"score":.99,"box":[[x-8,y-4],[x+8,y-4],[x+8,y+4],[x-8,y+4]]}
def main():
    image=np.full((400,500,3),255,np.uint8)
    lines=[line(s,100+i*80,35) for i,s in enumerate(["周一","周二","周三","周四","周五"])]
    lines += [line(str(i+1),25,80+i*40) for i in range(6)]
    for i in range(3):
        x=70+i*80
        cv2.rectangle(image,(x,60),(x+60,135),(170,90,35),-1)
        lines.append(line("Math",x+30,90))
    result=build_layout(image,{"lines":lines,"grid":{"status":"unresolved","regions":[],"cells":[]}})
    assert result["kind"]=="cards", result
    assert len(result["blocks"])==3,result
    assert [b["day"] for b in result["blocks"]]==[1,2,3],result
    assert result["blocks"][0]["periods"]==[1,2],result
    print("Layout geometry smoke passed: 3 cards, correct weekday and span")
if __name__=="__main__":main()
