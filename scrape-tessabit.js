const { chromium } = require('playwright');

const START_URL =
  process.env.TESSABIT_START_URL ||
  'https://www.tessabit.com/en-US/woman/new';

async function run() {
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage'
    ]
  });

  const page = await browser.newPage();

  try {
    console.log('Opening Tessabit page...');
    console.log('URL:', START_URL);

    await page.goto(START_URL, {
      waitUntil: 'domcontentloaded',
      timeout: 120000
    });

    await page.waitForTimeout(10000);

    console.log('Current URL:', page.url());
    console.log('Title:', await page.title());

    const bodyText = await page.locator('body').innerText().catch(() => '');
    console.log('Body preview:', bodyText.slice(0, 2500));

    const selectors = [
      '[data-testid*="product"]',
      '[class*="product"]',
      '[class*="Product"]',
      '[class*="card"]',
      '[class*="Card"]',
      'article',
      'li'
    ];

    for (const selector of selectors) {
      const count = await page.locator(selector).count().catch(() => 0);
      console.log('Selector count:', selector, count);
    }

    const links = await page.locator('a').evaluateAll(items =>
      items.slice(0, 80).map(a => ({
        text: a.innerText,
        href: a.href
      }))
    ).catch(() => []);

    console.log('Links sample:', JSON.stringify(links, null, 2));

    const images = await page.locator('img').evaluateAll(items =>
      items.slice(0, 40).map(img => ({
        src: img.src,
        alt: img.alt
      }))
    ).catch(() => []);

    console.log('Images sample:', JSON.stringify(images, null, 2));

  } finally {
    await browser.close();
  }
}

run().catch(error => {
  console.error('Fatal error:', error.message);
  process.exit(1);
});
