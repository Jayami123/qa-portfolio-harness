/** Node flag names for the old-space limit. Node takes both spellings in NODE_OPTIONS. */
const HEAP_FLAG = /(^|\s)--max[-_]old[-_]space[-_]size(=|\s|$)/;

/**
 * Returns NODE_OPTIONS with a default heap limit. The caller's own limit wins and is returned unchanged.
 * Otherwise the default is appended after the caller's flags, which are kept. A blank input returns the default
 * alone, so an empty NODE_OPTIONS gives the same value as v0.2.18.
 */
export function withHeapDefault(current: string | undefined, defaultMb: number): string {
  const base = current?.trim() ?? "";
  const flag = `--max-old-space-size=${String(defaultMb)}`;
  if (base === "") {
    return flag;
  }
  if (HEAP_FLAG.test(base)) {
    return base;
  }
  return `${base} ${flag}`;
}
