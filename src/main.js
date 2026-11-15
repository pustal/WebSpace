/**
 * WebSpace: lists the apps installed on the TV and the storage each uses.
 *
 * Screen layout (1920x1080):
 *   header     the name, then the toolbar: sort, which apps, scan again, about
 *   storage    one bar per storage volume of the TV (and USB drives)
 *   status     counts, totals, where the report was saved
 *   list       one row per app: icon, name, id, install / data / total sizes
 *
 * The remote: Up/Down move through the list (Up from the top reaches the
 * toolbar), Left/Right move along the toolbar, OK opens an app's folders or
 * presses a button, Back closes a dialog or leaves the app. The colour keys
 * are shortcuts: red = sort, green = show all/installed, yellow = scan again,
 * blue = about.
 *
 * After every scan the list is also saved as a text file in the app's own
 * folder (see report.js).
 */
import qrcode from 'qrcode-generator';
import { exitApp, onTv, openInBrowser } from './luna.js';
import { scan, totalBytes, volumeOf } from './scan.js';
import { REPORT_NAME, saveReport } from './report.js';
import { formatBytes } from './format.js';

const PROJECT_URL = 'https://github.com/pustal/WebSpace';
const KOFI_URL = 'https://ko-fi.com/pustal';

/** Remote and keyboard key codes. */
const KEY = {
  LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40, ENTER: 13, BACK: 461, ESC: 27, BACKSPACE: 8,
  RED: 403, GREEN: 404, YELLOW: 405, BLUE: 406, PAGE_UP: 33, PAGE_DOWN: 34,
};

/** @type {{ result: import('./scan.js').ScanResult|null, sort: 'size'|'name', showAll: boolean, scanning: boolean,
 *           reportPath: string, reportError: string, focus: {zone: 'toolbar'|'list', index: number},
 *           modal: {element: HTMLElement, onKey: (code: number) => void}|null }} */
const state = {
  result: null,
  sort: 'size',
  showAll: false,
  scanning: false,
  reportPath: '',
  reportError: '',
  focus: { zone: 'list', index: 0 },
  modal: null,
};

// ---------------------------------------------------------------- DOM helpers

/**
 * Creates an element.
 * @param {string} tag
 * @param {Object<string, string>|null} [attrs]  `class`, `text`, or attributes
 * @param {Array<Node|string|null>} [children]
 * @returns {HTMLElement}
 */
