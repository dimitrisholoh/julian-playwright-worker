const { chromium } = require('playwright');
const axios = require('axios');
const { parse } = require('csv-parse/sync');
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
  const match = text.match(/RETAIL PRICE\s*€?\s*([\d.,]+)/i);
  return match ? toNumber(match[1]) : null;
}

function extractFinalPrice(text) {
  const match = text.match(/FINAL PRICE\s*-?\s*\d*%?\s*€?\s*([\d.,]+)/i);
  return match ? toNumber(match[1]) : null;
}

async function scrapeLiveProduct(page, row) {
  const supplierProductCode = cleanText(row.cod);

  const loginUrl = new URL(process.env.JULIAN_LOGIN_URL);
  const baseUrl = `${loginUrl.protocol}//${loginUrl.host}`;

  const searchUrl =
    `${baseUrl}/index.php?controller=search&orderby=position&orderway=desc&s=${encodeURIComponent(supplierProductCode)}`;

  console.log('Opening live product search:', supplierProductCode);

  await page.goto(searchUrl, {
    waitUntil: 'domcontentloaded',
    timeout: 120000
  });

  await page.waitForTimeout(3000);

  const productLink = page.locator('a.product_img_link').first();

  if (!(await productLink.count())) {
    console.log('No product found:', supplierProductCode);
    return {};
  }

  const href = await productLink.getAttribute('href');

  if (!href) {
    console.log('No href found:', supplierProductCode);
    return {};
  }

  console.log('Opening product page:', href);

  await page.goto(href, {
    waitUntil: 'domcontentloaded',
    timeout: 120000
  });

  await page.waitForTimeout(5000);

  const pageText = await page.locator('body').innerText({
    timeout: 30000
  });

  const retailFromPage = extractRetailPrice(pageText);
  const finalFromPage = extractFinalPrice(pageText);

  let discountPercent = null;

  if (retailFromPage && finalFromPage && retailFromPage > finalFromPage) {
    discountPercent = Math.round(
      ((retailFromPage - finalFromPage) / retailFromPage) * 100
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
          src.includes('/img/')
        )
  );

  const uniqueImages = [...new Set(images)];

  const rows = await page.$$eval(
    'tr',
    trs => trs.map(tr => tr.innerText).filter(Boolean)
  ).catch(() => []);

  const variants = [];

  for (const rowText of rows) {
    const clean = rowText.replace(/\s+/g, ' ').trim();

    const sizeMatch = clean.match(/^([A-Z0-9./-]+)\s+/i);
    const qtyMatch = clean.match(/(\d+)\s*pc/i);

    if (sizeMatch || qtyMatch) {
      variants.push({
        supplier_size: sizeMatch ? sizeMatch[1] : null,
        stock_quantity: qtyMatch ? Number(qtyMatch[1]) : null,
        raw_text: clean
      });
    }
  }

  return {
    product_url: page.url(),
    page_text: pageText,

    spu: extractValue(pageText, 'SPU') || extractValue(pageText, 'SKU'),

    composition_raw:
      extractValue(pageText, 'COMPOSITION') ||
      extractValue(pageText, 'Material'),

    made_in_raw: extractValue(pageText, 'MADE IN'),

    size_and_fit_raw: extractValue(pageText, 'SIZE AND FIT'),

    type_raw:
      extractValue(pageText, 'TYPE') ||
      extractValue(pageText, 'Category'),

    color_raw:
      extractValue(pageText, 'COLOR') ||
      cleanText(row.color),

    gender_raw:
      extractValue(pageText, 'GENDER') ||
      cleanText(row.gender),

    season_raw:
      extractValue(pageText, 'SEASON') ||
      cleanText(row.season),

    supplier_retail_price: retailFromPage,
    supplier_final_price: finalFromPage,
    discount_percent: discountPercent,

    images: uniqueImages,
    variants
  };
}

