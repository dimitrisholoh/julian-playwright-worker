const { chromium } = require('playwright');

(async () => {
  console.log('Starting DoubleF scraper...');

  const browser = await chromium.launch({
    headless: true
  });

  const page = await browser.newPage();

  try {
    const url = process.env.DOUBLEF_LOGIN_URL;

    console.log('Opening page...');
    console.log('URL:', url);

    await page.goto(url, {
      waitUntil: 'networkidle',
      timeout: 120000
    });

    console.log('Current URL:', page.url());

    const title = await page.title();
    console.log('Title:', title);

    const bodyText = await page.locator('body').innerText();

    console.log('===== PAGE PREVIEW =====');
    console.log(bodyText.slice(0, 5000));

    const inputs = await page.locator('input').count();
    const selects = await page.locator('select').count();
    const buttons = await page.locator('button').count();

    console.log('===== ELEMENT COUNTS =====');
    console.log('Inputs:', inputs);
    console.log('Selects:', selects);
    console.log('Buttons:', buttons);

    console.log('DoubleF test completed');

  } catch (error) {
    console.error('ERROR:', error);
  }

  await browser.close();
})();
