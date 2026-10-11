import type { PreparedMedia } from '@/lib/selling/types';

// Getting photos and video ready to upload, in the browser.
// Photos are redrawn at most 2000 px on the long side as JPEG: smaller uploads on phone data, and redrawing
// drops the file's hidden details (EXIF), including the GPS location phones record. Video is uploaded as-is.
// Each file gets a SHA-256 fingerprint, stored with it, so later evidence can be matched to the original.

export const MAX_PHOTO_EDGE = 2000;
export const MAX_VIDEO_BYTES = 50 * 1024 * 1024;
export const MAX_VIDEO_SECONDS = 31;

/** Scales a size down so its long side is at most `max`, keeping the shape. Never scales up. */
export function fitWithin(width: number, height: number, max = MAX_PHOTO_EDGE): { width: number; height: number } {
  const long = Math.max(width, height);
  if (long <= max) return { width, height };
  const k = max / long;
  return { width: Math.round(width * k), height: Math.round(height * k) };
}

export function videoExtension(type: string): string | null {
  return ({ 'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm' } as Record<string, string>)[type] ?? null;
}

export async function sha256Hex(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

export class MediaProblem extends Error {}

export async function preparePhoto(file: File): Promise<PreparedMedia> {
  if (!file.type.startsWith('image/')) throw new MediaProblem('That isn’t a photo. Choose a picture.');
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new MediaProblem('We couldn’t open that photo. Try taking it again, or choose a JPEG or PNG.');
  }
  const { width, height } = fitWithin(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new MediaProblem('This browser can’t prepare photos. Try another browser.');
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
  if (!blob) throw new MediaProblem('We couldn’t prepare that photo. Try again.');
  return { blob, kind: 'photo', contentType: 'image/jpeg', extension: 'jpg', width, height, sha256: await sha256Hex(blob) };
}

function videoInfo(file: File): Promise<{ seconds: number; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const v = document.createElement('video');
    const url = URL.createObjectURL(file);
    v.preload = 'metadata';
    v.muted = true;
    v.onloadedmetadata = () => {
      resolve({ seconds: v.duration, width: v.videoWidth, height: v.videoHeight });
      URL.revokeObjectURL(url);
    };
    v.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new MediaProblem('We couldn’t open that video. Record it again, or use MP4 or MOV.'));
    };
    v.src = url;
  });
}

export async function prepareVideo(file: File): Promise<PreparedMedia> {
  const ext = videoExtension(file.type);
  if (!ext) throw new MediaProblem('Use a video in MP4, MOV or WebM format.');
  if (file.size > MAX_VIDEO_BYTES) throw new MediaProblem('That video is over 50 MB. Record up to 30 seconds.');
  const info = await videoInfo(file);
  if (Number.isFinite(info.seconds) && info.seconds > MAX_VIDEO_SECONDS) {
    throw new MediaProblem(`That video is ${Math.round(info.seconds)} seconds. Keep it to 30 seconds or less.`);
  }
  return {
    blob: file, kind: 'video', contentType: file.type, extension: ext,
    width: info.width || null, height: info.height || null, sha256: await sha256Hex(file),
  };
}
