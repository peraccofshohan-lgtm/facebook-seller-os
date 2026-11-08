/**
 * image.ts — Downscale an image to a small data URL suitable for local storage.
 * Uses Canvas only; no upload, no network, no external service.
 */

export const MAX_IMAGE_EDGE = 320;

export async function resizeImageFile(file: File, maxEdge = MAX_IMAGE_EDGE, quality = 0.82): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('শুধু ছবির ফাইল নির্বাচন করুন');
  if (file.size > 8 * 1024 * 1024) throw new Error('ছবিটি ৮ মেগাবাইটের বেশি বড় — ছোট ছবি ব্যবহার করুন');

  const dataUrl = await readAsDataUrl(file);
  const image = await loadImage(dataUrl);
  const scale = Math.min(1, maxEdge / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('ছবি প্রক্রিয়া করা যায়নি');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);
  return canvas.toDataURL('image/jpeg', quality);
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('ফাইল পড়া যায়নি'));
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('ছবি খোলা যায়নি'));
    image.src = src;
  });
}
