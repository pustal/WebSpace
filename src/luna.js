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
