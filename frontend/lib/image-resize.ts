/**
 * Client-side image shrink before upload (plan-phone-2026-10-14.md §5, kit §41.16):
 * proof photos taken on a phone camera can be several megapixels; shrinking to a
 * sane long-side size client-side keeps uploads fast on mobile data without a
 * server round trip. Non-image files (or anything that fails to decode) pass
 * through untouched — this never blocks an upload.
 */

const MAX_LONG_SIDE = 1600
const JPEG_QUALITY = 0.82

function isResizableImage(file: File): boolean {
  // SVG and GIF are left alone: SVG has no "pixels" to shrink, GIF would lose
  // animation if redrawn through a canvas.
  return file.type === 'image/jpeg' || file.type === 'image/png' || file.type === 'image/webp'
}

/**
 * Resizes an image file so its long side is at most `maxLongSide` px, re-encoding
 * as JPEG (except PNGs with no larger dimension stay PNG, to avoid losing
 * transparency unnecessarily on already-small images). Returns the original file
 * unchanged if it is not a resizable image type, is already small enough, or the
 * canvas path fails for any reason (private-mode canvas blocking, decode error).
 */
export async function shrinkImageForUpload(file: File, maxLongSide = MAX_LONG_SIDE): Promise<File> {
  if (!isResizableImage(file)) return file

  try {
    const bitmap = await createImageBitmap(file)
    const longSide = Math.max(bitmap.width, bitmap.height)
    if (longSide <= maxLongSide) {
      bitmap.close?.()
      return file
    }

    const scale = maxLongSide / longSide
    const width = Math.round(bitmap.width * scale)
    const height = Math.round(bitmap.height * scale)

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      bitmap.close?.()
      return file
    }
    ctx.drawImage(bitmap, 0, 0, width, height)
    bitmap.close?.()

    const outType = file.type === 'image/png' ? 'image/png' : 'image/jpeg'
    const blob: Blob | null = await new Promise((resolve) =>
      canvas.toBlob(resolve, outType, outType === 'image/jpeg' ? JPEG_QUALITY : undefined),
    )
    if (!blob) return file

    const newName = outType === 'image/jpeg' && !/\.jpe?g$/i.test(file.name)
      ? file.name.replace(/\.[^.]+$/, '') + '.jpg'
      : file.name

    return new File([blob], newName, { type: outType, lastModified: Date.now() })
  } catch {
    // Decode or canvas failure (unsupported format, blocked canvas in a
    // locked-down browser): upload the original rather than fail the attach.
    return file
  }
}
