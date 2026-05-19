const { chromium } = require('playwright');
const axios = require('axios');
const crypto = require('crypto');

const SUPPLIER_NAME = 'Julian Fashion Srl';
const SUPPLIER_SLUG = 'julian-fashion';
const LIMIT_PRODUCTS = Number(process.env.LIMIT_PRODUCTS || 3);

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

function extractValue(text, label) {
  if (!text) return null;

  const regex = new RegExp(`${label}\\s*:?\\s*([^\\n]+)`, 'i');
  const match = text.match(regex);

  return match ? cleanText(match[1]) : null;
}

function extractRetailPrice(text) {
  const match = text.match(/RETAIL PRICE\\s*€?\\s*([\\d.,]+)/i);
  return match ? toNumber(match[1]) : null;
}

function extractFinalPrice(text) {
  const match = text.match(/FINAL PRICE\\s*-?\\s*\\d*%?\\s*€?\\s*([\\d.,]+)/i);
  return match ? toNumber(match[1]) : null;
}

async function collectLinks(page) {
  return await page.$$eval('a', links =>
    links
      .map(a => ({
        text: (a.innerText || '').trim(),
        href: a.href
      }))
      .filter(link => link.href)
  );
}

function isLikelyProductUrl(url) {
  const cleanUrl = String(url || '').toLowerCase();

  if (
    cleanUrl.includes('content/') ||
    cleanUrl.includes('new-products') ||
    cleanUrl.includes('promo') ||
    cleanUrl.includes('cat-url') ||
    cleanUrl.includes('special-condition') ||
    cleanUrl.includes('controller=') ||
    cleanUrl.includes('cart') ||
    cleanUrl.includes('login')
  ) {
    return false;
  }

  return (
    /\/\d+[-_][a-z0-9-]+\.html/i.test(cleanUrl) ||
    /\/[a-z0-9-]+\/\d+[-_][a-z0-9-]+/i.test(cleanUrl)
  );
}

async function scrapeProductPage(page, productUrl) {
  console.log('Opening product page:', productUrl);

  await page.goto(productUrl, {
    waitUntil: 'domcontentloaded',
    timeout: 120000
  });

  await page.waitForTimeout(5000);

  const pageText = await page.locator('body').innerText({
    timeout: 30000
  });

  const title =
    await page.locator('h1').first().innerText().catch(() => null);

  const brand =
    extractValue(pageText, 'BRAND') ||
    extractValue(pageText, 'Designer') ||
    null;

  const supplierProductCode =
    extractValue(pageText, 'SPU') ||
    extractValue(pageText, 'SKU') ||
    extractValue(pageText, 'Code') ||
    productUrl.split('/').filter(Boolean).pop();

  const retailPrice = extractRetailPrice(pageText);
  const supplierPrice = extractFinalPrice(pageText);

  let supplierDiscountPercent = null;

  if (retailPrice && supplierPrice && retailPrice > supplierPrice) {
    supplierDiscountPercent = Math.round(
      ((retailPrice - supplierPrice) / retailPrice) * 100
    );
  }

  const images = await page.$$eval(
    'img',
    imgs =>
      imgs
        .map(img => img.src)
        .filter(Boolean)
        .filter(src =>
          src.includes('julianfashionstorage') ||
          src.includes('/img/') ||
          src.includes('blob.core.windows.net')
        )
  );

  const uniqueImages = [...new Set(images)];

  const product = {
    supplier_name: SUPPLIER_NAME,
    supplier_sku: null,
    supplier_product_code: cleanText(supplierProductCode),

    brand_raw: cleanText(brand),
    title_raw: cleanText(title),
    description_raw: null,

    gender_raw: extractValue(pageText, 'GENDER'),
    category_raw: extractValue(pageText, 'CATEGORY'),
    subcategory_raw: null,
    type_raw: extractValue(pageText, 'TYPE'),

    color_raw:
      extractValue(pageText, 'COLOR') ||
      extractValue(pageText, 'Colour'),

    season_raw: extractValue(pageText, 'SEASON'),

    composition_raw:
      extractValue(pageText, 'COMPOSITION') ||
      extractValue(pageText, 'Material'),

    made_in_raw: extractValue(pageText, 'MADE IN'),

    size_and_fit_raw:
      extractValue(pageText, 'SIZE AND FIT') ||
      extractValue(pageText, 'Size and Fit'),

    retail_price: retailPrice,
    supplier_price: supplierPrice,
    currency: 'EUR',
    supplier_discount_percent: supplierDiscountPercent,

    is_sale: Boolean(supplierDiscountPercent && supplierDiscountPercent > 0),

    supplier_product_url: productUrl,
    listing_url: null,

    product_key: `${SUPPLIER_SLUG}:${cleanText(supplierProductCode) || productUrl}`,
    product_hash: makeHash({ productUrl, pageText }),

    raw_json: {
      product_url: productUrl,
      page_text: pageText,
      images: uniqueImages
    },

    scrape_status: 'new',
    is_active: true,
    is_archived: false,
    scraped_at: new Date().toISOString()
  };

  return product;
}

