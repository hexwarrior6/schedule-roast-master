import {describe,it,expect} from "vitest";
import sharp from "sharp";
import {tileBounds,prepareVisionImages} from "./vision";
describe("课表局部放大",()=>{
  it("四个重叠区域完整覆盖原图",()=>{
    const tiles=tileBounds(525,371);
    expect(tiles).toHaveLength(4);
    for(const t of tiles){expect(t.left+t.width).toBeLessThanOrEqual(525);expect(t.top+t.height).toBeLessThanOrEqual(371);}
    expect(tiles[0].width+tiles[1].width).toBeGreaterThan(525);
    expect(tiles[0].height+tiles[2].height).toBeGreaterThan(371);
  });
  it("生成原图和四张局部图",async()=>{
    const bytes=await sharp({create:{width:525,height:371,channels:3,background:"white"}}).png().toBuffer();
    const result=await prepareVisionImages(bytes);
    expect(result.width).toBe(525);
    expect(result.crops).toHaveLength(4);
    expect(result.crops.every(x=>x.url.startsWith("data:image/png;base64,"))).toBe(true);
  });
});
