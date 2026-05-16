const { chromium } = require('playwright');
const fs = require('fs');

async function run() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  console.log('Opening Julian B2B...');

  await page.goto(process.env.JULIAN_LOGIN_URL, {
    waitUntil: 'domcontentloaded',
    timeout: 60000
  });

  console.log('Login page opened');

  await page.fill('input[type="email"]', process.env.JULIAN_EMAIL);
  await page.fill('input[type="password"]', process.env.JULIAN_PASSWORD);

  console.log('Credentials filled');

  await page.click('button[type="submit"]');
  await page.waitForLoadState('domcontentloaded');

  console.log('Login submitted');

  await page.context().storageState({ path: 'julian-session.json' });
  console.log('Session saved');

  const exportUrl = 'https://b2bfashion.online/module/bbapi/get_export';

  console.log('Fetching export CSV...');

  const result = await page.evaluate(async (url) => {
    const response = await fetch(url, {
      method: 'GET',
      credentials: 'include'
    });

    const text = await response.text();

    return {
      status: response.status,
      contentType: response.headers.get('content-type'),
      text
    };
  }, exportUrl);

  console.log('Export response status:', result.status);
  console.log('Export content type:', result.contentType);

  fs.writeFileSync('julian-catalog.csv', result.text);

  console.log('CSV catalog saved');
  console.log('CSV size:', Buffer.byteLength(result.text, 'utf8'), 'bytes');
  console.log('CSV preview:', result.text.slice(0, 500));

  await browser.close();
}

run()
  .then(() => {
    console.log('Julian export finished successfully');
    setInterval(() => {}, 1000);
  })
  .catch((error) => {
    console.error('Export failed:', error);
    process.exit(1);
  });
