const { chromium } = require('playwright');

const START_URL = process.env.DOUBLEF_LOGIN_URL || 'http://93.46.41.5:1995/home';
const LOGIN = process.env.DOUBLEF_LOGIN;
const PASSWORD = process.env.DOUBLEF_PASSWORD;

const TEST_BRANDS = ['GUCCI', 'ZEGNA'];
const TEST_SEASONS = ['26S', '25S'];

async function selectPopupValues(page, labelText, values) {
  console.log(`Selecting ${labelText}:`, values);

  const plusButtons = page.locator('text=+');

  if (labelText === 'Brands') {
  await plusButtons.nth(0).click({ force: true, timeout: 10000 });
  }

if (labelText === 'Season') {
  await plusButtons.nth(1).click({ force: true, timeout: 10000 });
}
  await page.waitForTimeout(1000);

  for (const value of values) {
    const search = page.locator('input[type="search"], input').last();
    await search.fill(value);
    await page.waitForTimeout(500);

    await page.locator(`text=${value}`).first().click({ force: true, timeout: 10000 });
    await page.waitForTimeout(500);
  }

  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(500);
}

async function run() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });

  try {
    console.log('Opening DoubleF...');
    await page.goto(START_URL, { waitUntil: 'domcontentloaded', timeout: 120000 });

    console.log('Current URL:', page.url());

    if (page.url().includes('/login')) {
      console.log('Login page detected');

      await page.locator('input').nth(0).fill(LOGIN);
      await page.locator('input').nth(1).fill(PASSWORD);

      await page.locator('button').first().click({ force: true });
      await page.waitForTimeout(5000);
    }

    console.log('After login URL:', page.url());
    console.log('Title:', await page.title());

    await selectPopupValues(page, 'Brands', TEST_BRANDS);
    await selectPopupValues(page, 'Season', TEST_SEASONS);

    console.log('Clicking Search...');
    await page.locator('button:has-text("Search")').click({ force: true });

    await page.waitForTimeout(10000);

    console.log('Result URL:', page.url());
    console.log('Title:', await page.title());

    const bodyText = await page.locator('body').innerText();
    console.log('Body preview:', bodyText.slice(0, 2000));

    const items = await page.locator('text=Whole Sale').count();
    const images = await page.locator('img').count();

    console.log('Wholesale blocks found:', items);
    console.log('Images found:', images);

    console.log('DoubleF filter test completed');
  } catch (error) {
    console.error('ERROR:', error.message);
  } finally {
    await browser.close();
  }
}

run();
