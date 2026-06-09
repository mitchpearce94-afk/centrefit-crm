/**
 * Local "Save As" helpers built on the File System Access API so the plan
 * builder can write the PDF / .cfq straight into a folder the user picks (e.g.
 * a OneDrive-synced folder on disk) instead of always dumping to Downloads.
 *
 * IMPORTANT: showSaveFilePicker must be called inside the user gesture (the
 * click), BEFORE any long await (PDF render / cloud upload). So the flow is:
 * pickSaveFile() first → do the work → writeToHandle(). Browsers that don't
 * support the API (Firefox/Safari) fall back to a normal download.
 */

interface WritableLike {
  write: (data: Blob) => Promise<void>;
  close: () => Promise<void>;
}
export interface SaveFileHandle {
  createWritable: () => Promise<WritableLike>;
}

export function supportsFilePicker(): boolean {
  return typeof window !== "undefined" && typeof (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker === "function";
}

/**
 * Open the native Save dialog and return a file handle. Returns "cancelled" if
 * the user dismissed it, or null if the picker failed / isn't supported (caller
 * should fall back to a download in that case).
 */
export async function pickSaveFile(
  suggestedName: string,
  description: string,
  mime: string,
  ext: string,
): Promise<SaveFileHandle | "cancelled" | null> {
  const picker = (window as unknown as {
    showSaveFilePicker?: (opts: unknown) => Promise<SaveFileHandle>;
  }).showSaveFilePicker;
  if (!picker) return null;
  try {
    return await picker({
      suggestedName,
      types: [{ description, accept: { [mime]: [ext] } }],
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") return "cancelled";
    return null;
  }
}

export async function writeToHandle(handle: SaveFileHandle, blob: Blob): Promise<void> {
  const writable = await handle.createWritable();
  await writable.write(blob);
  await writable.close();
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
