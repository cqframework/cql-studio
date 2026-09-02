// Author: Preston Lee

/**
 * Enum for status filter values used in query parameters and UI controls
 */
export enum StatusFilter {
  ALL = 'all',
  PASS = 'pass',
  FAIL = 'fail',
  SKIP = 'skip',
  ERROR = 'error'
}

/**
 * Enum for group by options used in query parameters and UI controls
 */
export enum GroupByOption {
  NONE = 'none',
  GROUP = 'group',
  STATUS = 'status',
  TESTS_NAME = 'testsName'
}

/**
 * Enum for sort by options used in query parameters and UI controls
 */
export enum SortByOption {
  NAME = 'name',
  GROUP = 'group',
  STATUS = 'status',
  EXPRESSION = 'expression',
  TESTS_NAME = 'testsName'
}

/**
 * Enum for sort order values used in query parameters and UI controls
 */
export enum SortOrder {
  ASC = 'asc',
  DESC = 'desc'
}

/**
 * Type guard to check if a string is a valid StatusFilter value
 */
export function isValidStatusFilter(value: string): value is StatusFilter {
  return Object.values(StatusFilter).includes(value as StatusFilter);
}

/**
 * Type guard to check if a string is a valid GroupByOption value
 */
export function isValidGroupByOption(value: string): value is GroupByOption {
  return Object.values(GroupByOption).includes(value as GroupByOption);
}

/**
 * Type guard to check if a string is a valid SortByOption value
 */
export function isValidSortByOption(value: string): value is SortByOption {
  return Object.values(SortByOption).includes(value as SortByOption);
}

/**
 * Type guard to check if a string is a valid SortOrder value
 */
export function isValidSortOrder(value: string): value is SortOrder {
  return Object.values(SortOrder).includes(value as SortOrder);
}

/**
 * Helper function to get all valid status filter values as an array
 */
export function getStatusFilterValues(): string[] {
  return Object.values(StatusFilter);
}

/**
 * Helper function to get all valid group by option values as an array
 */
export function getGroupByOptionValues(): string[] {
  return Object.values(GroupByOption);
}

/**
 * Helper function to get all valid sort by option values as an array
 */
export function getSortByOptionValues(): string[] {
  return Object.values(SortByOption);
}

/**
 * Helper function to get all valid sort order values as an array
 */
export function getSortOrderValues(): string[] {
  return Object.values(SortOrder);
}
