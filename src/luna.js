/**
 * Calls to webOS services over the luna bus (PalmServiceBridge), and root
 * commands through the Homebrew Channel.
 *
 * The Homebrew Channel's service (org.webosbrew.hbchannel.service) runs as
 * root on rooted TVs and offers `exec`, which runs a shell command and
 * returns its output. Reading other apps' folders needs it: a normal app is
 * confined to its own files.
 */

/** The Homebrew Channel's root command endpoint. */
const EXEC_URI = 'luna://org.webosbrew.hbchannel.service/exec';

/** True on a webOS TV (the luna bus is there). */
export function onTv() {
  return typeof window !== 'undefined' && typeof window.PalmServiceBridge !== 'undefined';
}

/**
 * One call to a luna service.
 * @param {string} uri      e.g. 'luna://com.webos.applicationManager/listApps'
 * @param {Object} params
 * @param {number} [timeoutMs]
 * @returns {Promise<Object>} the reply (rejected when returnValue is false)
 */
export function call(uri, params, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    if (!onTv()) {
      reject(new Error('not running on a webOS TV'));
      return;
    }
    const bridge = new window.PalmServiceBridge();
    const timer = setTimeout(() => {
      bridge.onservicecallback = null;
      reject(new Error('no answer from ' + uri));
    }, timeoutMs);
    bridge.onservicecallback = (message) => {
      clearTimeout(timer);
      let reply = {};
      try {
        reply = JSON.parse(message);
      } catch (error) {
        reject(new Error('unreadable answer from ' + uri));
        return;
      }
      if (reply.returnValue === false) reject(new Error(reply.errorText || reply.stderrString || 'the call failed'));
      else resolve(reply);
    };
    bridge.call(uri, JSON.stringify(params));
  });
}

/**
 * Runs @p command as root (sh -c) through the Homebrew Channel.
 * @param {string} command
 * @returns {Promise<string>} its standard output
 */
export async function runAsRoot(command) {
  const reply = await call(EXEC_URI, { command });
  return typeof reply.stdoutString === 'string' ? reply.stdoutString : '';
}

/**
 * How many lines of a long output one exec call returns. The Homebrew
 * Channel's service runs commands with Node's child_process, which refuses
 * an output above its buffer (200 KB by default on the TVs' Node): long
 * outputs are written to a file and read back in slices of short lines.
 */
const LINES_PER_SLICE = 1000;

/**
 * Runs @p command as root like runAsRoot(), for commands whose output can
 * be long (lists of apps or folders): the output goes to a temporary file,
 * read back a slice of lines at a time. Its lines must be short (well under
 * 100 characters on average), which is true of du, find and luna-send -f.
 * @param {string} command
 * @returns {Promise<string>} its standard output
 */
export async function runAsRootLong(command) {
  const file = '/tmp/webspace-' + Date.now() + '-' + Math.floor(Math.random() * 1e6) + '.out';
  const quoted = shellQuote(file);
  const lines = Number((await runAsRoot('(' + command + ') > ' + quoted + ' 2>/dev/null; wc -l < ' + quoted)).trim()) || 0;
  let output = '';
  try {
    // One slice more than the line count: the last line may have no newline.
    for (let first = 1; first <= lines + 1; first += LINES_PER_SLICE) {
      output += await runAsRoot("sed -n '" + first + ',' + (first + LINES_PER_SLICE - 1) + "p' " + quoted);
    }
  } finally {
    await runAsRoot('rm -f ' + quoted).catch(() => undefined);
  }
  return output;
}

/** Whether root commands work (the TV is rooted and the Homebrew Channel answers). */
export async function rootAvailable() {
  try {
    const output = await runAsRoot('id -u');
    return output.trim() === '0';
  } catch (error) {
    return false;
  }
}

/** Quotes @p text for a POSIX shell (single quotes). */
export function shellQuote(text) {
  return "'" + String(text).replace(/'/g, "'\\''") + "'";
}

/** Leaves the app (webOS) or does nothing (desktop browser). */
export function exitApp() {
  if (typeof window !== 'undefined' && window.PalmSystem && typeof window.PalmSystem.platformBack === 'function') {
    window.PalmSystem.platformBack();
  } else if (typeof window !== 'undefined') {
    window.close();
  }
}

/**
 * Opens a web page in the TV's browser.
 * @param {string} url
 */
export function openInBrowser(url) {
  return call('luna://com.webos.applicationManager/launch', { id: 'com.webos.app.browser', params: { target: url } });
}
