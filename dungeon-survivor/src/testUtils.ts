/**
 * Test helper: returns the element at `index` or throws immediately if missing,
 * preventing silent skips or fallback values under `noUncheckedIndexedAccess`.
 */
export function mustAt<T>(items: readonly T[], index: number, label = 'array'): T {
  const item = items[index];
  if (item === undefined) {
    throw new Error(`Expected ${label}[${index}] to be defined (length=${items.length})`);
  }
  return item;
}

/**
 * Test helper: returns `value` if it is neither `null` nor `undefined`,
 * or throws immediately otherwise, replacing non-null assertions (`!`) in tests.
 */
export function mustDefined<T>(value: T | null | undefined, label = 'value'): T {
  if (value === null || value === undefined) {
    throw new Error(`Expected ${label} to be defined`);
  }
  return value;
}
