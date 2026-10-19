import jsQR from 'jsqr';

// Chrome's native Shape Detection API (macOS Vision / ChromeOS / Android). Not in TS's DOM lib yet.
interface BarcodeDetectorLike {
  detect(image: ImageBitmapSource): Promise<{ rawValue: string }[]>;
}
declare const BarcodeDetector:
  | {
      new (options: { formats: string[] }): BarcodeDetectorLike;
      getSupportedFormats(): Promise<string[]>;
    }
  | undefined;

async function detectNative(bitmap: ImageBitmap): Promise<string | null> {
  if (typeof BarcodeDetector === 'undefined') return null;
  try {
    if (!(await BarcodeDetector.getSupportedFormats()).includes('qr_code')) return null;
    const found = await new BarcodeDetector({ formats: ['qr_code'] }).detect(bitmap);
    return found[0]?.rawValue ?? null;
  } catch {
    return null;
  }
}

/** Decode the first QR code in an image (File, Blob or data URL). Returns null if none found. */
export async function decodeQrFromImage(source: Blob | string): Promise<string | null> {
  const blob = typeof source === 'string' ? await dataUrlToBlob(source) : source;
  const bitmap = await createImageBitmap(blob);
  try {
    // The native detector handles dense Authenticator export QRs that jsQR often can't.
    const native = await detectNative(bitmap);
    if (native) return native;
    // Fallback: jsQR at full size, then downscaled (it struggles with huge phone photos).
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
