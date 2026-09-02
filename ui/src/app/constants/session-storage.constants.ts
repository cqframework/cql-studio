// Author: Preston Lee

/**
 * Constants for sessionStorage keys used throughout the application.
 * This prevents typos and makes it easier to maintain consistent key names.
 */
export class SessionStorageKeys {
  // Main data storage
  public static readonly CQL_TEST_RESULTS = 'cqlTestResults';
  public static readonly VALIDATION_ERRORS = 'validationErrors';
  public static readonly ORIGINAL_FILENAME = 'originalFilename';
  public static readonly INDEX_URL = 'indexUrl';
  public static readonly CURRENT_FILE_URL = 'currentFileUrl';

  /** JSON array of { testsName, groupName, testName } to prefill runner Tests.OnlyList */
  public static readonly RUNNER_PREFILL_ONLY_LIST = 'runnerPrefillOnlyList';

  // Filter and view state (temporary)
  public static readonly INITIAL_STATUS = 'initialStatus';
  public static readonly INITIAL_SEARCH = 'initialSearch';
  public static readonly INITIAL_GROUP_BY = 'initialGroupBy';
  public static readonly INITIAL_SORT_BY = 'initialSortBy';
  public static readonly INITIAL_SORT_ORDER = 'initialSortOrder';
}
