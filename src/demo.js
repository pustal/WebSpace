/**
 * Sample results for a desktop browser (no luna bus there), so the screens
 * can be worked on and photographed without a TV. Never used on the TV.
 */

const MB = 1024 * 1024;

/**
 * @param {string} id @param {string} title @param {number} appMb @param {number} dataMb
 * @param {boolean} [system]
 */
function app(id, title, appMb, dataMb, system = false) {
  const base = system ? '/usr/palm/applications/' : '/media/developer/apps/usr/palm/applications/';
  const folders = [{ path: base + id, bytes: appMb * MB, kind: 'install' }];
  if (dataMb) folders.push({ path: '/media/developer/apps/usr/palm/data/' + id, bytes: dataMb * MB, kind: 'data' });
  const largestFiles = appMb + dataMb >= 20 && !system
    ? [{ path: base + id + '/data/big-file.bin', bytes: Math.round((appMb + dataMb) * 0.6 * MB) }]
    : [];
  return { id, title, icon: '', folder: base + id, system, appBytes: appMb * MB, extraBytes: dataMb * MB, folders, largestFiles };
}

/** @returns {Promise<import('./scan.js').ScanResult>} */
export function demoScan() {
  return new Promise((resolve) => setTimeout(() => resolve({
    apps: [
      app('org.sonic3air.webos', 'Sonic 3 A.I.R.', 20.1, 131.4),
      app('org.webmario64.app', 'Web Mario 64', 13.2, 18.9),
      app('org.animalcrossingwebos.app', 'Animal Crossing', 24.6, 2.1),
      app('org.sonicwebmania.app', 'SonicWebMania', 9.8, 0.4),
      app('org.stashwebos.app', 'Stash', 3.1, 41.7),
      app('org.webosbrew.hbchannel', 'Homebrew Channel', 6.4, 0.2),
      app('org.webspace.app', 'WebSpace', 0.2, 0),
      app('com.webos.app.browser', 'Web Browser', 312.0, 0, true),
      app('com.palm.app.settings', 'Settings', 48.5, 0, true),
    ],
    volumes: [
      { mount: '/media/developer', type: 'ext4', totalBytes: 2.2 * 1024 * MB, usedBytes: 1.6 * 1024 * MB, freeBytes: 0.6 * 1024 * MB, usb: false },
      { mount: '/var', type: 'ext4', totalBytes: 512 * MB, usedBytes: 290 * MB, freeBytes: 222 * MB, usb: false },
      { mount: '/tmp/usb/sda/sda1', type: 'vfat', totalBytes: 58 * 1024 * MB, usedBytes: 21 * 1024 * MB, freeBytes: 37 * 1024 * MB, usb: true },
    ],
    root: true,
    ownFolder: '/media/developer/apps/usr/palm/applications/org.webspace.app',
    note: '',
    when: new Date(),
  }), 400));
}