async function run() {
  const browser = await chromium.launch({
    headless: true
  });

  const page = await browser.newPage();

  try {
    console.log('Opening Julian B2B...');

    await page.goto(process.env.JULIAN_LOGIN_URL, {
      waitUntil: 'networkidle',
      timeout: 120000
    });

    console.log('Login page opened');

    await page.fill('input[type="email"]', process.env.JULIAN_EMAIL);
    await page.fill('input[type="password"]', process.env.JULIAN_PASSWORD);

    console.log('Credentials filled');

    await page.click('button[type="submit"]');
    await page.waitForLoadState('networkidle');

    console.log('Login submitted');
    console.log('Current URL:', page.url());

    console.log('Collecting links after login...');

    const links = await collectLinks(page);

    console.log('Total links found:', links.length);

    const productLinks = links
      .map(link => link.href)
      .filter(Boolean)
      .filter(isLikelyProductUrl);

    const uniqueProductLinks = [...new Set(productLinks)];

    console.log('Detected product links:', uniqueProductLinks.length);

   
  if (!uniqueProductLinks.length) {
    console.log('DEBUG page url:', page.url());

    const debugHtml = await page.locator('body').innerText().catch(() => '');
    console.log('DEBUG body text first 2000:', debugHtml.slice(0, 2000));

    console.log('DEBUG first links:', JSON.stringify(links.slice(0, 100), null, 2));

    return;
    }

    console.log('First product links:');
    console.log(JSON.stringify(uniqueProductLinks.slice(0, 10), null, 2));

    const selectedLinks = uniqueProductLinks.slice(0, LIMIT_PRODUCTS);

    const products = [];

    for (const productUrl of selectedLinks) {
      try {
        const product = await scrapeProductPage(page, productUrl);
        products.push(product);

        console.log('Product scraped:', product.supplier_product_code);
        console.log('Title:', product.title_raw);
        console.log('Retail price:', product.retail_price);
        console.log('Supplier price:', product.supplier_price);
        console.log('Composition:', product.composition_raw);
        console.log('Made in:', product.made_in_raw);
      } catch (error) {
        console.error('Product scrape failed:', productUrl, error.message);
      }
    }

    console.log('Prepared products:', products.length);

    if (!products.length) {
      throw new Error('No products prepared');
    }

    if (!process.env.N8N_WEBHOOK_URL) {
      throw new Error('N8N_WEBHOOK_URL is missing');
    }

    console.log('Sending webhook to n8n...');

    const webhookResponse = await axios.post(
      process.env.N8N_WEBHOOK_URL,
      {
        supplier_name: SUPPLIER_NAME,
        supplier_slug: SUPPLIER_SLUG,
        source: 'julian_site_first_scraper',
        scraped_at: new Date().toISOString(),
        products
      },
      {
        timeout: 120000
      }
    );

    console.log('Webhook status:', webhookResponse.status);
    console.log('Webhook sent successfully');
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

