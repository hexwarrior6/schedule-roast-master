import cv2
import numpy as np
from ocr_lab.topology import local_topology,smoke
def line(s,x,y):return {"text":s,"score":.99,"box":[[x-5,y-4],[x+5,y-4],[x+5,y+4],[x-5,y+4]]}
def main():
    im=np.full((300,400,3),255,np.uint8)
    for x in (40,150,260,370):cv2.line(im,(x,30),(x,270),(0,0,0),2)
    for y in (30,90,150,210,270):
        cv2.line(im,(150 if y==90 else 40,y),(370,y),(0,0,0),2)
    lines=[line(str(i+1),20,60+60*i) for i in range(4)]+[line("Math",90,60),line("Room",90,120)]
    regions=[{"day":i+1,"bounds":[40+i*110,30,150+i*110,270],"reliable":True} for i in range(3)]
    o={"lines":lines,"grid":{"status":"mapped"}}
    l={"regions":regions,"axis":{"orientation":"columns"}}
    r=local_topology(im,o,l)
    assert any(c["day"]==1 and c["periods"]==[1,2] and c["lineIds"]==[4,5] for c in r["cells"]),r
    assert len(r["ticks"])==4,r
    report=smoke();print(report);assert report["ok"],report
if __name__=="__main__":main()