function buildProduct(row, live) {
  const supplierProductCode = cleanText(row.cod);

  const csvRetailPrice = toNumber(row['retail price']);
  const csvFinalPrice = toNumber(row['discounted price']);
  const csvSupplierPriceIncVat = toNumber(row['cost price']);

  const supplierRetailPrice = live.supplier_retail_price || csvRetailPrice;
  const supplierFinalPrice = live.supplier_final_price || csvFinalPrice;

  const discountPercent =
    live.discount_percent ||
    (
      supplierRetailPrice &&
      supplierFinalPrice &&
      supplierRetailPrice > supplierFinalPrice
        ? Math.round(((supplierRetailPrice - supplierFinalPrice) / supplierRetailPrice) * 100)
        : null
    );

  return {
    supplier_name: SUPPLIER_NAME,
    supplier_sku: live.spu || null,
    supplier_product_code: supplierProductCode,

    brand_raw: cleanText(row.designer),
    title_raw: cleanText(`${cleanText(row.designer) || ''} ${supplierProductCode || ''}`),
    description_raw: cleanText(row.description),

    gender_raw: live.gender_raw || cleanText(row.gender),
    category_raw: cleanText(row.category),
    subcategory_raw: null,
    type_raw: live.type_raw || null,

    color_raw: live.color_raw || cleanText(row.color),
    season_raw: live.season_raw || cleanText(row.season),

    composition_raw: live.composition_raw || null,
    made_in_raw: live.made_in_raw || null,
    size_and_fit_raw: live.size_and_fit_raw || null,

    supplier_retail_price: supplierRetailPrice,
    supplier_final_price: supplierFinalPrice,
    supplier_price_inc_vat: csvSupplierPriceIncVat,
    supplier_price_ex_vat: null,
    vat_percent: null,
    vat_amount: null,

    currency: 'EUR',
    supplier_discount_percent: discountPercent,
    is_sale: Boolean(discountPercent && discountPercent > 0),

    supplier_product_url: live.product_url || null,
    listing_url: null,
    product_key: `${SUPPLIER_SLUG}:${supplierProductCode}`,
    product_hash: makeHash({ row, live }),

    raw_json: {
      csv: row,
      live
    },

    scrape_status: 'new',
    is_active: true,
    is_archived: false,
    scraped_at: new Date().toISOString()
  };
}

async function run() {
  const browser = await chromium.launch({
    headless: true
  });

  const page = await browser.newPage();

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

  const cookies = await page.context().cookies();

  const cookieHeader = cookies
    .map(c => `${c.name}=${c.value}`)
    .join('; ');

  console.log('Fetching export CSV...');

  const exportResponse = await axios.get(
    'https://b2bfashion.online/module/bbapi/get_export',
    {
      responseType: 'text',
      headers: {
        Cookie: cookieHeader
      },
      timeout: 120000
    }
  );

  console.log('Export status:', exportResponse.status);

  const records = parse(exportResponse.data, {
    columns: true,
    skip_empty_lines: true
  });

  console.log('Parsed rows:', records.length);

  const products = [];

  for (const row of records.slice(0, LIMIT_PRODUCTS)) {
    const live = await scrapeLiveProduct(page, row);
    const product = buildProduct(row, live);
    products.push(product);
  }

  console.log('Prepared products:', products.length);
  console.log('First product preview:', JSON.stringify(products[0], null, 2));

  console.log('Sending webhook to n8n...');

  const webhookResponse = await axios.post(
    process.env.N8N_WEBHOOK_URL,
    {
      supplier_name: SUPPLIER_NAME,
      supplier_slug: SUPPLIER_SLUG,
      source: 'julian_csv_export_plus_live_page',
      scraped_at: new Date().toISOString(),
      products
    },
    {
      timeout: 120000
    }
  );

  console.log('Webhook status:', webhookResponse.status);
  console.log('Webhook sent successfully');

  await browser.close();
}

run().catch(error => {
  console.error('Fatal error:', error.message);

  if (error.response) {
    console.error('Response status:', error.response.status);
    console.error('Response data:', error.response.data);
  }

  process.exit(1);
});

