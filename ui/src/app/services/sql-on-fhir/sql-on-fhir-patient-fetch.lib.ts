// Author: Preston Lee

export const PATIENT_COMPARTMENT_SEARCH_PAGE_SIZE = 200;
export const PATIENT_COMPARTMENT_FETCH_CONCURRENCY = 5;

export function nonPatientResourceTypes(resourceTypes: string[]): string[] {
  return resourceTypes.filter(t => t.trim() && t !== 'Patient');
}

export function patientReference(patientId: string): string {
  return `Patient/${patientId}`;
}

export async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) {
    return [];
  }
  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await mapper(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

export function isEverythingOperationFailure(err: unknown): boolean {
  if (err && typeof err === 'object' && 'status' in err) {
    const status = (err as { status: number }).status;
    return status === 404 || status === 400 || status === 501;
  }
  return false;
}
