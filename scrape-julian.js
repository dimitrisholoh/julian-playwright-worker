const { chromium } = require('playwright');
const axios = require('axios');
const { parse } = require('csv-parse/sync');
const crypto = require('crypto');

const SUPPLIER_NAME = 'Julian Fashion Srl';
const SUPPLIER_SLUG = 'julian-fashion';

function cleanText(value) {
  if (value === undefined || value === null) return null;
  const cleaned = String(value).trim();
  return cleaned.length ? cleaned : null;
}

function toNumber(value) {
  if (value === undefined || value === null || value === '') return null;

  const cleaned = String(value)
    .replace(',', '.')
    .replace(/[^\d.-]/g, '');

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
  const regex = new RegExp(`${label}\\s*:?\\s*([^\\n\\r]+)`, 'i');
  const match = text.match(regex);
  return match ? cleanText(match[1]) : null;
}

function extractFinalPrice(text) {
  const match = text.match(/FINAL PRICE\s*-?\s*(\d+)%?\s*€?\s*([\d.,]+)/i);
  if (!match) return null;

  return {
    discount_percent: toNumber(match[1]),
    final_price: toNumber(match[2])
  };
}

function extractRetailPrice(text) {
  const match = text.match(/RETAIL PRICE\s*€?\s*([\d.,]+)/i);
  return match ? toNumber(match[1]) : null;
}

async function scrapeLiveProduct(page, row) {
  const supplierProductCode = cleanText(row.cod);
  const loginUrl = new URL(process.env.JULIAN_LOGIN_URL);
  const baseUrl = `${loginUrl.protocol}//${loginUrl.host}`;

  const searchUrl =
    `${baseUrl}/index.php?controller=search&orderby=position&orderway=desc&s=${encodeURIComponent(supplierProductCode)}&submit_search=`;

  console.log('Opening live product search:', supplierProductCode);

  await page.goto(searchUrl, {
    waitUntil: 'networkidle',
    timeout: 60000
  });

  await page.waitForTimeout(2000);

  const pageText = await page.locator('body').innerText({ timeout: 30000 });

  const retailFromPage = extractRetailPrice(pageText);
  const finalFromPage = extractFinalPrice(pageText);

  const composition = extractValue(pageText, 'COMPOSITION');
  const madeIn = extractValue(pageText, 'MADE IN');
  const sizeAndFit = extractValue(pageText, 'SIZE AND FIT');
  const type = extractValue(pageText, 'TYPE');
  const color = extractValue(pageText, 'COLOR');
  const gender = extractValue(pageText, 'GENDER');
  const season = extractValue(pageText, 'SEASON');
  const spu = extractValue(pageText, 'SPU');

  const images = await page.$$eval('img', imgs =>
    imgs
      .map(img => img.src)
      .filter(Boolean)
      .filter(src => src.includes('julianfashionstorage') || src.includes('/img/'))
  );

  const uniqueImages = [...new Set(images)].filter(src =>
    src.toLowerCase().includes(String(supplierProductCode).toLowerCase())
  );

  const sizes = await page.$$eval('tr', rows =>
    rows
      .map(row => row.innerText)
      .filter(Boolean)
  ).catch(() => []);

  const detectedVariants = [];

  for (const rowText of sizes) {
    const clean = rowText.replace(/\s+/g, ' ').trim();

    const sizeMatch = clean.match(/^([A-Z0-9./-]+)\s+/i);
    const qtyMatch = clean.match(/(\d+)\s*pc/i);

    if (sizeMatch || qtyMatch) {
      detectedVariants.push({
        supplier_size: sizeMatch ? sizeMatch[1] : null,
        stock_quantity: qtyMatch ? Number(qtyMatch[1]) : null,
        raw_text: clean
      });
    }
  }

  return {
    product_url: page.url(),
    page_text: pageText,

    spu,
    composition_raw: composition,
    made_in_raw: madeIn,
    size_and_fit_raw: sizeAndFit,
    type_raw: type,
    color_raw: color,
    gender_raw: gender,
    season_raw: season,

    supplier_retail_price: retailFromPage,
    supplier_final_price: finalFromPage?.final_price || null,
    discount_percent: finalFromPage?.discount_percent || null,

    images: uniqueImages,
    variants: detectedVariants
  };
}

function buildProduct(row, live) {
  const supplierProductCode = cleanText(row.cod);

  const csvRetailPrice = toNumber(row['retail price']);
  const csvSupplierPrice = toNumber(row['discounted price']) || toNumber(row['cost price']);

  const retailPrice = live.supplier_retail_price || csvRetailPrice;
  const supplierPrice = live.supplier_final_price || csvSupplierPrice;

  const supplierDiscountPercent =
    live.discount_percent ||
    (
      retailPrice && supplierPrice && retailPrice > supplierPrice
        ? Math.round(((retailPrice - supplierPrice) / retailPrice) * 100)
        : null
    );

  const seasonRaw = live.season_raw || cleanText(row.season);

  return {
    supplier_name: SUPPLIER_NAME,
    supplier_sku: live.spu || null,
    supplier_product_code: supplierProductCode,

    brand_raw: cleanText(row.designer),
    title_raw: cleanText(`${cleanText(row.designer) || ''} ${supplierProductCode || ''}`),
    description_raw: cleanText(row.description),

    composition_raw: live.composition_raw || null,
    color_raw: live.color_raw || cleanText(row.color),
    gender_raw: live.gender_raw || cleanText(row.gender),
    category_raw: cleanText(row.category),
    subcategory_raw: null,
    type_raw: live.type_raw || null,
    sizes_raw: row.size ? [cleanText(row.size)] : null,
    made_in_raw: live.made_in_raw || null,
    season_raw: seasonRaw,

    supplier_price: supplierPrice,
    retail_price: retailPrice,
    currency: 'EUR',
    supplier_discount_percent: supplierDiscountPercent,

    is_sale:
      seasonRaw?.toLowerCase().includes('sale') ||
      Boolean(supplierDiscountPercent && supplierDiscountPercent > 0),

    is_archived: false,
    is_active: true,
    scrape_status: 'new',

    raw_json: {
      csv: row,
      live
    },

    raw_hash: makeHash(row),
    product_hash: makeHash({ row, live }),

    supplier_product_url: live.product_url || null,
    listing_url: null,
    product_key: `${SUPPLIER_SLUG}:${supplierProductCode}`,

    scraped_at: new Date().toISOString()
  };
}

