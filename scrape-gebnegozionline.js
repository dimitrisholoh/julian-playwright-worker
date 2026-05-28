const { chromium } = require('playwright');

const START_URL = process.env.GEBNEGOZIONLINE_LOGIN_URL || 'http://93.46.41.5:1995/home';
const LOGIN = process.env.EBNEGOZIONLINE_LOGIN;
const PASSWORD = process.env.GEBNEGOZIONLINE_PASSWORD;

const TEST_BRANDS = ['GUCCI', 'ZEGNA'];
const TEST_SEASONS = ['26S', '25S'];

async function selectPopupValues(page, labelText, values) {
  console.log(`Selecting ${labelText}:`, values);

  const label = page.locator(`text=${labelText}`).first();
  const box = await label.boundingBox();

  if (!box) {
    throw new Error(`${labelText} label not found`);
  }

  await page.mouse.click(box.x + 190, box.y + 10);
  await page.waitForTimeout(1000);

  for (const value of values) {
    const search = page
      .locator('input[type="search"]:visible')
      .last();

    await search.waitFor({ state: 'visible', timeout: 10000 });
    await search.click({ force: true });
    await search.fill(value);
    await page.waitForTimeout(500);

    await page
      .locator('.dataTables_scrollBody, table, .modal')
      .locator(`text="${value}"`)
      .first()
      .click({ force: true, timeout: 10000 });
   
    await page.waitForTimeout(500);
  }

  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(500);
}

async function run() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });

  try {
    console.log('Opening Gebnegozionline...');
    await page.goto(START_URL);

    await page.fill('input[type="text"]', LOGIN);
    await page.fill('input[type="password"]', PASSWORD);

    await page.click('button[type="submit"], input[type="submit"], button:has-text("Login")', {
      force: true,
      timeout: 10000
    });

    await page.waitForTimeout(5000);

    console.log('After login URL:', page.url());
    console.log('After login title:', await page.title());

    await selectPopupValues(page, 'Brands', TEST_BRANDS);

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

    const products = [
      {
        supplier_name: 'Gebnegozionline',
        supplier_slug: 'gebnegozionline',
        supplier_sku: null,
        supplier_product_code: 'GEBNE_TEST_001',

        brand_raw: 'TEST',
        title_raw: 'Gebne test product',
        description_raw: null,

        gender_raw: null,
        category_raw: null,
        subcategory_raw: null,
        type_raw: null,
        color_raw: null,
        season_raw: null,

        composition_raw: null,
        made_in_raw: null,
        size_and_fit_raw: null,

        supplier_retail_price: null,
        supplier_final_price: null,
        supplier_discount_percent: null,

        currency: 'EUR',
        is_sale: false,

        supplier_product_url: page.url(),
        listing_url: page.url(),

        product_key: 'gebnegozionline:GEBNE_TEST_001',
        product_hash: 'gebnegozionline_test_001',

        images_raw: [],
        raw_json: {
          result_url: page.url(),
          body_preview: bodyText.slice(0, 2000)
        },

        scrape_status: 'new',
        is_active: true,
        is_archived: false,
        scraped_at: new Date().toISOString()
      }
    ];

    console.log('Sending webhook to n8n...');

    await fetch(process.env.N8N_WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        products
      })
    });

    console.log('Webhook sent successfully');

    console.log('DoubleF filter test completed');
  } catch (error) {
    console.error('ERROR:', error.message);
  } finally {
    await browser.close();
  }
}

run();
