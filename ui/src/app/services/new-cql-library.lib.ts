// Author: Preston Lee

export const LIBRARY_TITLE_PATTERN = /^[A-Za-z][A-Za-z0-9_]*$/;

export function isValidLibraryTitle(title: string): boolean {
  return LIBRARY_TITLE_PATTERN.test(title);
}

export function sanitizeLibraryTitleInput(value: string): string {
  return value.replace(/[^A-Za-z0-9_]/g, '');
}

export function buildNewLibraryCql(title: string): string {
  return `library ${title} version '1.0.0'

using FHIR version '4.0.1'
include FHIRHelpers version '4.0.1'

context Patient

define HelloWorld :
  'If you\\'re seeing this text, the CQL library is working!'
`;
}
