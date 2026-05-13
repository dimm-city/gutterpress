import puppeteer from 'puppeteer-core';

const browser = await puppeteer.launch({
  headless: true,
  executablePath: '/usr/bin/google-chrome',
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
});

const page = await browser.newPage();
page.on('console', async (msg) => {
  const args = await Promise.all(msg.args().map(async (arg) => {
    try {
      return await arg.jsonValue();
    } catch {
      return String(arg);
    }
  }));
  console.log('[console:' + msg.type() + ']', msg.text(), args.length ? JSON.stringify(args) : '');
});
page.on('pageerror', (err) => {
  console.log('[pageerror]', err.stack || err.message);
});
page.on('requestfailed', (req) => {
  console.log('[requestfailed]', req.url(), req.failure()?.errorText || 'unknown');
});

await page.goto('http://127.0.0.1:3847/index.html', { waitUntil: 'load', timeout: 120000 });
await new Promise((resolve) => setTimeout(resolve, 15000));

const info = await page.evaluate(async () => {
  const iframe = document.querySelector('#preview-iframe');
  const result = {
    iframeExists: !!iframe,
    iframeSrc: iframe?.getAttribute('src') || null,
    iframeLoaded: false,
    rendered: false,
    totalPages: null,
    bodyText: document.body.innerText.slice(0, 1000),
  };
  if (!iframe || !iframe.contentWindow) return result;
  result.iframeLoaded = true;
  try {
    const win = iframe.contentWindow;
    result.rendered = !!win.__PAGED_RENDERED__;
    result.totalPages = typeof win.previewAPI?.getTotalPages === 'function' ? win.previewAPI.getTotalPages() : null;
    result.iframeBodyText = win.document.body ? win.document.body.innerText.slice(0, 1000) : null;
    result.orphanPages = win.document.querySelectorAll('.pagedjs_page[data-orphan-page="true"]').length;
    result.pages = win.document.querySelectorAll('.pagedjs_page').length;
  } catch (error) {
    result.evalError = String(error);
  }
  return result;
});

console.log('[eval]', JSON.stringify(info, null, 2));

await browser.close();
