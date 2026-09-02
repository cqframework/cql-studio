// Author: Preston Lee

import { Injectable } from '@angular/core';
import { gzipSync, zipSync } from 'fflate';
import { Resource } from 'fhir/r4';
import {
  FhirPackageJson,
  FhirPackageIndexJson
} from '../models/fhir-package-registry.types';
import {
  buildFhirPackageIndexJson,
  fhirPackageResourceFilename
} from './fhir-package-manifest.lib';

function encodeUtf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function toOctal(value: number, length: number): string {
  const s = value.toString(8);
  return s.padStart(length, '0');
}

/**
 * Creates FHIR NPM `.tgz` (ustar + gzip) and raw `.zip` archives for export.
 */
@Injectable({
  providedIn: 'root'
})
export class FhirPackageArchiveService {
  createZip(files: Record<string, string | Uint8Array>): Uint8Array {
    const entries: Record<string, Uint8Array> = {};
    for (const [path, content] of Object.entries(files)) {
      entries[path] = typeof content === 'string' ? encodeUtf8(content) : content;
    }
    return zipSync(entries, { level: 6 });
  }

  /**
   * Build a FHIR NPM package tarball: `package/package.json`, resources, `.index.json`.
   */
  createFhirPackageTgz(
    packageJson: FhirPackageJson,
    resources: Resource[]
  ): { tgz: Uint8Array; filenames: string[]; index: FhirPackageIndexJson } {
    const usedNames = new Set<string>();
    const fileEntries: Array<{ filename: string; resource: Resource }> = [];
    const tarFiles = new Map<string, Uint8Array>();

    tarFiles.set(
      'package/package.json',
      encodeUtf8(JSON.stringify(packageJson, null, 2))
    );

    resources.forEach((resource, index) => {
      let filename = fhirPackageResourceFilename(resource, index);
      if (usedNames.has(filename)) {
        const rt = resource.resourceType || 'Resource';
        filename = `${rt}-${index}.json`;
      }
      usedNames.add(filename);
      fileEntries.push({ filename, resource });
      tarFiles.set(
        `package/${filename}`,
        encodeUtf8(JSON.stringify(resource, null, 2))
      );
    });

    const index = buildFhirPackageIndexJson(fileEntries);
    tarFiles.set('package/.index.json', encodeUtf8(JSON.stringify(index, null, 2)));

    const tar = this.buildUstarTar(tarFiles);
    const tgz = gzipSync(tar, { level: 6 });
    return {
      tgz,
      filenames: fileEntries.map((f) => f.filename),
      index
    };
  }

  private buildUstarTar(files: Map<string, Uint8Array>): Uint8Array {
    const chunks: Uint8Array[] = [];
    for (const [path, content] of files) {
      const normalized = path.replace(/^\/+/, '');
      chunks.push(...this.tarFileChunks(normalized, content));
    }
    // Two empty 512-byte blocks end the archive
    chunks.push(new Uint8Array(1024));
    const total = chunks.reduce((n, c) => n + c.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      out.set(chunk, offset);
      offset += chunk.length;
    }
    return out;
  }

  private tarFileChunks(path: string, content: Uint8Array): Uint8Array[] {
    const chunks: Uint8Array[] = [];
    let name = path;
    const prefix = '';

    // GNU long name when path exceeds ustar name field (100 bytes)
    if (path.length > 100) {
      const longNameBytes = encodeUtf8(path + '\0');
      chunks.push(this.tarHeader('././@LongLink', longNameBytes.length, 76));
      chunks.push(this.padToBlock(longNameBytes));
      name = path.slice(0, 100);
    }

    chunks.push(this.tarHeader(name, content.length, 48, prefix));
    chunks.push(this.padToBlock(content));
    return chunks;
  }

  private tarHeader(
    name: string,
    size: number,
    typeflag: number,
    prefix = ''
  ): Uint8Array {
    const header = new Uint8Array(512);
    const write = (offset: number, max: number, text: string) => {
      const bytes = encodeUtf8(text);
      header.set(bytes.subarray(0, Math.min(bytes.length, max)), offset);
    };

    write(0, 100, name);
    write(100, 8, toOctal(0o644, 7) + '\0');
    write(108, 8, toOctal(0, 7) + '\0');
    write(116, 8, toOctal(0, 7) + '\0');
    write(124, 12, toOctal(size, 11) + '\0');
    write(136, 12, toOctal(Math.floor(Date.now() / 1000), 11) + '\0');
    // checksum placeholder spaces
    for (let i = 148; i < 156; i++) {
      header[i] = 0x20;
    }
    header[156] = typeflag;
    write(257, 6, 'ustar\0');
    write(263, 2, '00');
    if (prefix) {
      write(345, 155, prefix);
    }

    let checksum = 0;
    for (let i = 0; i < 512; i++) {
      checksum += header[i];
    }
    write(148, 8, toOctal(checksum, 6) + '\0 ');

    return header;
  }

  private padToBlock(data: Uint8Array): Uint8Array {
    // A zero-length member must contribute zero padding bytes; forcing a full 512-byte block here
    // for empty files corrupts the archive (readers see a 0-byte header followed by unexpected
    // "data", which throws off every subsequent entry's offset).
    if (data.length === 0) {
      return data;
    }
    const size = Math.ceil(data.length / 512) * 512;
    if (data.length === size) {
      return data;
    }
    const out = new Uint8Array(size);
    out.set(data);
    return out;
  }
}
