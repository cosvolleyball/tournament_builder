/**
 * Fetch all rows even when PostgREST enforces its per-response row cap.
 * The supplied query must have deterministic ordering before `.range()`.
 */
export async function readAllPages<T>(
  query: (start: number, end: number) => PromiseLike<{
    data: T[] | null;
    error: { message: string } | null;
  }>,
  pageSize = 500,
): Promise<T[]> {
  const all: T[] = [];
  for (let start = 0; ; start += pageSize) {
    const { data, error } = await query(start, start + pageSize - 1);
    if (error) throw new Error(error.message);
    const page = data ?? [];
    all.push(...page);
    if (page.length < pageSize) break;
  }
  return all;
}

/**
 * PostgREST `.in()` filters can also become too long for large tournaments.
 * Split match IDs into bounded groups and page the response for each group.
 * A few groups run concurrently rather than issuing hundreds of serial calls.
 */
export async function readScoresByMatchIds<T>(
  matchIds: string[],
  query: (ids: string[], start: number, end: number) => PromiseLike<{
    data: T[] | null;
    error: { message: string } | null;
  }>,
): Promise<T[]> {
  const chunkSize = 100;
  const maxConcurrency = 4;
  const chunks: string[][] = [];
  for (let i = 0; i < matchIds.length; i += chunkSize) {
    chunks.push(matchIds.slice(i, i + chunkSize));
  }
  const all: T[] = [];
  for (let offset = 0; offset < chunks.length; offset += maxConcurrency) {
    const group = chunks.slice(offset, offset + maxConcurrency);
    const rows = await Promise.all(group.map(ids =>
      readAllPages((start, end) => query(ids, start, end)),
    ));
    rows.forEach(page => all.push(...page));
  }
  return all;
}
