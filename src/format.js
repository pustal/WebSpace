/** Formatting helpers. */

/**
 * A byte count for people: "1.5 GB", "320 MB", "12 KB".
 * @param {number} bytes
 * @returns {string}
 */
export function formatBytes(bytes) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  const digits = unit === 0 || value >= 100 ? 0 : 1;
  return value.toFixed(digits) + ' ' + units[unit];
}
