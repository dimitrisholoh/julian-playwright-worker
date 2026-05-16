const { chromium } = require('playwright');
const fs = require('fs');

async function run() {
  const browser = await chromium.launch({
    headless: true
  });

  const page = await browser.newPage();

  console.log('Opening Julian B2B...');

  await page.goto(process.env.JULIAN_LOGIN_URL, {
    waitUntil: 'networkidle',
    timeout: 60000
  });

  console.log('Login page opened');

  await page.fill('input[type="email"]', process.env.JULIAN_EMAIL);

  await page.fill('input[type="password"]', process.env.JULIAN_PASSWORD);

  console.log('Credentials filled');

  await page.click('button[type="submit"]');

  await page.waitForLoadState('networkidle');

  console.log('Login submitted');

  const exportUrl =
    'https://b2bfashion.online/module/bbapi/get_export';

  console.log('Opening export endpoint...');

  const response = await page.goto(exportUrl, {
    waitUntil: 'networkidle',
    timeout: 120000
  });

  console.log('Export response status:', response.status());

  const csvContent = await page.textContent('body');

  fs.writeFileSync('julian-catalog.csv', csvContent);

  console.log('CSV catalog saved');

  console.log(
    'CSV size:',
    Buffer.byteLength(csvContent, 'utf8'),
    'bytes'
  );

  await page.screenshot({
    path: 'export-page.png',
    fullPage: true
  });

  console.log('Export screenshot saved');

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
