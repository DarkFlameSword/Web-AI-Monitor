// Playwright for the preview and the store images, or, when it is not
// installed yet, how to install it instead of a module-not-found trace.
let playwright;
try {
  playwright = await import('playwright');
} catch (error) {
  if (error?.code !== 'ERR_MODULE_NOT_FOUND') throw error;
  console.error([
    'Playwright is not installed. Run these once in the project folder, then try again:',
    '',
    '  npm install',
    '  npx playwright install chromium',
  ].join('\n'));
  process.exit(1);
}

export const { chromium } = playwright;
