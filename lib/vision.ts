import sharp from "sharp";

export function tileBounds(width:number,height:number){
  const w=Math.min(width,Math.ceil(width*0.6)),h=Math.min(height,Math.ceil(height*0.6));
  return [
    {left:0,top:0,width:w,height:h},
    {left:width-w,top:0,width:w,height:h},
    {left:0,top:height-h,width:w,height:h},
    {left:width-w,top:height-h,width:w,height:h},
  ];
}
export async function prepareVisionImages(bytes:Uint8Array){
  // Limit decoded size and normalize orientation before deriving coordinates.
  const source=sharp(Buffer.from(bytes),{limitInputPixels:25_000_000}).rotate().flatten({background:"#ffffff"});
  const {data,info}=await source.resize({width:2600,height:2600,fit:"inside",withoutEnlargement:true}).png().toBuffer({resolveWithObject:true});
  const {width,height}=info;
  const labels=["左上","右上","左下","右下"];
  const crops=await Promise.all(tileBounds(width,height).map(async (bounds,i)=>{
    const tile=await sharp(data).extract(bounds).resize({width:1200,height:1200,fit:"inside"}).sharpen({sigma:0.6}).png().toBuffer();
    return {label:labels[i],url:"data:image/png;base64,"+tile.toString("base64")};
  }));
  const footerHeight=Math.max(1,Math.ceil(height*0.18));
  const footer=await sharp(data).extract({left:0,top:height-footerHeight,width,height:footerHeight}).resize({width:2000,height:1000,fit:"inside"}).sharpen({sigma:0.6}).png().toBuffer();
  return {width,height,crops,footer:"data:image/png;base64,"+footer.toString("base64"),full:"data:image/png;base64,"+data.toString("base64")};
}
