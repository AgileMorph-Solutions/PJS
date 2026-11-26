/**
 * A phone photo of a fiche is often 3–8 MB and 4000 px across: more than the reader takes (5 MB) and slow to send from a
 * warehouse connection. Shrunk here, in the browser, to a size where the handwriting is still clear. A PDF scan is sent as
 * it is.
 */
const LONG_EDGE = 2400;
const SMALL_ENOUGH = 1.5 * 1024 * 1024;

export async function shrinkPhoto(file: File): Promise<{ blob: Blob; name: string }> {
  if (!file.type.startsWith("image/")) return { blob: file, name: file.name };
  // "from-image" applies the photo's own rotation, so a fiche shot in portrait isn't stored on its side.
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const scale = Math.min(1, LONG_EDGE / Math.max(bitmap.width, bitmap.height));
  if (scale === 1 && file.size <= SMALL_ENOUGH) { bitmap.close(); return { blob: file, name: file.name }; }
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.88));
  if (!blob) return { blob: file, name: file.name };
  return { blob, name: file.name.replace(/\.[^.]+$/, "") + ".jpg" };
}
