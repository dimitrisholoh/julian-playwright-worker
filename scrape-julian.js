const { chromium } = require('playwright');

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

  await page.screenshot({
    path: 'login-success.png'
  });

  console.log('Screenshot saved');

  await browser.close();
}

run()
  .then(() => {
    console.log('Julian scraper finished successfully');
    setInterval(() => {}, 1000);
  })
  .catch((error) => {
    console.error('Scraper failed:', error);
    process.exit(1);
  });
