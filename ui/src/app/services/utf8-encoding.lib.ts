// Author: Preston Lee

/**
 * UTF-8 text encoding for FHIR resources and related artifacts.
 *
 * FHIR requires UTF-8 for JSON, XML, and base64-wrapped `data` elements (e.g. Library.content).
 * Do not use `btoa`/`atob` for CQL, ELM, or other text: they treat each JavaScript code unit as a
 * Latin-1 byte (0–255) and throw or corrupt characters above U+00FF.
 *
 * Use:
 * - encodeUtf8Base64 / decodeUtf8Base64 — Library.content, Attachment.data for text
 * - decodeUtf8Bytes — raw UTF-8 octets from FHIR package tarballs (Uint8Array)
 *
 * Non-goals (use other APIs): HTTP Basic auth (btoa on credentials), URL encoding
 * (encodeURIComponent), non-FHIR hash fingerprints.
 */

const UTF8_DECODER_STRICT = new TextDecoder('utf-8', { fatal: true });
const UTF8_DECODER_LENIENT = new TextDecoder('utf-8', { fatal: false });
const UTF8_ENCODER = new TextEncoder();

/**
 * Encodes a string as UTF-8 octets, then Base64 for FHIR `data` elements.
 */
export function encodeUtf8Base64(text: string): string {
  const bytes = UTF8_ENCODER.encode(text);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Decodes a FHIR Base64 `data` element to a string using UTF-8.
 * @throws {TypeError} if Base64 or UTF-8 payload is invalid
 */
export function decodeUtf8Base64(base64: string): string {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return UTF8_DECODER_STRICT.decode(bytes);
}

export interface DecodeUtf8BytesOptions {
  /**
   * When true, invalid UTF-8 sequences throw. When false (default), the decoder replaces
   * ill-formed sequences with U+FFFD — appropriate for NPM package tarball text files.
   */
  fatal?: boolean;
}

/**
 * Decodes raw UTF-8 bytes (e.g. from an extracted FHIR package file).
 */
export function decodeUtf8Bytes(bytes: Uint8Array, options?: DecodeUtf8BytesOptions): string {
  const fatal = options?.fatal ?? false;
  const decoder = fatal ? UTF8_DECODER_STRICT : UTF8_DECODER_LENIENT;
  return decoder.decode(bytes);
}