function buildVariants(row, live) {
  const supplierProductCode = cleanText(row.cod);

  const liveVariants = Array.isArray(live.variants) && live.variants.length
    ? live.variants
    : [
        {
          supplier_size: cleanText(row.size),
          stock_quantity: toNumber(row.qty),
          raw_text: null
        }
      ];

  return liveVariants
    .filter(variant => variant.supplier_size)
    .map(variant => ({
      supplier_name: SUPPLIER_NAME,
      supplier_product_code: supplierProductCode,
      supplier_sku: live.spu || null,
      supplier_variant_code: null,

      supplier_size: variant.supplier_size,
      stock_quantity: variant.stock_quantity,
      is_available:
        variant.stock_quantity === null || variant.stock_quantity === undefined
          ? null
          : variant.stock_quantity > 0,

      retail_price: live.supplier_retail_price || toNumber(row['retail price']),
      supplier_price: toNumber(row['cost price']),
      final_price: live.supplier_final_price || toNumber(row['discounted price']),
      currency: 'EUR',
      discount_percent: live.discount_percent || null,

      raw_variant_json: {
        csv: row,
        live_variant: variant
      },

      scraped_at: new Date().toISOString()
    }));
}

function buildImages(row, live) {
  const supplierProductCode = cleanText(row.cod);

  const imageSources = live.images && live.images.length
    ? live.images
    : [
        cleanText(row.foto1),
        cleanText(row.foto2),
        cleanText(row['foto 3'])
      ].filter(Boolean);

  return imageSources.map((imageUrl, index) => ({
    supplier_name: SUPPLIER_NAME,
    supplier_product_code: supplierProductCode,

    image_url: imageUrl,
    image_position: index + 1,
    image_type: index === 0 ? 'main' : 'gallery',
    is_main: index === 0,
    is_valid: null,

    raw_image_json: {
      image_url: imageUrl,
      source: live.images && live.images.length ? 'live_product_page' : 'csv'
    },

    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  }));
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
      timeout: 60000
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
      .map(cookie => `${cookie.name}=${cookie.value}`)
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

    const csvText = exportResponse.data;

    console.log('CSV size:', csvText.length, 'bytes');

    const records = parse(csvText, {
      columns: true,
      skip_empty_lines: true,
      bom: true,
      relax_quotes: true,
      relax_column_count: true
    });

    console.log('Parsed rows:', records.length);

    const limit = Number(process.env.PRODUCT_LIMIT || 3);
    const selectedRecords = records.slice(0, limit);

    const products = [];
    const variants = [];
    const images = [];

    for (const row of selectedRecords) {
      const supplierProductCode = cleanText(row.cod);

      try {
        const live = await scrapeLiveProduct(page, row);

        console.log('Live product scraped:', supplierProductCode);
        console.log('Composition:', live.composition_raw);
        console.log('Made in:', live.made_in_raw);
        console.log('Retail:', live.supplier_retail_price);
        console.log('Final:', live.supplier_final_price);
        console.log('Discount:', live.discount_percent);
        console.log('Images:', live.images.length);
        console.log('Variants:', live.variants.length);

        products.push(buildProduct(row, live));
        variants.push(...buildVariants(row, live));
        images.push(...buildImages(row, live));
      } catch (error) {
        console.error('Live scrape failed for:', supplierProductCode, error.message);

        const fallbackLive = {
          product_url: null,
          composition_raw: null,
          made_in_raw: null,
          size_and_fit_raw: null,
          type_raw: null,
          color_raw: null,
          gender_raw: null,
          season_raw: null,
          supplier_retail_price: null,
          supplier_final_price: null,
          discount_percent: null,
          images: [],
          variants: []
        };

        products.push(buildProduct(row, fallbackLive));
        variants.push(...buildVariants(row, fallbackLive));
        images.push(...buildImages(row, fallbackLive));
      }
    }

    console.log('Prepared products:', products.length);
    console.log('Prepared variants:', variants.length);
    console.log('Prepared images:', images.length);

    if (!process.env.N8N_WEBHOOK_URL) {
      throw new Error('N8N_WEBHOOK_URL is missing');
    }

    console.log('Sending webhook to n8n...');

    const webhookResponse = await axios.post(
      process.env.N8N_WEBHOOK_URL,
      {
        supplier_name: SUPPLIER_NAME,
        supplier_slug: SUPPLIER_SLUG,
        source: 'julian_live_product_page',
        scraped_at: new Date().toISOString(),
        products,
        variants,
        images
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
    console.error('Response data:', JSON.stringify(error.response.data, null, 2));
  }

  process.exit(1);
});
