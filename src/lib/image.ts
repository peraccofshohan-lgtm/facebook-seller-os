/**
 * image.ts — Downscale an image to a small data URL suitable for local storage.
 * Uses Canvas only; no upload, no network, no external service.
 */

export const MAX_IMAGE_EDGE = 320;
/** Business logos are printed, so they get a little more resolution than a product photo. */
export const MAX_LOGO_EDGE = 512;
/** Formats the browser is guaranteed to encode back to a data URL. */
export const ALLOWED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'] as const;
export const MAX_LOGO_BYTES = 4 * 1024 * 1024;

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

function readAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('ফাইল পড়া যায়নি'));
    reader.readAsText(file);
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


/**
 * Validate and downscale a business logo.
 *
 * SVG is passed through untouched (rasterising it would destroy the sharpness that makes
 * it useful on a printed invoice), everything else is decoded and re-encoded through a
 * canvas so an oversized photo cannot bloat the local database.
 */
export async function processLogoFile(file: File): Promise<string> {
  if (!(ALLOWED_IMAGE_TYPES as readonly string[]).includes(file.type)) {
    throw new Error('লোগো PNG, JPG, WebP বা SVG ফরম্যাটে দিন');
  }
  if (file.size > MAX_LOGO_BYTES) {
    throw new Error('লোগোটি ৪ মেগাবাইটের বেশি বড় — ছোট ফাইল ব্যবহার করুন');
  }

  if (file.type === 'image/svg+xml') {
    // FileReader rather than Blob.text(): it is supported everywhere the app runs.
    const text = await readAsText(file);
    if (text.length > 512 * 1024) throw new Error('SVG লোগোটি খুব বড়');
    // Reject anything that could execute: a logo is data, never markup with behaviour.
    const lowered = text.toLowerCase();
    if (lowered.includes('<script') || lowered.includes('onload=') || lowered.includes('onerror=')) {
      throw new Error('এই SVG ফাইলটি নিরাপদ নয় — অন্য লোগো ব্যবহার করুন');
    }
    return `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(text)))}`;
  }

  return resizeImageFile(file, MAX_LOGO_EDGE, 0.9);
}
