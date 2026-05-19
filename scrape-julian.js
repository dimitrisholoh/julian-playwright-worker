const { chromium } = require('playwright');
const axios = require('axios');
const crypto = require('crypto');

const SUPPLIER_NAME = 'Julian Fashion Srl';
const SUPPLIER_SLUG = 'julian-fashion';
const LIMIT_PRODUCTS = Number(process.env.LIMIT_PRODUCTS || 3);

const START_URL =
  process.env.JULIAN_START_URL ||
  'https://b2bfashion.online/206-woman';

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

function extractRetailPrice(text) {
  const match = text.match(/RETAIL PRICE\s*€?\s*([\d.,]+)/i);
  return match ? toNumber(match[1]) : null;
}

function extractFinalPrice(text) {
  const match = text.match(/FINAL PRICE\s*-?\s*\d*%?\s*€?\s*([\d.,]+)/i);
  return match ? toNumber(match[1]) : null;
}

function extractDiscountPercent(text) {
  const match = text.match(/FINAL PRICE\s*-?(\d+)%/i);
  return match ? toNumber(match[1]) : null;
}

function detectProductBlocks(text) {
  const lines = text
    .split('\n')
    .map(line => cleanText(line))
    .filter(Boolean);

  const products = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (/RETAIL PRICE/i.test(line)) {
      const block = lines.slice(Math.max(0, i - 8), i + 8);

      const brand =
        block.find(x =>
          /^[A-Z0-9 .,&'-]{3,}$/.test(x) &&
          !/RETAIL PRICE|FINAL PRICE|SIZE|QTY|STOCK|ADD TO CART|TAKE ALL/i.test(x) &&
          !/^\d+$/.test(x) &&
          !/^\d+\s?pc\.?$/i.test(x)
        ) || null;

      const code =
        block.find(x =>
          /^[A-Z0-9]{8,}$/i.test(x) &&
          !/^\d+$/.test(x)
        ) || null;

      const season =
        block.find(x =>
          /Spring Summer|Fall Winter|Sale/i.test(x)
        ) || null;

      const retailPrice = extractRetailPrice(block.join('\n'));
      const finalPrice = extractFinalPrice(block.join('\n'));
      const discountPercent = extractDiscountPercent(block.join('\n'));

      if (code || brand || retailPrice || finalPrice) {
        products.push({
          brand,
          code,
          season,
          retailPrice,
          finalPrice,
          discountPercent,
          rawBlock: block
        });
      }
    }
  }

  return products;
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

  await page.click('button[type="submit"]');
  await page.waitForLoadState('networkidle');

  console.log('Login completed');
  console.log('Current URL:', page.url());
}

async function openListing(page) {
  console.log('Opening listing page...');

  await page.goto(START_URL, {
    waitUntil: 'domcontentloaded',
    timeout: 120000
  });

  await page.waitForTimeout(15000);
  await page.mouse.wheel(0, 10000);
  await page.waitForTimeout(5000);

  console.log('Listing opened');
}

async function scrapeListingProducts(page) {
  console.log('Scraping products from listing text...');

  const quickButtons = await page.$$('.button-action.quick-view');

  console.log('Quick buttons found:', quickButtons.length);

  if (quickButtons.length > 0) {
    await quickButtons[0].click();

    console.log('Quickview clicked');

    await page.waitForTimeout(5000);
  }

  const html = await page.content();

console.log(
  'DEBUG html contains product code:',
  html.includes('1240672N295')
);

const idx = html.indexOf('1240672N295');

console.log(
  'DEBUG product code context:',
  html.slice(
    Math.max(0, idx - 1000),
    idx + 1000
  )
);

  const pageText = await page.locator('body').innerText({
    timeout: 30000
  });

  console.log('DEBUG body first 3000:', pageText.slice(0, 3000));

  const blocks = detectProductBlocks(pageText);

  console.log('Detected product blocks:', blocks.length);

  const selectedBlocks = blocks.slice(0, LIMIT_PRODUCTS);

  const products = selectedBlocks.map(item => {
    const productCode =
      item.code ||
      `${item.brand || 'unknown'}-${item.retailPrice || Date.now()}`;

    const product = {
      supplier_name: SUPPLIER_NAME,
      supplier_slug: SUPPLIER_SLUG,

      supplier_sku: null,
      supplier_product_code: cleanText(productCode),

      brand_raw: cleanText(item.brand),
      title_raw: cleanText(
        [item.brand, item.code].filter(Boolean).join(' ')
      ),

      description_raw: cleanText(item.rawBlock.join('\n')),

      gender_raw: 'Woman',
      category_raw: null,
      subcategory_raw: null,
      type_raw: null,
      color_raw: null,
      season_raw: cleanText(item.season),

      composition_raw: null,
      made_in_raw: null,
      size_and_fit_raw: null,

      supplier_retail_price: item.retailPrice,
      supplier_final_price: item.finalPrice,
      supplier_discount_percent: item.discountPercent,

      currency: 'EUR',

      is_sale: Boolean(
        item.discountPercent && item.discountPercent > 0
      ),

      supplier_product_url: null,
      listing_url: START_URL,

      product_key: `${SUPPLIER_SLUG}:${cleanText(productCode)}`,
      product_hash: makeHash(item),

      raw_json: {
        source: 'listing_text',
        raw_block: item.rawBlock
      },

      scrape_status: 'new',
      is_active: true,
      is_archived: false,
      scraped_at: new Date().toISOString()
    };

    return product;
  });

  return products;
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
      source: 'julian_listing_text_scraper',
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

      quickviewProducts.push(json);

      console.log(
        'Quickview product captured:',
        quickviewProducts.length
      );

      console.log(
        'Quickview product keys:',
        Object.keys(json)
      );
    } catch (error) {
      console.log(
        'Quickview JSON parse failed:',
        error.message
      );
    }
  }
});

  try {
    await login(page);
    await openListing(page);

    const products = await scrapeListingProducts(page);

    console.log(
  'Captured quickview responses:',
  quickviewProducts.length
);

if (quickviewProducts.length) {
  console.log(
    'First quickview full JSON:',
    JSON.stringify(quickviewProducts[0], null, 2)
  );
}

    console.log('Prepared products:', products.length);

    if (!products.length) {
      throw new Error('No products prepared');
    }

    console.log('First product preview:', JSON.stringify(products[0], null, 2));

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
