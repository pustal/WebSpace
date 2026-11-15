/**
 * The text report of a scan, saved in the app's own folder on the TV
 * (webspace-report.txt) after every scan, so the list can be read later, for
 * example over SSH or copied off the TV.
 *
 * A web app cannot write files itself: root (the Homebrew Channel) writes it.
 */
import { onTv, runAsRoot, shellQuote } from './luna.js';
import { totalBytes, volumeOf } from './scan.js';
import { formatBytes } from './format.js';

/** The report's file name, in the app's folder. */
export const REPORT_NAME = 'webspace-report.txt';

/** Pads @p text to @p width on the right (or the left when @p right). */
function pad(text, width, right = false) {
  const value = String(text);
  if (value.length >= width) return value;
  const fill = ' '.repeat(width - value.length);
  return right ? fill + value : value + fill;
}

/** Size or "?" for a byte count that may be unknown. */
function size(bytes) {
  return bytes === null || bytes === undefined ? '?' : formatBytes(bytes);
}

/**
 * The report as text.
 * @param {import('./scan.js').ScanResult} result
 * @returns {string}
 */
export function reportText(result) {
  const lines = [];
  lines.push('WebSpace ' + __APP_VERSION__ + ': apps and the storage they use');
  lines.push('Scanned ' + result.when.toISOString().replace('T', ' ').slice(0, 19) + ' UTC');
  lines.push('');
  if (result.note) {
    lines.push(result.note);
    lines.push('');
  }

  lines.push('Storage');
  if (result.volumes.length === 0) lines.push('  (unknown)');
  for (const volume of result.volumes) {
    lines.push('  ' + pad(volume.mount, 28) + pad(formatBytes(volume.usedBytes) + ' used', 16) + pad(formatBytes(volume.freeBytes) + ' free', 16)
      + 'of ' + formatBytes(volume.totalBytes) + (volume.usb ? '  (USB drive)' : ''));
  }
  lines.push('');

  const byTotal = (a, b) => (totalBytes(b) || 0) - (totalBytes(a) || 0) || a.title.localeCompare(b.title);
  const sections = [
    { title: 'Installed apps', apps: result.apps.filter((app) => !app.system).sort(byTotal) },
    { title: 'Built-in apps (part of the firmware)', apps: result.apps.filter((app) => app.system).sort(byTotal) },
  ];
  for (const sectionInfo of sections) {
    const sum = sectionInfo.apps.reduce((total, app) => total + (totalBytes(app) || 0), 0);
    lines.push(sectionInfo.title + ' (' + sectionInfo.apps.length + (result.root ? ', ' + formatBytes(sum) + ' in all' : '') + ')');
    lines.push('  ' + pad('App', 34) + pad('Install', 11, true) + pad('Data', 11, true) + pad('Total', 11, true) + '  Id');
    for (const app of sectionInfo.apps) {
      lines.push('  ' + pad(app.title.slice(0, 33), 34) + pad(size(app.appBytes), 11, true) + pad(size(app.extraBytes), 11, true)
        + pad(size(totalBytes(app)), 11, true) + '  ' + app.id);
      for (const folder of app.folders) {
        const volume = volumeOf(result.volumes, folder.path);
        lines.push('      ' + pad(folder.kind, 8) + pad(formatBytes(folder.bytes), 11, true) + '  ' + folder.path
          + (volume ? '  [' + volume.mount + ']' : ''));
      }
    }
    lines.push('');
  }
  lines.push('Install: the app\'s own folder. Data: folders elsewhere named after the app (its services and the data the TV keeps for it).');
  return lines.join('\n') + '\n';
}

/**
 * Saves the report in the app's folder.
 * @param {import('./scan.js').ScanResult} result
 * @returns {Promise<string>} the file's path
 */
export async function saveReport(result) {
  if (!onTv() || !result.root || !result.ownFolder) throw new Error('saving the report needs root access on the TV');
  const path = result.ownFolder + '/' + REPORT_NAME;
  const text = reportText(result);
  // A here-document with a delimiter the report cannot contain (it is checked).
  const marker = 'WEBSPACE_REPORT_END';
  if (text.indexOf(marker) >= 0) throw new Error('the report could not be written');
  await runAsRoot('cat > ' + shellQuote(path) + " <<'" + marker + "'\n" + text + marker + '\nchmod 644 ' + shellQuote(path));
  return path;
}
