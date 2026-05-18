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

function buildProduct(row) {
  const supplierProductCode = cleanText(row.cod);

  const supplierRetailPrice = toNumber(row['retail price']);
  const supplierFinalPrice = toNumber(row['discounted price']);
  const supplierPriceIncVat = toNumber(row['cost price']);

  const discountPercent =
    supplierRetailPrice && supplierFinalPrice && supplierRetailPrice > supplierFinalPrice
      ? Math.round(((supplierRetailPrice - supplierFinalPrice) / supplierRetailPrice) * 100)
      : null;

  const seasonRaw = cleanText(row.season);

  const isSale =
    seasonRaw?.toLowerCase().includes('sale') ||
    Boolean(discountPercent && discountPercent > 0);

  return {
    supplier_name: SUPPLIER_NAME,

    supplier_product_id: null,
    supplier_product_code: supplierProductCode,
    supplier_sku: null,

    brand_raw: cleanText(row.designer),
    title_raw: cleanText(`${cleanText(row.designer) || ''} ${supplierProductCode || ''}`),
    description_raw: cleanText(row.description),

    gender_raw: cleanText(row.gender),
    category_raw: cleanText(row.category),
    subcategory_raw: null,
    type_raw: null,
    color_raw: cleanText(row.color),
    season_raw: seasonRaw,

    composition_raw: null,
    made_in_raw: null,
    size_and_fit_raw: null,

    supplier_retail_price: supplierRetailPrice,
    supplier_final_price: supplierFinalPrice,
    supplier_price_inc_vat: supplierPriceIncVat,
    supplier_price_ex_vat: null,
    vat_percent: null,
    vat_amount: null,

    currency: 'EUR',
    discount_percent: discountPercent,

    is_sale: isSale,

    product_url: null,
    listing_url: null,

    product_key: `${SUPPLIER_SLUG}:${supplierProductCode}`,
    product_hash: makeHash(row),

    raw_json: row,

    scrape_status: 'new',
    is_active: true,
    is_archived: false,

    scraped_at: new Date().toISOString()
  };
}

function buildVariants(row) {
  const supplierProductCode = cleanText(row.cod);
  const supplierSize = cleanText(row.size);
  const quantity = toNumber(row.qty);

  if (!supplierSize) return [];

  return [
    {
      supplier_name: SUPPLIER_NAME,
      supplier_product_code: supplierProductCode,
      supplier_sku: null,
      supplier_variant_code: null,

      supplier_size: supplierSize,
      stock_quantity: quantity,
      is_available: quantity === null ? null : quantity > 0,

      retail_price: toNumber(row['retail price']),
      supplier_price: toNumber(row['cost price']),
      final_price: toNumber(row['discounted price']),
      currency: 'EUR',
      discount_percent: null,

      raw_variant_json: row,
      scraped_at: new Date().toISOString()
    }
  ];
}

function buildImages(row) {
  const supplierProductCode = cleanText(row.cod);

  return [
    { url: cleanText(row.foto1), column: 'foto1' },
    { url: cleanText(row.foto2), column: 'foto2' },
    { url: cleanText(row['foto 3']), column: 'foto 3' }
  ]
    .filter(image => Boolean(image.url))
    .map((image, index) => ({
      supplier_name: SUPPLIER_NAME,
      supplier_product_code: supplierProductCode,

      image_url: image.url,
      image_position: index + 1,
      image_type: index === 0 ? 'main' : 'gallery',
      is_main: index === 0,
      is_valid: null,

      raw_image_json: {
        image_url: image.url,
        source_column: image.column
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

    const limit = Number(process.env.PRODUCT_LIMIT || 10);
    const selectedRecords = records.slice(0, limit);

    const products = selectedRecords.map(buildProduct);
    const variants = selectedRecords.flatMap(buildVariants);
    const images = selectedRecords.flatMap(buildImages);

    console.log('Prepared products:', products.length);
    console.log('Prepared variants:', variants.length);
    console.log('Prepared images:', images.length);

    console.log('First product preview:', JSON.stringify(products[0], null, 2));
    console.log('First variant preview:', JSON.stringify(variants[0], null, 2));
    console.log('First image preview:', JSON.stringify(images[0], null, 2));

    if (!process.env.N8N_WEBHOOK_URL) {
      throw new Error('N8N_WEBHOOK_URL is missing');
    }

    console.log('Sending webhook to n8n...');

    const webhookResponse = await axios.post(
      process.env.N8N_WEBHOOK_URL,
      {
        supplier_name: SUPPLIER_NAME,
        supplier_slug: SUPPLIER_SLUG,
        source: 'julian_csv_export',
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
