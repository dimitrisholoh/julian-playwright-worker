const { chromium } = require('playwright');
const crypto = require('crypto');

const SUPPLIER_NAME = 'Gebnegozionline';
const SUPPLIER_SLUG = 'gebnegozionline';

const START_URL =
  process.env.GEBNEGOZIONLINE_LOGIN_URL || 'http://93.46.41.5:1995/home';

const LOGIN = process.env.GEBNEGOZIONLINE_LOGIN;
const PASSWORD = process.env.GEBNEGOZIONLINE_PASSWORD;

const TEST_BRANDS = ['GUCCI', 'ZEGNA'];
const TEST_SEASONS = ['26S', '25S'];

function cleanText(value) {
  if (value === null || value === undefined) return null;
  const cleaned = String(value).replace(/\s+/g, ' ').trim();
  return cleaned || null;
}

function toNumber(value) {
  if (value === null || value === undefined) return null;

  const cleaned = String(value)
    .replace('€', '')
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

function extractPrice(text, label) {
  const regex = new RegExp(`${label}:\\s*€\\s*([\\d.,]+)`, 'i');
  const match = text.match(regex);
  return match ? toNumber(match[1]) : null;
}

function detectBrand(lines) {
  return lines.find(line => TEST_BRANDS.includes(line)) || null;
}

function detectCode(lines) {
  return (
    lines.find(line =>
      /^[A-Z0-9]{5,}[A-Z0-9\s./-]*\d{2,}$/i.test(line) &&
      !line.includes('€')
    ) || null
  );
}

function detectSeason(lines) {
  return lines.find(line => /^[0-9]{2}[SW]$/.test(line) || line === 'Continuativo') || null;
}

function detectMadeIn(lines) {
  const countries = ['ITALY', 'ITA', 'ROMANIA', 'TURKIYE', 'TURKEY', 'CHINA', 'JAPAN', 'KOREA'];
  return lines.find(line => countries.includes(line.toUpperCase())) || null;
}

function detectComposition(lines) {
  return (
    lines.find(line =>
      /Exterior|Lining|Sole|Cotton|Leather|Linen|Silk|Nylon|Polyester|Cashmere|Elastane/i.test(line)
    ) || null
  );
}

function buildVariants(lines, productCode, retailPrice, finalPrice) {
  const variants = [];

  const warehouseIndex = lines.findIndex(line =>
    line.toLowerCase().includes('warehouse stock')
  );

  if (warehouseIndex === -1) return variants;

  for (let i = warehouseIndex + 1; i < lines.length; i++) {
    const line = cleanText(lines[i]);
    if (!line) continue;

    if (
      line.includes('Whole Sale') ||
      line.includes('Retail') ||
      line.includes('Exterior') ||
      line.includes('Lining') ||
      TEST_BRANDS.includes(line)
    ) {
      break;
    }

    if (/^[A-Z0-9./+-]{1,10}$/.test(line)) {
      variants.push({
        supplier_name: SUPPLIER_NAME,
        supplier_slug: SUPPLIER_SLUG,
        supplier_product_code: productCode,
        supplier_sku: `${productCode}-${line}`,
        supplier_variant_code: null,
        supplier_size: line,
        stock_quantity: 1,
        supplier_retail_price: retailPrice,
        supplier_final_price: finalPrice,
        supplier_discount_percent: null,
        currency: 'EUR',
        is_available: true,
        raw_variant_json: {
          size: line
        },
        product_key: `${SUPPLIER_SLUG}:${productCode}`
      });
    }
  }

  return variants;
}

async function selectPopupValues(page, labelText, values) {
  console.log(`Selecting ${labelText}:`, values);

  const label = page.locator(`text=${labelText}`).first();
  const box = await label.boundingBox();

  if (!box) throw new Error(`${labelText} label not found`);

  await page.mouse.click(box.x + 190, box.y + 10);
  await page.waitForTimeout(1000);

  for (const value of values) {
    const search = page.locator('input[type="search"]:visible').last();

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

async function extractProducts(page) {
  const cards = page.locator('div, li, tr').filter({ hasText: 'Whole Sale' });
  const count = await cards.count();

  console.log('Product blocks detected:', count);

  const products = [];

  for (let i = 0; i < count; i++) {
    const card = cards.nth(i);

    const text = await card.innerText().catch(() => null);
    if (!text) continue;

    const lines = text
      .split('\n')
      .map(cleanText)
      .filter(Boolean);

    const brand = detectBrand(lines);
    const productCode = detectCode(lines);

    if (!productCode) continue;

    const title =
      lines.find(line =>
        line !== brand &&
        line !== productCode &&
        !line.includes('Whole Sale') &&
        !line.includes('Retail') &&
        !line.includes('Warehouse stock') &&
        !line.includes('€')
      ) || null;

    const finalPrice = extractPrice(text, 'Whole Sale');
    const retailPrice = extractPrice(text, 'Retail No Vat');

    const imageUrls = await card.locator('img').evaluateAll(imgs =>
      imgs
        .map(img => img.src || img.getAttribute('src') || img.getAttribute('data-src'))
        .filter(Boolean)
    ).catch(() => []);

    const imagesRaw = [...new Set(imageUrls)].map((url, index) => ({
      url,
      position: index + 1,
      type: index === 0 ? 'main' : 'gallery',
      is_main: index === 0,
      raw: url
    }));

    const variantsRaw = buildVariants(lines, productCode, retailPrice, finalPrice);

    const product = {
      supplier_name: SUPPLIER_NAME,
      supplier_slug: SUPPLIER_SLUG,

      supplier_sku: null,
      supplier_product_code: productCode,

      brand_raw: brand,
      title_raw: title,
      description_raw: null,

      gender_raw: null,
      category_raw: null,
      subcategory_raw: null,
      type_raw: title,
      color_raw: null,
      season_raw: detectSeason(lines),

      composition_raw: detectComposition(lines),
      made_in_raw: detectMadeIn(lines),
      size_and_fit_raw: null,

      supplier_retail_price: retailPrice,
      supplier_final_price: finalPrice,
      supplier_discount_percent: null,

      currency: 'EUR',
      is_sale: false,

      supplier_product_url: page.url(),
      listing_url: page.url(),

      product_key: `${SUPPLIER_SLUG}:${productCode}`,
      product_hash: makeHash({ productCode, text }),

      images_raw: imagesRaw,

      raw_json: {
        text,
        lines,
        url: page.url(),
        variants_raw: variantsRaw
      },

      scrape_status: 'new',
      is_active: true,
      is_archived: false,
      scraped_at: new Date().toISOString()
    };

    products.push(product);
  }

  return products;
}

async function sendWebhook(products) {
  if (!process.env.N8N_WEBHOOK_URL) {
    throw new Error('N8N_WEBHOOK_URL is missing');
  }

  console.log('Sending webhook to n8n...');

  const response = await fetch(process.env.N8N_WEBHOOK_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      supplier_name: SUPPLIER_NAME,
      supplier_slug: SUPPLIER_SLUG,
      source: 'gebnegozionline_scraper',
      scraped_at: new Date().toISOString(),
      products
    })
  });

  console.log('Webhook status:', response.status);

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`Webhook failed: ${response.status} ${errorText}`);
  }

  console.log('Webhook sent successfully');
}

