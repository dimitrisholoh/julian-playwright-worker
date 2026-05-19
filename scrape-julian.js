const { chromium } = require('playwright');
const axios = require('axios');
const crypto = require('crypto');

const SUPPLIER_NAME = 'Julian Fashion Srl';
const SUPPLIER_SLUG = 'julian-fashion';
const LIMIT_PRODUCTS = Number(process.env.LIMIT_PRODUCTS || 3);

const START_URL =
  process.env.JULIAN_START_URL ||
  'https://b2bfashion.online/206-woman'

function cleanText(value) {
  if (value === null || value === undefined) return null;
  const cleaned = String(value).replace(/\s+/g, ' ').trim();
  return cleaned || null;
}

function toNumber(value) {
  if (value === null || value === undefined) return null;

  const cleaned = String(value)
    .replace('€', '')
    .replace('%', '')
    .replace(',', '.')
    .replace(/[^\d.-]/g, '')
    .trim();

  const number = Number(cleaned);
  return Number.isFinite(number) ? number : null;
}

function makeHash(value) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(value))
    .digest('hex');
}

function getFeature(product, name) {
  const features = product.grouped_features || {};
  return cleanText(features[name]?.value || null);
}

function normalizeProduct(product) {
  const productCode =
    product.reference ||
    product.spu ||
    product.id_product ||
    product.id;

  const retailPrice = toNumber(
    product.price_without_reduction ||
    product.regular_price ||
    product.wholesale_price
  );

  const finalPrice = toNumber(
    product.price_amount ||
    product.price
  );

  const discountPercent = toNumber(
    product.discount_percentage
  );

  return {
    supplier_name: SUPPLIER_NAME,
    supplier_slug: SUPPLIER_SLUG,

    supplier_sku: null,
    supplier_product_code: cleanText(productCode),

    brand_raw: null,
    title_raw: cleanText(product.name),

    description_raw: cleanText(product.description),

    gender_raw: getFeature(product, 'gender'),
    category_raw: cleanText(product.category_name || product.category),
    subcategory_raw: null,
    type_raw: getFeature(product, 'type'),
    color_raw: getFeature(product, 'color'),
    season_raw: getFeature(product, 'season'),

    composition_raw: getFeature(product, 'composition'),
    made_in_raw: getFeature(product, 'made in'),
    size_and_fit_raw: getFeature(product, 'size and fit'),

    supplier_retail_price: retailPrice,
    supplier_final_price: finalPrice,
    supplier_discount_percent: discountPercent,

    currency: 'EUR',

    is_sale: Boolean(product.has_discount || discountPercent),

    supplier_product_url: cleanText(product.link || product.url),
    listing_url: START_URL,

    product_key: `${SUPPLIER_SLUG}:${cleanText(productCode)}`,
    product_hash: makeHash(product),

    raw_json: product,

    scrape_status: 'new',
    is_active: true,
    is_archived: false,
    scraped_at: new Date().toISOString()
  };
}

async function login(page) {
  console.log('Opening Julian login page...');

  await page.goto(process.env.JULIAN_LOGIN_URL, {
    waitUntil: 'networkidle',
    timeout: 120000
  });

  console.log('Login page loaded');

  await page.fill('input[type="email"]', process.env.JULIAN_EMAIL);
  await page.fill('input[type="password"]', process.env.JULIAN_PASSWORD);

  console.log('Credentials filled');

  await page.keyboard.press('Enter');
  await page.waitForLoadState('networkidle');

  console.log('Login completed');
  console.log('Current URL:', page.url());
}

async function openListing(page) {
  console.log('Opening listing page...');

  try {
    await page.goto(START_URL, {
      waitUntil: 'domcontentloaded',
      timeout: 120000
    });
  } catch (error) {
    console.log('Listing goto warning:', error.message);
  }

  await page.waitForTimeout(10000);

  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(10000);

  console.log('Listing opened');
}

async function clickQuickviews(page) {
  console.log('Clicking quickview buttons...');
  
  console.log('Current listing URL:', page.url());

  console.log(
    'Body text preview:',
  (await page.locator('body').innerText()).slice(0, 1000)
  );

  await page.waitForTimeout(30000);

  console.log('After listing URL:', page.url());
  console.log('After listing title:', await page.title());

  console.log(
    'Quick view text exists:',
    (await page.locator('body').innerText()).includes('Quick view')
  );
  
  console.log(
    'Product miniature count:',
    await page.locator('.product-miniature').count()
  );

  console.log(
    'Any button-action count:',
    await page.locator('.button-action').count()
  );
  
  const quickButtons = await page.$$(
    '.button-action.quick-view, a.quick-view, [title="Quick view"]'
  );
  
  console.log(
    'Quick view elements:',
    await page.locator('.quick-view').count()
  );
  
  console.log('Quick buttons found:', quickButtons.length);

  const limit = Math.min(quickButtons.length, LIMIT_PRODUCTS);

  for (let i = 0; i < limit; i++) {
    await quickButtons[i].click();
    console.log('Quickview clicked:', i + 1);
    await page.waitForTimeout(3000);
  }
}

async function sendWebhook(products) {
  if (!process.env.N8N_WEBHOOK_URL) {
    throw new Error('N8N_WEBHOOK_URL is missing');
  }

  console.log('Sending webhook to n8n...');

  const response = await axios.post(
    process.env.N8N_WEBHOOK_URL,
    {
      supplier_name: SUPPLIER_NAME,
      supplier_slug: SUPPLIER_SLUG,
      source: 'julian_quickview_scraper',
      scraped_at: new Date().toISOString(),
      products
    },
    {
      timeout: 120000
    }
  );

  console.log('Webhook status:', response.status);
  console.log('Webhook sent successfully');
}

async function run() {
  const browser = await chromium.launch({
    headless: true
  });

  const page = await browser.newPage();

  const quickviewProducts = [];

  page.on('response', async (response) => {
    const url = response.url();

    if (
      url.includes('controller=product') &&
      url.includes('action=quickview')
    ) {
      try {
        const json = await response.json();

        if (json.product) {
          quickviewProducts.push(json.product);

          console.log(
            'Quickview captured:',
            json.product.name || 'NO_NAME',
            json.product.reference || 'NO_REF'
          );
        }
      } catch (error) {
        console.log('Quickview JSON parse failed:', error.message);
      }
    }
  });

  try {
    await login(page);
    await openListing(page);
    await clickQuickviews(page);

    const products = quickviewProducts
      .slice(0, LIMIT_PRODUCTS)
      .map(normalizeProduct);

    console.log('Captured quickview products:', quickviewProducts.length);
    console.log('Prepared products:', products.length);

    if (!products.length) {
      throw new Error('No products prepared');
    }

    console.log('First product:', {
      title_raw: products[0].title_raw,
      supplier_product_code: products[0].supplier_product_code,
      supplier_retail_price: products[0].supplier_retail_price,
      supplier_final_price: products[0].supplier_final_price,
      color_raw: products[0].color_raw,
      composition_raw: products[0].composition_raw,
      made_in_raw: products[0].made_in_raw,
      size_and_fit_raw: products[0].size_and_fit_raw
    });

    await sendWebhook(products);
  } finally {
    await browser.close();
  }
}

run().catch(error => {
  console.error('Fatal error:', error.message);

  if (error.response) {
    console.error('Response status:', error.response.status);
    console.error('Response data:', error.response.data);
  }

  process.exit(1);
});
