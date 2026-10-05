// Content scripts cannot be ES modules, so this one only loads the real HUD.
(() => {
  if (window.top !== window || globalThis.__webAiMonitorStarted) return;
  globalThis.__webAiMonitorStarted = true;
  import(chrome.runtime.getURL('content/hud.js'))
    .then(module => module.start())
    .catch(error => console.debug('[Web AI Monitor] page HUD not started:', error));
})();