async function run() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1200 }
  });

  try {
    console.log('Opening Gebnegozionline...');
    await page.goto(START_URL, {
      waitUntil: 'domcontentloaded',
      timeout: 120000
    });

    if (!LOGIN || !PASSWORD) {
      throw new Error('Login or password env variable is missing');
    }

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
    await selectPopupValues(page, 'Season', TEST_SEASONS);

    console.log('Clicking Search...');
    await page.locator('button:has-text("Search")').click({ force: true });

    await page.waitForTimeout(15000);

    console.log('Result URL:', page.url());
    console.log('Title:', await page.title());

    const products = await extractProducts(page);

    console.log('Prepared products:', products.length);

    if (!products.length) {
      const bodyText = await page.locator('body').innerText();
      console.log('Body preview:', bodyText.slice(0, 3000));
      throw new Error('No products prepared');
    }

    console.log('First product preview:', {
      supplier_product_code: products[0].supplier_product_code,
      brand_raw: products[0].brand_raw,
      title_raw: products[0].title_raw,
      supplier_final_price: products[0].supplier_final_price,
      supplier_retail_price: products[0].supplier_retail_price,
      images_count: products[0].images_raw.length,
      variants_count: products[0].variants_raw.length
    });

    await sendWebhook(products);

    console.log('Gebnegozionline scrape completed');
  } catch (error) {
    console.error('ERROR:', error.message);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

run();
