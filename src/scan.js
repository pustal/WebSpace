/**
 * Finds the installed apps and the storage they use.
 *
 * 1. The apps come from webOS' application manager (listApps): id, title,
 *    icon, install folder, whether it is a built-in (system) app.
 * 2. With root (see luna.js), one shell script measures each app's install
 *    folder (du) and lists the folders elsewhere that carry an app's id in
 *    their name: its services, and the data the TV keeps for it. Those are
 *    measured in a second script. Folders are measured on their own file
 *    system only (du -x), so bind mounts are never counted twice.
 * 3. The TV's writable storage (from /proc/mounts and df) is summarised.
 *
 * Without root only step 1 runs (if the TV allows it), with no sizes.
 */
import { call, onTv, runAsRoot, runAsRootLong, shellQuote } from './luna.js';
import { demoScan } from './demo.js';

/**
 * Where folders named after an app may hold its services or its data, besides
 * the install folder. Missing ones are skipped.
 */
const EXTRA_ROOTS = [
  '/media/developer/apps/usr/palm/services',
  '/media/cryptofs/apps/usr/palm/services',
  '/media/developer/apps/usr/palm/data',
  '/media/cryptofs/apps/usr/palm/data',
  '/var/palm/jail',
  '/var/lib/webosbrew',
  '/var/lib/webappmanager*',
  '/var/lib/wam*',
  '/media/developer/temp',
];
/** How deep below each of those roots the names are looked at. */
const EXTRA_DEPTH = 4;

/** Apps at least this big get their largest files listed (to see what fills them). */
const BIG_APP_BYTES = 20 * 1024 * 1024;
/** Files listed per big app, and the smallest one worth listing. */
const LARGEST_FILES = 8;
const LARGEST_FILE_MIN_KB = 1024;

/** File system types that are the TV's own writable storage. */
const STORAGE_TYPES = ['ext2', 'ext3', 'ext4', 'f2fs', 'ubifs', 'jffs2', 'btrfs', 'xfs'];

/**
 * @typedef {Object} FolderSize
 * @property {string} path
 * @property {number} bytes
 * @property {'install'|'service'|'data'} kind
 */

/**
 * @typedef {Object} AppEntry
 * @property {string} id
 * @property {string} title
 * @property {string} icon        file path of its icon (may be empty)
 * @property {string} folder      install folder
 * @property {boolean} system     built into the firmware (not removable)
 * @property {number|null} appBytes    install folder size (null: unknown)
 * @property {number|null} extraBytes  services and data elsewhere (null: unknown)
 * @property {FolderSize[]} folders
 * @property {{path: string, bytes: number}[]} largestFiles  its biggest files (apps above BIG_APP_BYTES only)
 */

/**
 * @typedef {Object} Volume
 * @property {string} mount
 * @property {string} type
 * @property {number} totalBytes
 * @property {number} usedBytes
 * @property {number} freeBytes
 * @property {boolean} usb
 */

/**
 * @typedef {Object} ScanResult
 * @property {AppEntry[]} apps
 * @property {Volume[]} volumes
 * @property {boolean} root      sizes could be read
 * @property {string} ownFolder  this app's install folder ('' if unknown)
 * @property {string} note       why something is missing ('' when all is well)
 * @property {Date} when
 */

/** The total of an app's folders, or null when unknown. */
export function totalBytes(app) {
  if (app.appBytes === null) return null;
  return app.appBytes + (app.extraBytes || 0);
}

/**
 * The installed apps, from the application manager (directly, or through
 * luna-send as root when the TV does not let this app ask).
 * @param {boolean} root
 * @returns {Promise<Object[]>} listApps' entries
 */
async function listApps(root) {
  try {
    const reply = await call('luna://com.webos.applicationManager/listApps', {});
    if (Array.isArray(reply.apps)) return reply.apps;
  } catch (error) {
    if (!root) throw error;
  }
  // -f prints the reply over many short lines (see runAsRootLong); it is long: every app's appinfo.
  const output = await runAsRootLong("luna-send -n 1 -f luna://com.webos.applicationManager/listApps '{}'");
  const reply = JSON.parse(output.slice(output.indexOf('{')));
  if (!Array.isArray(reply.apps)) throw new Error('the application manager listed no apps');
  return reply.apps;
}

