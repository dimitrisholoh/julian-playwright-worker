const { chromium } = require('playwright');

async function run() {
  const browser = await chromium.launch({
    headless: true
  });

  const page = await browser.newPage();

  await page.goto('https://b2bfashion.online', {
    waitUntil: 'networkidle',
    timeout: 60000
  });

  console.log('Julian B2B opened successfully');

  await browser.close();
}

run()
  .then(() => {
    console.log('Scraper test completed');
    setInterval(() => {}, 1000);
  })
  .catch((error) => {
    console.error('Scraper failed:', error);
    process.exit(1);
  });
