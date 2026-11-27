export const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
export const IMAGE_TYPES = ["image/jpeg","image/png","image/webp"] as const;

export function detectedImageType(bytes: Uint8Array): string | null {
  if (bytes.length < 12) return null;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if ([137,80,78,71,13,10,26,10].every((x,i)=>bytes[i]===x)) return "image/png";
  if (String.fromCharCode(...bytes.slice(0,4)) === "RIFF" &&
      String.fromCharCode(...bytes.slice(8,12)) === "WEBP") return "image/webp";
  return null;
}

export async function prepareImage(file: File): Promise<File> {
  if (!(IMAGE_TYPES as readonly string[]).includes(file.type)) {
    throw new Error("请选择 JPG、PNG 或 WebP 图片。");
  }
  if (!file.size) throw new Error("图片为空，请重新选择。");
  if (file.size <= MAX_IMAGE_BYTES) return file;
  if (file.size > 25 * 1024 * 1024) throw new Error("图片超过 25 MB，请先缩小后再上传。");
  const image = await createImageBitmap(file);
  try {
    const canvas = document.createElement("canvas");
    const scale = Math.min(1, 2600 / Math.max(image.width,image.height));
    canvas.width = Math.max(1,Math.round(image.width*scale));
    canvas.height = Math.max(1,Math.round(image.height*scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("浏览器不支持图片压缩。");
    context.fillStyle = "#ffffff";
    context.fillRect(0,0,canvas.width,canvas.height);
    context.drawImage(image,0,0,canvas.width,canvas.height);
    for (const quality of [0.92,0.85,0.75,0.65]) {
      const blob = await new Promise<Blob|null>(resolve=>canvas.toBlob(resolve,"image/jpeg",quality));
      if (blob && blob.size <= MAX_IMAGE_BYTES) return new File([blob],"schedule.jpg",{type:"image/jpeg"});
    }
    throw new Error("图片过大，请手动裁剪至课表区域。");
  } finally { image.close(); }
}
