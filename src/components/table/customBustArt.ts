/** The measured library subject height used by scripts/measure-bust-art.py. */
const BUST_SUBJECT_SHARE = 0.888;

/** Generated transparent characters use the same bust treatment as the library.
 * Uploaded photographs and monograms keep their existing treatment. */
export function isGeneratedBustUrl(url: string): boolean {
  try {
    return /^\/storage\/v1\/(?:object|render\/image)\/public\/custom-avatars\/generated\/[^/]+\.png$/.test(
      new URL(url).pathname
    );
  } catch {
    return false;
  }
}

/** A contain-fitted square uses the larger canvas axis, not always its height.
 * Normalize the visible subject, including a landscape generated canvas. */
export function containedBustGain(
  width: number,
  height: number,
  top: number,
  bottom: number
): number {
  const subject = bottom - top;
  if (!(width > 0 && height > 0 && top >= 0 && bottom <= height && subject > 0)) return 1;
  return (BUST_SUBJECT_SHARE * Math.max(width, height)) / subject;
}

/** Called once when an approved public generated image loads. A failed pixel
 * read or an opaque image keeps the existing photograph rendering. */
export function measureGeneratedBust(image: HTMLImageElement): number | null | undefined {
  if (!(image.naturalWidth > 0 && image.naturalHeight > 0)) return undefined;
  const ratio = Math.min(1, 256 / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.naturalWidth * ratio));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * ratio));
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return undefined;
  try {
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let top = canvas.height;
    let bottom = 0;
    let transparent = false;
    for (let y = 0; y < canvas.height; y++) {
      for (let x = 0; x < canvas.width; x++) {
        const alpha = pixels[(y * canvas.width + x) * 4 + 3];
        if (alpha < 255) transparent = true;
        if (alpha > 0) {
          top = Math.min(top, y);
          bottom = Math.max(bottom, y + 1);
        }
      }
    }
    return transparent && bottom > top
      ? containedBustGain(canvas.width, canvas.height, top, bottom)
      : null;
  } catch {
    // A tainted or unsupported canvas must never hide the player's avatar.
    return undefined;
  }
}

// Bounded, image-URL-owned measurements survive table changes without another
// canvas read. A new avatar URL cannot inherit an old character's correction.
export const generatedBustMeasurements = new Map<string, number | null>();
export function rememberGeneratedBust(url: string, gain: number | null): void {
  if (generatedBustMeasurements.size >= 256 && !generatedBustMeasurements.has(url)) {
    const oldest = generatedBustMeasurements.keys().next().value;
    if (oldest) generatedBustMeasurements.delete(oldest);
  }
  generatedBustMeasurements.set(url, gain);
}
