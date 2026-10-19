import jsQR from 'jsqr';

/** Decode the first QR code in an image (File, Blob or data URL). Returns null if none found. */
export async function decodeQrFromImage(source: Blob | string): Promise<string | null> {
  const blob = typeof source === 'string' ? await dataUrlToBlob(source) : source;
  const bitmap = await createImageBitmap(blob);
  try {
    // Try full size first, then downscaled: jsQR struggles with huge phone photos.
    for (const scale of [1, 0.5, 0.25]) {
      const result = decodeBitmap(bitmap, scale);
      if (result) return result;
    }
    return null;
  } finally {
    bitmap.close();
  }
}

function decodeBitmap(bitmap: ImageBitmap, scale: number): string | null {
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Canvas not available');
  ctx.drawImage(bitmap, 0, 0, w, h);
  const img = ctx.getImageData(0, 0, w, h);
  return jsQR(img.data, w, h, { inversionAttempts: 'attemptBoth' })?.data ?? null;
}

function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const [header, b64 = ''] = dataUrl.split(',');
  const mime = /data:([^;]+)/.exec(header ?? '')?.[1] ?? 'image/png';
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return Promise.resolve(new Blob([bytes], { type: mime }));
}
