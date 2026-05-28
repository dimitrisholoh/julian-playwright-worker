const { chromium } = require('playwright');

(async () => {
  console.log('Starting DoubleF scraper...');

  const browser = await chromium.launch({
    headless: true
  });

  const page = await browser.newPage();

  try {
    const url = process.env.DOUBLEF_LOGIN_URL;
    const email = process.env.DOUBLEF_EMAIL;
    const password = process.env.DOUBLEF_PASSWORD;

    console.log('Opening login page...');
    await page.goto(url, {
      waitUntil: 'networkidle',
      timeout: 120000
    });

    console.log('Current URL:', page.url());

    await page.fill('input[type="text"]', email);
    await page.fill('input[type="password"]', password);

    console.log('Credentials filled');

    await page.click('button');

    await page.waitForTimeout(5000);

    console.log('After login URL:', page.url());

    const title = await page.title();
    console.log('Title:', title);

    const bodyText = await page.locator('body').innerText();

    console.log('===== PAGE PREVIEW =====');
    console.log(bodyText.slice(0, 5000));

    const links = await page.locator('a').count();
    const buttons = await page.locator('button').count();
    const inputs = await page.locator('input').count();

    console.log('===== COUNTS =====');
    console.log('Links:', links);
    console.log('Buttons:', buttons);
    console.log('Inputs:', inputs);

    console.log('DoubleF login test completed');

  } catch (error) {
    console.error('ERROR:', error);
  }

  await browser.close();
})();
