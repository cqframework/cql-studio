// Author: Preston Lee

import { Injectable } from '@angular/core';
import { gunzipSync } from 'fflate';

function decodeLatin1(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) {
    s += String.fromCharCode(bytes[i]);
  }
  return s;
}

/**
 * Minimal ustar/GNU tar reader for FHIR NPM .tgz (paths usually under `package/`).
 */
@Injectable({
  providedIn: 'root'
})
export class FhirPackageTarService {
  extractTarGz(tgzBytes: ArrayBuffer): Map<string, Uint8Array> {
    const gz = new Uint8Array(tgzBytes);
    let tar: Uint8Array;
    try {
      tar = gunzipSync(gz);
    } catch {
      throw new Error('Failed to decompress package (gzip).');
    }
    return this.extractTar(tar);
  }

  /**
   * Extract only listed paths (e.g. `package/package.json`). Stops scanning the tar once all are found.
   */
  extractTarGzPaths(tgzBytes: ArrayBuffer, wantedPaths: Set<string>): Map<string, Uint8Array> {
    const gz = new Uint8Array(tgzBytes);
    let tar: Uint8Array;
    try {
      tar = gunzipSync(gz);
    } catch {
      throw new Error('Failed to decompress package (gzip).');
    }
    return this.extractTarSubset(tar, wantedPaths);
  }

  private extractTar(input: Uint8Array): Map<string, Uint8Array> {
    const files = new Map<string, Uint8Array>();
    let offset = 0;
    let pendingLongName: string | null = null;

    while (offset + 512 <= input.length) {
      const header = input.subarray(offset, offset + 512);
      if (header.every((b) => b === 0)) {
        break;
      }

      const nameField = this.readCString(header.subarray(0, 100));
      const ustarMagic = decodeLatin1(header.subarray(257, 263));
      const isUstar = ustarMagic === 'ustar\0';

      let pathPrefix = '';
      if (isUstar) {
        pathPrefix = this.readCString(header.subarray(345, 500));
      }

      const sizeOctal = this.readCString(header.subarray(124, 136)).trim();
      const size = parseInt(sizeOctal, 8);
      if (Number.isNaN(size) || size < 0) {
        throw new Error('Invalid tar header (file size).');
      }

      const typeflag = header[156];
      offset += 512;

      const contentEnd = offset + size;
      const content = input.subarray(offset, Math.min(contentEnd, input.length));
      offset += Math.ceil(size / 512) * 512;

      // GNU long name block
      if (typeflag === 76) {
        const longName = decodeLatin1(content).replace(/\0/g, '').trim();
        pendingLongName = longName;
        continue;
      }

      // Directory entries
      if (typeflag === 53 || typeflag === 49) {
        // '5' directory, '1' hard link — skip data
        pendingLongName = null;
        continue;
      }

      // PAX extended header — skip payload
      if (typeflag === 120 || typeflag === 103) {
        pendingLongName = null;
        continue;
      }

      let relPath = pendingLongName;
      pendingLongName = null;
      if (!relPath) {
        const baseName = nameField;
        relPath = pathPrefix ? `${pathPrefix}/${baseName}` : baseName;
      }

      relPath = relPath.replace(/^\.\//, '').replace(/^\/+/, '');
      if (!relPath || relPath.endsWith('/')) {
        continue;
      }

      // Regular file (0, NUL, or '0')
      if (typeflag === 0 || typeflag === 48) {
        files.set(relPath, new Uint8Array(content));
      }
    }

    return files;
  }

  private extractTarSubset(input: Uint8Array, wantedPaths: Set<string>): Map<string, Uint8Array> {
    const files = new Map<string, Uint8Array>();
    const pending = new Set(wantedPaths);
    let offset = 0;
    let pendingLongName: string | null = null;

    while (offset + 512 <= input.length && pending.size > 0) {
      const header = input.subarray(offset, offset + 512);
      if (header.every((b) => b === 0)) {
        break;
      }

      const nameField = this.readCString(header.subarray(0, 100));
      const ustarMagic = decodeLatin1(header.subarray(257, 263));
      const isUstar = ustarMagic === 'ustar\0';

      let pathPrefix = '';
      if (isUstar) {
        pathPrefix = this.readCString(header.subarray(345, 500));
      }

      const sizeOctal = this.readCString(header.subarray(124, 136)).trim();
      const size = parseInt(sizeOctal, 8);
      if (Number.isNaN(size) || size < 0) {
        throw new Error('Invalid tar header (file size).');
      }

      const typeflag = header[156];
      offset += 512;

      const contentEnd = offset + size;
      const content = input.subarray(offset, Math.min(contentEnd, input.length));
      offset += Math.ceil(size / 512) * 512;

      if (typeflag === 76) {
        const longName = decodeLatin1(content).replace(/\0/g, '').trim();
        pendingLongName = longName;
        continue;
      }

      if (typeflag === 53 || typeflag === 49) {
        pendingLongName = null;
        continue;
      }

      if (typeflag === 120 || typeflag === 103) {
        pendingLongName = null;
        continue;
      }

      let relPath = pendingLongName;
      pendingLongName = null;
      if (!relPath) {
        const baseName = nameField;
        relPath = pathPrefix ? `${pathPrefix}/${baseName}` : baseName;
      }

      relPath = relPath.replace(/^\.\//, '').replace(/^\/+/, '');
      if (!relPath || relPath.endsWith('/')) {
        continue;
      }

      if (typeflag === 0 || typeflag === 48) {
        if (pending.has(relPath)) {
          files.set(relPath, new Uint8Array(content));
          pending.delete(relPath);
        }
      }
    }

    return files;
  }

  private readCString(bytes: Uint8Array): string {
    const end = bytes.indexOf(0);
    const slice = end >= 0 ? bytes.subarray(0, end) : bytes;
    return decodeLatin1(slice);
  }
}
