/**
 * Client-side image resize + JPEG re-encode for upload.
 *
 * iPhone/Android camera shots routinely land at 4-6 MB and 4000+ px.
 * Uploading 50-100 of those is multi-minute and lags every grid render.
 * Compressing to ~1920px @ JPEG 0.82 typically drops a 5 MB photo to
 * 200-500 KB with no perceptible quality loss for site documentation.
 *
 * Falls through (returns the original) for non-images, GIFs (preserve
 * animation), or formats the browser can't decode (e.g. HEIC on some
 * browsers — iOS Safari converts on its own when sourced from the
 * picker).
 */
export async function compressImage(
  file: File,
  opts?: { maxDim?: number; quality?: number },
): Promise<File> {
  if (!file.type.startsWith("image/")) return file;
  if (file.type === "image/gif") return file;

  const maxDim = opts?.maxDim ?? 1920;
  const quality = opts?.quality ?? 0.82;

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return file;
  }

  const { width, height } = bitmap;
  const scale = Math.min(1, maxDim / Math.max(width, height));
  const targetW = Math.round(width * scale);
  const targetH = Math.round(height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close?.();
    return file;
  }
  ctx.drawImage(bitmap, 0, 0, targetW, targetH);
  bitmap.close?.();

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", quality),
  );
  if (!blob) return file;

  if (blob.size >= file.size && file.type === "image/jpeg") {
    return file;
  }

  const newName = file.name.replace(/\.[^.]+$/, "") + ".jpg";
  return new File([blob], newName, {
    type: "image/jpeg",
    lastModified: Date.now(),
  });
}

/**
 * Upload an array of files in small concurrent batches. Sequential
 * `await` in a for-loop sends one file at a time which kills total
 * throughput on a phone with decent uplink. Going fully parallel can
 * starve the connection and stall TCP — 4 in flight is the sweet spot.
 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}
