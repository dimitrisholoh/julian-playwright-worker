const { chromium } = require('playwright');
const axios = require('axios');
const crypto = require('crypto');

const SUPPLIER_NAME = 'Julian Fashion Srl';
const SUPPLIER_SLUG = 'julian-fashion';
const LIMIT_PRODUCTS = Number(process.env.LIMIT_PRODUCTS || 10);
const MAX_PAGES = Number(process.env.MAX_PAGES || 1);

const START_URL = process.env.JULIAN_START_URL || 'https://b2bfashion.online/';

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
  const target = String(name).toLowerCase().trim();

  const direct =
    product[name] ||
    product[target] ||
    product[name.replaceAll(' ', '_')] ||
    product[target.replaceAll(' ', '_')];

  if (direct) return cleanText(direct);

  const features = product.grouped_features || product.features || product.attributes || {};

  for (const [key, item] of Object.entries(features)) {
    const keyNorm = String(key).toLowerCase().trim();
    const itemName = String(item?.name || item?.group || item?.label || '').toLowerCase().trim();

    if (keyNorm === target || itemName === target) {
      return cleanText(item?.value || item?.reference || item?.name || item);
    }
  }

  return null;
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

  const finalPrice = toNumber(product.price_amount || product.price);
  const discountPercent = toNumber(product.discount_percentage);

  const imageUrls = [];

  if (Array.isArray(product.images)) {

    for (const image of product.images) {
      if (typeof image === 'string') imageUrls.push(image);
      if (image?.large?.url) imageUrls.push(image.large.url);
      if (image?.medium?.url) imageUrls.push(image.medium.url);
      if (image?.bySize?.large_default?.url) imageUrls.push(image.bySize.large_default.url);
      if (image?.url) imageUrls.push(image.url);
  }
}

if (product.cover?.large?.url) imageUrls.push(product.cover.large.url);
if (product.cover?.bySize?.large_default?.url) imageUrls.push(product.cover.bySize.large_default.url);
if (product.cover?.url) imageUrls.push(product.cover.url);

const images_raw = [...new Set(imageUrls.filter(Boolean))];
  
  return {
    supplier_name: SUPPLIER_NAME,
    supplier_slug: SUPPLIER_SLUG,

    supplier_sku: null,
    supplier_product_code: cleanText(productCode),

    brand_raw: cleanText(
      product.brand_name ||
      product.brand ||
      product.manufacturer ||
      product.designer ||
      getFeature(product, 'brand')
    ),

    title_raw: cleanText(product.name),
    description_raw: cleanText(product.description),

    gender_raw: getFeature(product, 'gender'),
    category_raw: cleanText(product.category_name || product.category),
    subcategory_raw: null,
    type_raw: getFeature(product, 'type'),
    color_raw: getFeature(product, 'color'),
    season_raw: getFeature(product, 'season'),

    composition_raw: getFeature(product, 'composition'),
    made_in_raw:
      getFeature(product, 'made in') ||
      getFeature(product, 'made_in') ||
      getFeature(product, 'country') ||
      getFeature(product, 'origin'),

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

    images_raw,
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

async function openListing(page, pageNumber = 1) {
  console.log('Opening listing page...');

  const listingUrl =
    pageNumber === 1
      ? 'https://b2bfashion.online/206-woman'
      : `https://b2bfashion.online/206-woman?page=${pageNumber}`;

  console.log('Opening URL:', listingUrl);

  await page.goto(listingUrl, {
    waitUntil: 'domcontentloaded',
    timeout: 120000
  }).catch(e => {
    console.log('Listing goto warning:', e.message);
  });

  await page.waitForTimeout(10000);

  if (!page.url().includes('/206-woman')) {
    console.log('Not on woman listing, clicking menu link...');

    await page
      .locator('a[href*="/206-woman"]')
      .first()
      .click({ force: true, timeout: 30000 })
      .catch(e => {
        console.log('Woman menu click warning:', e.message);
      });

    await page.waitForTimeout(10000);
  }

  await page.mouse.wheel(0, 15000);
  await page.waitForTimeout(5000);

  console.log('Listing opened');
  console.log('Current listing URL:', page.url());

  const productCount = await page.locator('.product-miniature').count();

  console.log('Products found on page:', productCount);

  return productCount;
}

async function clickQuickviews(page) {
  console.log('Clicking quickview buttons...');
  console.log('Current listing URL:', page.url());

  await page.waitForTimeout(5000);

  console.log('After listing URL:', page.url());
  console.log('After listing title:', await page.title());

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

  const productCount = await page.locator('.product-miniature').count();
  const limit = Math.min(productCount, LIMIT_PRODUCTS);
  const quickviewBrands = [];

  for (let i = 0; i < limit; i++) {
    try {
      const cardText = await page
        .locator('.product-miniature')
        .nth(i)
        .innerText()
        .catch(() => '');

      const cardLines = cardText
        .split('\n')
        .map(line => cleanText(line))
        .filter(Boolean);

      const cardBrand = cardLines[0] || null;
      quickviewBrands.push(cardBrand);

      console.log('Listing card brand:', i + 1, cardBrand);

      const button = page.locator('.button-action.quick-view').nth(i * 2);

      await button.evaluate(el => {
        el.scrollIntoView({
          behavior: 'instant',
          block: 'center'
        });
      });

      await page.waitForTimeout(1500);

      if (await button.isVisible()) {
        await button.click({
          force: true,
          timeout: 10000
        });

        console.log('Quickview clicked:', i + 1);

        await page.waitForTimeout(3000);

        const closeBtn = page
          .locator('.quickview .close, .modal .close, button.close')
          .first();

        if (await closeBtn.count()) {
          await closeBtn.click({ force: true }).catch(() => {});
          await page.waitForTimeout(1000);
        }
      } else {
        console.log('Button not visible:', i + 1);
      }
    } catch (error) {
      console.log('Quickview click skipped:', i + 1, error.message);
      quickviewBrands.push(null);
    }
  }

  return quickviewBrands;
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
  const allQuickviewBrands = [];

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

    for (let currentPage = 1; currentPage <= MAX_PAGES; currentPage++) {
      console.log('========================');
      console.log('PAGE:', currentPage);
      console.log('========================');

      const productCount = await openListing(page, currentPage);

      if (!productCount) {
        console.log('No products found. Stop pagination.');
        break;
      }

      const pageBrands = await clickQuickviews(page);
      allQuickviewBrands.push(...pageBrands);
    }

    const products = quickviewProducts.map((product, index) =>
      normalizeProduct({
        ...product,
        brand: allQuickviewBrands[index] || product.brand || null
      })
    );

    console.log('Captured quickview products:', quickviewProducts.length);
    console.log('Captured listing brands:', allQuickviewBrands.length);
    console.log('Prepared products:', products.length);

    if (!products.length) {
      throw new Error('No products prepared');
    }

    console.log('First product:', {
      brand_raw: products[0].brand_raw,
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