/**
 * Parses `du -skx` lines ("<kB>\t<path>") into a map path → bytes.
 * @param {string} output
 * @returns {Map<string, number>}
 */
function parseDu(output) {
  const sizes = new Map();
  for (const line of output.split('\n')) {
    const match = /^(\d+)\s+(.+)$/.exec(line.trim());
    if (match) sizes.set(match[2], Number(match[1]) * 1024);
  }
  return sizes;
}

/**
 * The TV's writable storage, from /proc/mounts (types) and df (sizes).
 * @param {string} mounts  /proc/mounts
 * @param {string} df      `df -k` output
 * @returns {Volume[]}
 */
function parseVolumes(mounts, df) {
  /** @type {Map<string, string>} mount point → type */
  const types = new Map();
  for (const line of mounts.split('\n')) {
    const fields = line.split(' ');
    if (fields.length >= 3) types.set(fields[1].replace(/\\040/g, ' '), fields[2]);
  }
  /** @type {Volume[]} */
  const volumes = [];
  const seen = new Set();
  for (const line of df.split('\n').slice(1)) {
    const fields = line.trim().split(/\s+/);
    if (fields.length < 6) continue;
    const mount = fields.slice(5).join(' ');
    const type = types.get(mount) || '';
    const usb = mount.indexOf('/tmp/usb/') === 0;
    if (!usb && STORAGE_TYPES.indexOf(type) < 0) continue;
    const total = Number(fields[1]) * 1024;
    const used = Number(fields[2]) * 1024;
    const free = Number(fields[3]) * 1024;
    // The same partition mounted in several places counts once.
    const key = fields[0] + ':' + total;
    if (!total || seen.has(key)) continue;
    seen.add(key);
    volumes.push({ mount, type, totalBytes: total, usedBytes: used, freeBytes: free, usb });
  }
  volumes.sort((a, b) => Number(a.usb) - Number(b.usb) || b.totalBytes - a.totalBytes);
  return volumes;
}

/** Whether @p path is @p folder or inside it. */
function within(path, folder) {
  return path === folder || path.indexOf(folder + '/') === 0;
}

/**
 * Scans the TV.
 * @param {(message: string) => void} onProgress
 * @returns {Promise<ScanResult>}
 */