function h(tag, attrs, children) {
  const element = document.createElement(tag);
  for (const key of Object.keys(attrs || {})) {
    if (key === 'class') element.className = attrs[key];
    else if (key === 'text') element.textContent = attrs[key];
    else element.setAttribute(key, attrs[key]);
  }
  for (const child of children || []) {
    if (child === null || child === undefined) continue;
    element.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return element;
}

/** Replaces @p parent's children (Element.replaceChildren is too new for webOS 4's Chromium 53). */
function setChildren(parent, children) {
  while (parent.firstChild) parent.removeChild(parent.firstChild);
  for (const child of children) parent.appendChild(child);
}

/** A size that may be unknown. */
function size(bytes) {
  return bytes === null || bytes === undefined ? '–' : formatBytes(bytes);
}

// ---------------------------------------------------------------- the screen

const root = /** @type {HTMLElement} */ (document.getElementById('app'));

/** The toolbar's buttons, left to right. */
function toolbarButtons() {
  return [
    { label: state.sort === 'size' ? 'Sort: size' : 'Sort: name', key: 'red', action: toggleSort },
    { label: state.showAll ? 'Showing: all apps' : 'Showing: installed', key: 'green', action: toggleShowAll },
    { label: state.scanning ? 'Scanning…' : 'Scan again', key: 'yellow', action: rescan },
    { label: 'About', key: 'blue', action: showAbout },
  ];
}

/** The apps shown, sorted. */
function visibleApps() {
  if (!state.result) return [];
  const apps = state.result.apps.filter((app) => state.showAll || !app.system);
  if (state.sort === 'name') return apps.sort((a, b) => a.title.localeCompare(b.title));
  return apps.sort((a, b) => (totalBytes(b) || 0) - (totalBytes(a) || 0) || a.title.localeCompare(b.title));
}

function render() {
  const apps = visibleApps();
  const header = h('header', { class: 'header' }, [
    h('img', { class: 'logo', src: 'icons/largeIcon.png', alt: '' }),
    h('div', { class: 'heading' }, [
      h('h1', { text: 'WebSpace' }),
      h('p', { class: 'subtitle', text: 'Apps on this TV and the space they use · v' + __APP_VERSION__ }),
    ]),
    h('nav', { class: 'toolbar' }, toolbarButtons().map((button, index) => h('div', {
      class: 'button key-' + button.key + (state.focus.zone === 'toolbar' && state.focus.index === index ? ' focused' : ''),
    }, [h('span', { class: 'key-dot' }), button.label]))),
  ]);

  const storage = h('section', { class: 'storage' }, renderVolumes());
  const status = h('p', { class: 'status' }, [statusLine(apps)]);
  const list = h('section', { class: 'list' }, renderRows(apps));
  const head = h('div', { class: 'row head' }, [
    h('div', { class: 'app-icon' }),
    h('div', { class: 'app-names', text: 'App' }),
    h('div', { class: 'legend' }, [h('span', { class: 'swatch install' }), 'Install folder', h('span', { class: 'swatch data' }), 'Data and services']),
    h('div', { class: 'num', text: 'Install' }),
    h('div', { class: 'num', text: 'Data' }),
    h('div', { class: 'num total', text: 'Total' }),
  ]);

  setChildren(root, [header, storage, status, head, list]);
  if (state.modal) root.appendChild(state.modal.element);
  keepFocusedRowVisible(list);
}

function renderVolumes() {
  const result = state.result;
  if (!result) return [h('p', { class: 'dim', text: 'Reading the TV’s storage…' })];
  if (result.volumes.length === 0) return [h('p', { class: 'dim', text: result.root ? 'No storage found.' : 'Storage sizes need root access.' })];
  return result.volumes.map((volume) => {
    const share = volume.totalBytes ? volume.usedBytes / volume.totalBytes : 0;
    return h('div', { class: 'volume' + (volume.usb ? ' usb' : '') }, [
      h('div', { class: 'volume-name', text: (volume.usb ? 'USB ' : '') + volume.mount }),
      h('div', { class: 'bar' }, [h('div', { class: 'bar-fill' + (share > 0.9 ? ' full' : ''), style: 'width:' + (share * 100).toFixed(1) + '%' })]),
      h('div', { class: 'volume-numbers', text: formatBytes(volume.freeBytes) + ' free of ' + formatBytes(volume.totalBytes) }),
    ]);
  });
}

/** @param {import('./scan.js').AppEntry[]} apps */
function statusLine(apps) {
  if (state.scanning && !state.result) return 'Scanning…';
  const result = state.result;
  if (!result) return '';
  const sum = apps.reduce((total, app) => total + (totalBytes(app) || 0), 0);
  let text = apps.length + (state.showAll ? ' apps' : ' installed apps') + (result.root ? ' using ' + formatBytes(sum) : '');
  if (result.note) text += '. ' + result.note;
  if (state.reportPath) text += '. List saved to ' + state.reportPath;
  else if (state.reportError) text += '. The list could not be saved: ' + state.reportError;
  return text + (onTv() ? '' : ' (sample data: not running on a TV)');
}

/** @param {import('./scan.js').AppEntry[]} apps */
function renderRows(apps) {
  if (!state.result) return [];
  if (apps.length === 0) return [h('p', { class: 'dim', text: 'No apps found.' })];
  const largest = Math.max(1, ...apps.map((app) => totalBytes(app) || 0));
  return apps.map((app, index) => {
    const total = totalBytes(app);
    const appShare = (app.appBytes || 0) / largest;
    const extraShare = (app.extraBytes || 0) / largest;
    const icon = app.icon ? h('img', { class: 'app-icon', src: 'file://' + app.icon, alt: '' }) : h('div', { class: 'app-icon placeholder', text: app.title.slice(0, 1) });
    if (icon.tagName === 'IMG') {
      icon.addEventListener('error', () => icon.replaceWith(h('div', { class: 'app-icon placeholder', text: app.title.slice(0, 1) })));
    }
    return h('div', { class: 'row' + (state.focus.zone === 'list' && state.focus.index === index ? ' focused' : '') }, [
      icon,
      h('div', { class: 'app-names' }, [
        h('div', { class: 'app-title', text: app.title + (app.system ? '  · built-in' : '') }),
        h('div', { class: 'app-id', text: app.id }),
      ]),
      h('div', { class: 'app-bar' }, [
        h('div', { class: 'seg install', style: 'width:' + (appShare * 100).toFixed(2) + '%' }),
        h('div', { class: 'seg data', style: 'width:' + (extraShare * 100).toFixed(2) + '%' }),
      ]),
      h('div', { class: 'num', text: size(app.appBytes) }),
      h('div', { class: 'num', text: size(app.extraBytes) }),
      h('div', { class: 'num total', text: size(total) }),
    ]);
  });
}

/** Scrolls the list so the highlighted row is in view. */
function keepFocusedRowVisible(list) {
  if (state.focus.zone !== 'list') return;
  const row = list.children[state.focus.index];
  if (!row) return;
  const top = row.offsetTop - list.offsetTop;
  if (top < list.scrollTop) list.scrollTop = top;
  else if (top + row.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = top + row.offsetHeight - list.clientHeight;
}

// ---------------------------------------------------------------- dialogs

/**
 * Shows a dialog with buttons; Back or the last button closes it.
 * @param {string} title
 * @param {Node[]} body
 * @param {{label: string, action: () => void}[]} buttons
 */
function openModal(title, body, buttons) {
  let selected = 0;
  const buttonRow = h('div', { class: 'modal-buttons' });
  const panel = h('div', { class: 'modal' }, [h('div', { class: 'modal-panel' }, [h('h2', { text: title }), ...body, buttonRow])]);
  const paint = () => {
    setChildren(buttonRow, buttons.map((button, index) => h('div', { class: 'button' + (index === selected ? ' focused' : ''), text: button.label })));
  };
  paint();
  const onKey = (code) => {
    if (code === KEY.LEFT) selected = Math.max(0, selected - 1);
    else if (code === KEY.RIGHT) selected = Math.min(buttons.length - 1, selected + 1);
    else if (code === KEY.ENTER) buttons[selected].action();
    else if (code === KEY.BACK || code === KEY.ESC || code === KEY.BACKSPACE) closeModal();
    paint();
  };
  state.modal = { element: panel, onKey };
  render();
}

function closeModal() {
  state.modal = null;
  render();
}

/** An app's folders, with their sizes and the storage they are on. */
function showDetails(app) {
  const volumes = state.result ? state.result.volumes : [];
  const rows = app.folders.length === 0
    ? [h('p', { class: 'dim', text: state.result && state.result.root ? 'No folders found for this app.' : 'Sizes need root access.' })]
    : app.folders.map((folder) => {
      const volume = volumeOf(volumes, folder.path);
      return h('div', { class: 'folder' }, [
        h('span', { class: 'folder-kind ' + folder.kind, text: folder.kind }),
        h('span', { class: 'folder-size', text: formatBytes(folder.bytes) }),
        h('span', { class: 'folder-path', text: folder.path + (volume ? '   (' + volume.mount + ')' : '') }),
      ]);
    });
  openModal(app.title, [
    h('p', { class: 'dim', text: app.id + (app.system ? ' · built into the firmware' : '') + ' · total ' + size(totalBytes(app)) }),
    h('div', { class: 'folders' }, rows),
  ], [{ label: 'Close', action: closeModal }]);
}

/** A QR code for @p text, as an SVG element. */
function qrCode(text) {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const box = h('div', { class: 'qr' });
  box.innerHTML = qr.createSvgTag({ cellSize: 8, margin: 4, scalable: true });
  return box;
}

function showAbout() {
  const link = (title, url) => h('div', { class: 'link' }, [qrCode(url), h('div', { class: 'link-title', text: title }), h('div', { class: 'link-url', text: url.replace(/^https:\/\//, '') })]);
  const buttons = [];
  if (onTv()) {
    buttons.push({ label: 'Open GitHub in the browser', action: () => openInBrowser(PROJECT_URL).catch(() => {}) });
    buttons.push({ label: 'Open Ko-fi in the browser', action: () => openInBrowser(KOFI_URL).catch(() => {}) });
  }
  buttons.push({ label: 'Close', action: closeModal });
  openModal('About WebSpace', [
    h('p', { text: 'WebSpace ' + __APP_VERSION__ + ' lists the apps on this TV and the storage each one uses. '
      + 'Measuring needs root access (a rooted TV with the Homebrew Channel). After each scan the list is also saved as '
      + REPORT_NAME + ' in the app’s folder.' }),
    h('div', { class: 'links' }, [link('Source code and help', PROJECT_URL), link('Support the project on Ko-fi', KOFI_URL)]),
    h('p', { class: 'dim', text: 'Free software under the GNU GPL v3. Scan a code with your phone.' }),
  ], buttons);
}

// ---------------------------------------------------------------- actions

function toggleSort() {
  state.sort = state.sort === 'size' ? 'name' : 'size';
  state.focus = { zone: state.focus.zone, index: state.focus.zone === 'list' ? 0 : state.focus.index };
  render();
}

function toggleShowAll() {
  state.showAll = !state.showAll;
  if (state.focus.zone === 'list') state.focus.index = 0;
  render();
}

async function rescan() {
  if (state.scanning) return;
  state.scanning = true;
  state.reportPath = '';
  state.reportError = '';
  render();
  try {
    state.result = await scan((message) => {
      // Progress shows in the status line until the first results are in.
      const status = root.querySelector('.status');
      if (!state.result && status) status.textContent = message;
    });
  } catch (error) {
    state.result = { apps: [], volumes: [], root: false, ownFolder: '', when: new Date(), note: 'The apps could not be listed: ' + (error instanceof Error ? error.message : String(error)) };
  }
  state.scanning = false;
  state.focus.index = Math.min(state.focus.index, Math.max(0, visibleApps().length - 1));
  render();
  if (onTv() && state.result.root) {
    try {
      state.reportPath = await saveReport(state.result);
    } catch (error) {
      state.reportError = error instanceof Error ? error.message : String(error);
    }
    render();
  }
}

// ---------------------------------------------------------------- the remote

document.addEventListener('keydown', (event) => {
  const code = event.keyCode;
  if (state.modal) {
    event.preventDefault();
    state.modal.onKey(code);
    return;
  }
  const buttons = toolbarButtons();
  const count = visibleApps().length;
  const focus = state.focus;
  switch (code) {
    case KEY.UP:
      if (focus.zone === 'list' && focus.index > 0) focus.index--;
      else if (focus.zone === 'list') state.focus = { zone: 'toolbar', index: 0 };
      break;
    case KEY.DOWN:
      if (focus.zone === 'toolbar' && count > 0) state.focus = { zone: 'list', index: 0 };
      else if (focus.zone === 'list') focus.index = Math.min(count - 1, focus.index + 1);
      break;
    case KEY.PAGE_DOWN:
      if (focus.zone === 'list') focus.index = Math.min(count - 1, focus.index + 8);
      break;
    case KEY.PAGE_UP:
      if (focus.zone === 'list') focus.index = Math.max(0, focus.index - 8);
      break;
    case KEY.LEFT:
      if (focus.zone === 'toolbar') focus.index = Math.max(0, focus.index - 1);
      break;
    case KEY.RIGHT:
      if (focus.zone === 'toolbar') focus.index = Math.min(buttons.length - 1, focus.index + 1);
      break;
    case KEY.ENTER:
      if (focus.zone === 'toolbar') buttons[focus.index].action();
      else if (count > 0) showDetails(visibleApps()[focus.index]);
      break;
    case KEY.RED: toggleSort(); break;
    case KEY.GREEN: toggleShowAll(); break;
    case KEY.YELLOW: rescan(); break;
    case KEY.BLUE: showAbout(); break;
    case KEY.BACK:
    case KEY.ESC:
      exitApp();
      break;
    default:
      return;
  }
  event.preventDefault();
  if (!state.modal) render();
});

render();
rescan();
