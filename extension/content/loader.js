// Content scripts cannot be ES modules, so this one only loads the real HUD.
(() => {
  if (window.top !== window) return;
  // The same extension may inject this again into a page it already runs on
  // (pages open before an install, update or consent are reached later).
  // A copy that is still connected stays; one from before an update or
  // reload is orphaned (earlier versions only left `true`), so this one
  // starts in its place.
  const running = globalThis.__webAiMonitorStarted;
  if (typeof running === 'function' && running()) return;
  const runtime = chrome.runtime;
  globalThis.__webAiMonitorStarted = () => {
    try {
      return Boolean(runtime?.id);
    } catch {
      return false;
    }
  };
  import(chrome.runtime.getURL('content/hud.js'))
    .then(module => module.start())
    .catch(error => console.debug('[Web AI Monitor] page HUD not started:', error));
})();