export async function scan(onProgress) {
  if (!onTv()) return demoScan();

  onProgress('Checking root access…');
  let root = false;
  try {
    root = (await runAsRoot('id -u')).trim() === '0';
  } catch (error) {
    root = false;
  }

  onProgress('Listing the apps…');
  const listed = await listApps(root);
  /** @type {AppEntry[]} */
  const apps = listed
    .filter((app) => app && app.id)
    .map((app) => ({
      id: String(app.id),
      title: String(app.title || app.id),
      icon: app.icon ? String(app.icon) : '',
      folder: String(app.folderPath || ''),
      system: app.systemApp === true || app.removable === false,
      appBytes: null,
      extraBytes: null,
      folders: [],
      largestFiles: [],
    }));
  const own = apps.find((app) => app.id === __APP_ID__);
  const ownFolder = own ? own.folder : decodeURIComponent(location.pathname.replace(/\/[^/]*$/, ''));

  if (!root) {
    return {
      apps, volumes: [], root, ownFolder, when: new Date(),
      note: 'Root access is needed to measure the apps: this TV is not rooted, or the Homebrew Channel did not answer.',
    };
  }

  // --- Install folders, the candidates elsewhere, the storage: one script.
  onProgress('Measuring the install folders…');
  const folders = apps.map((app) => app.folder).filter((folder) => folder);
  const script = [
    'echo "@@DU"',
    folders.length ? 'du -skx ' + folders.map(shellQuote).join(' ') + ' 2>/dev/null' : 'true',
    'echo "@@DIRS"',
    // Unquoted on purpose: the roots with * are shell patterns.
    'for r in ' + EXTRA_ROOTS.join(' ') + '; do [ -d "$r" ] && find "$r" -xdev -maxdepth ' + EXTRA_DEPTH + ' -type d 2>/dev/null; done'
      // Only names that can hold an app id (it has dots); keeps the answer small.
      + " | grep -E '/[^/]*[.][^/]+$'",
    'echo "@@MOUNTS"',
    'cat /proc/mounts',
    'echo "@@DF"',
    'df -k 2>/dev/null',
  ].join('; ');
  const output = await runAsRootLong(script);
  const section = (name) => {
    const start = output.indexOf('@@' + name);
    if (start < 0) return '';
    const from = output.indexOf('\n', start) + 1;
    const next = output.indexOf('\n@@', from);
    return output.slice(from, next < 0 ? output.length : next + 1);
  };
  const installSizes = parseDu(section('DU'));
  const volumes = parseVolumes(section('MOUNTS'), section('DF'));

  // Folders named after an app (outside its install folder); the topmost match only.
  const candidates = section('DIRS').split('\n').map((line) => line.trim()).filter((line) => line);
  /** @type {Map<string, {app: AppEntry, kind: 'service'|'data'}>} */
  const matches = new Map();
  const byLength = apps.filter((app) => app.id.indexOf('.') > 0).sort((a, b) => b.id.length - a.id.length);
  for (const path of candidates) {
    const name = path.slice(path.lastIndexOf('/') + 1).toLowerCase();
    const app = byLength.find((entry) => name.indexOf(entry.id.toLowerCase()) >= 0);
    if (!app || (app.folder && within(path, app.folder))) continue;
    let covered = false;
    for (const existing of matches.keys()) {
      if (within(path, existing)) covered = true;
    }
    if (covered) continue;
    for (const existing of Array.from(matches.keys())) {
      if (within(existing, path)) matches.delete(existing);
    }
    matches.set(path, { app, kind: path.indexOf('/services/') >= 0 ? 'service' : 'data' });
  }

  onProgress('Measuring the services and data…');
  const extraSizes = matches.size ? parseDu(await runAsRootLong('du -skx ' + Array.from(matches.keys()).map(shellQuote).join(' ') + ' 2>/dev/null')) : new Map();

  for (const app of apps) {
    if (app.folder && installSizes.has(app.folder)) {
      app.appBytes = installSizes.get(app.folder);
      app.folders.push({ path: app.folder, bytes: app.appBytes, kind: 'install' });
    }
    app.extraBytes = 0;
  }
  for (const [path, match] of matches) {
    const bytes = extraSizes.get(path);
    if (bytes === undefined) continue;
    match.app.extraBytes += bytes;
    match.app.folders.push({ path, bytes, kind: match.kind });
    if (match.app.appBytes === null) match.app.appBytes = 0;
  }

  // What fills the big apps: their largest files (in all their folders).
  const big = apps.filter((app) => !app.system && (totalBytes(app) || 0) >= BIG_APP_BYTES && app.folders.length > 0);
  if (big.length) {
    onProgress('Looking at the largest files…');
    // Not the jail folders: webOS mounts other apps' folders inside them, which find may walk into.
    const searched = (app) => app.folders.filter((folder) => folder.path.indexOf('/var/palm/jail/') !== 0);
    const listing = big.filter((app) => searched(app).length > 0).map((app) => 'echo "@@APP ' + app.id + '"; find ' + searched(app).map((folder) => shellQuote(folder.path)).join(' ')
      + ' -xdev -type f -size +' + LARGEST_FILE_MIN_KB + "k -exec du -k {} \\; 2>/dev/null | sort -rn | head -n " + LARGEST_FILES).join('; ');
    let current = null;
    for (const line of (await runAsRootLong(listing)).split('\n')) {
      if (line.indexOf('@@APP ') === 0) {
        const id = line.slice(6).trim();
        current = big.find((app) => app.id === id) || null;
        continue;
      }
      const match = /^(\d+)\s+(.+)$/.exec(line.trim());
      if (current && match) current.largestFiles.push({ path: match[2], bytes: Number(match[1]) * 1024 });
    }
  }

  return { apps, volumes, root, ownFolder, when: new Date(), note: '' };
}

/**
 * The volume holding @p path (the longest mount point that contains it).
 * @param {Volume[]} volumes
 * @param {string} path
 * @returns {Volume|null}
 */
export function volumeOf(volumes, path) {
  let best = null;
  for (const volume of volumes) {
    if (within(path, volume.mount) || volume.mount === '/') {
      if (!best || volume.mount.length > best.mount.length) best = volume;
    }
  }
  return best;
}
