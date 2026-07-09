import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Groups rows into a Map by a derived key, preserving row order within each
 * group. Dependency-free — the shared replacement for the hand-rolled
 * "get-or-create array, push, set" loops. */
export function groupBy<T, K>(rows: readonly T[], key: (row: T) => K): Map<K, T[]> {
  const groups = new Map<K, T[]>();
  for (const row of rows) {
    const k = key(row);
    const group = groups.get(k);
    if (group) {
      group.push(row);
    } else {
      groups.set(k, [row]);
    }
  }
  return groups;
}
