// Author: Preston Lee

export function downloadBlob(data: BlobPart, filename: string, mimeType: string): void {
  const blob = data instanceof Blob ? data : new Blob([data], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function downloadBytes(bytes: Uint8Array, filename: string, mimeType: string): void {
  // Copy into a standalone ArrayBuffer so BlobPart typing accepts it.
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  downloadBlob(copy, filename, mimeType);
}

export function downloadJson(value: unknown, filename: string): void {
  downloadBlob(JSON.stringify(value, null, 2), filename, 'application/json');
}
