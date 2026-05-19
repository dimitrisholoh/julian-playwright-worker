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

  const cleaned = String(value)
    .replace(/\s+/g, ' ')
    .trim();

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

  return Number.isFinite(number)
    ? number
    : null;
}

function makeHash(value) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(value))
    .digest('hex');
}

function extractValue(text, label) {
  if (!text) return null;

  const regex = new RegExp(
    `${label}\\s*:?\\s*([^\\n]+)`,
    'i'
  );

  const match = text.match(regex);

  return match
    ? cleanText(match[1])
    : null;
}

function extractRetailPrice(text) {
  const match = text.match(
    /RETAIL PRICE\s*€?\s*([\d.,]+)/i
  );

  return match
    ? toNumber(match[1])
    : null;
}

function extractFinalPrice(text) {
  const match = text.match(
    /FINAL PRICE\s*-?\s*\d*%?\s*€?\s*([\d.,]+)/i
  );

  return match
    ? toNumber(match[1])
    : null;
}

async function login(page) {
  console.log('Opening Julian login page...');

  await page.goto(
    process.env.JULIAN_LOGIN_URL,
    {
      waitUntil: 'networkidle',
      timeout: 120000
    }
  );

  console.log('Login page loaded');

  await page.fill(
    'input[type="email"]',
    process.env.JULIAN_EMAIL
  );

  await page.fill(
    'input[type="password"]',
    process.env.JULIAN_PASSWORD
  );

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

  await page.waitForTimeout(8000);

  await page.mouse.wheel(0, 8000);

  await page.waitForTimeout(4000);

  console.log('Listing opened');
}

async function collectProductLinks(page) {
  console.log('Collecting product links...');

  const links = await page.$$eval(
    'a',
    elements =>
      elements.map(element => ({
        href: element.href || null,
        text: (
          element.innerText || ''
        ).trim(),
        className:
          element.className || ''
      }))
  );

  console.log(
    'Total raw links:',
    links.length
  );

  const filteredLinks = links
    .map(link => link.href)
    .filter(Boolean)
    .filter(href => {
      const url = href.toLowerCase();

      if (
        url.includes('javascript:') ||
        url.includes('#') ||
        url.includes('login') ||
        url.includes('cart') ||
        url.includes('my-account') ||
        url.includes('content/') ||
        url.includes('promo') ||
        url.includes('new-products') ||
        url.includes('submitcurrency') ||
        url.includes('controller=')
      ) {
        return false;
      }

      return (
        url.includes('.html') ||
        /\/\d{5,}/i.test(url)
      );
    });

  const uniqueLinks = [
    ...new Set(filteredLinks)
  ];

  console.log(
    'Detected product links:',
    uniqueLinks.length
  );

  console.log(
    'First product links:',
    JSON.stringify(
      uniqueLinks.slice(0, 20),
      null,
      2
    )
  );

  return uniqueLinks;
}

async function scrapeProductPage(
  page,
  productUrl
) {
  console.log(
    'Opening product:',
    productUrl
  );

  await page.goto(productUrl, {
    waitUntil: 'domcontentloaded',
    timeout: 120000
  });

  await page.waitForTimeout(5000);

  const pageText =
    await page.locator('body')
      .innerText({
        timeout: 30000
      });

  const title =
    await page
      .locator('h1')
      .first()
      .innerText()
      .catch(() => null);

  const brand =
    extractValue(pageText, 'BRAND') ||
    extractValue(pageText, 'DESIGNER') ||
    extractValue(pageText, 'Designer');

  const supplierProductCode =
    extractValue(pageText, 'SPU') ||
    extractValue(pageText, 'SKU') ||
    extractValue(pageText, 'CODE') ||
    productUrl
      .split('/')
      .filter(Boolean)
      .pop();

  const retailPrice =
    extractRetailPrice(pageText);

  const supplierPrice =
    extractFinalPrice(pageText);

  let supplierDiscountPercent =
    null;

  if (
    retailPrice &&
    supplierPrice &&
    retailPrice > supplierPrice
  ) {
    supplierDiscountPercent =
      Math.round(
        (
          (
            retailPrice -
            supplierPrice
          ) /
          retailPrice
        ) * 100
      );
  }

  const images =
    await page.$$eval(
      'img',
      imgs =>
        imgs
          .map(img => img.src)
          .filter(Boolean)
          .filter(src =>
            src.includes(
              'julianfashionstorage'
            ) ||
            src.includes('/img/') ||
            src.includes(
              'blob.core.windows.net'
            )
          )
    );

  const uniqueImages = [
    ...new Set(images)
  ];

  const product = {
    supplier_name:
      SUPPLIER_NAME,

    supplier_slug:
      SUPPLIER_SLUG,

    supplier_sku: null,

    supplier_product_code:
      cleanText(
        supplierProductCode
      ),

    brand_raw:
      cleanText(brand),

    title_raw:
      cleanText(title),

    description_raw:
      cleanText(pageText),

    gender_raw:
      extractValue(
        pageText,
        'GENDER'
      ),

    category_raw:
      extractValue(
        pageText,
        'CATEGORY'
      ),

    subcategory_raw: null,

    type_raw:
      extractValue(
        pageText,
        'TYPE'
      ),

    color_raw:
      extractValue(
        pageText,
        'COLOR'
      ) ||
      extractValue(
        pageText,
        'COLOUR'
      ),

    season_raw:
      extractValue(
        pageText,
        'SEASON'
      ),

    composition_raw:
      extractValue(
        pageText,
        'COMPOSITION'
      ) ||
      extractValue(
        pageText,
        'MATERIAL'
      ),

    made_in_raw:
      extractValue(
        pageText,
        'MADE IN'
      ),

    size_and_fit_raw:
      extractValue(
        pageText,
        'SIZE AND FIT'
      ) ||
      extractValue(
        pageText,
        'SIZE & FIT'
      ),

    supplier_retail_price:
      retailPrice,

    supplier_final_price:
      supplierPrice,

    supplier_discount_percent:
      supplierDiscountPercent,

    currency: 'EUR',

    is_sale: Boolean(
      supplierDiscountPercent &&
      supplierDiscountPercent > 0
    ),

    supplier_product_url:
      productUrl,

    listing_url:
      START_URL,

    product_key: `${SUPPLIER_SLUG}:${cleanText(
      supplierProductCode
    ) || productUrl}`,

    product_hash:
      makeHash({
        productUrl,
        pageText
      }),

    raw_json: {
      product_url:
        productUrl,

      page_text:
        pageText,

      images:
        uniqueImages
    },

    scrape_status: 'new',

    is_active: true,

    is_archived: false,

    scraped_at:
      new Date().toISOString()
  };

  return product;
}

async function sendWebhook(
  products
) {
  if (
    !process.env.N8N_WEBHOOK_URL
  ) {
    throw new Error(
      'N8N_WEBHOOK_URL is missing'
    );
  }

  console.log(
    'Sending webhook to n8n...'
  );

  const response =
    await axios.post(
      process.env
        .N8N_WEBHOOK_URL,
      {
        supplier_name:
          SUPPLIER_NAME,

        supplier_slug:
          SUPPLIER_SLUG,

        source:
          'julian_playwright_scraper',

        scraped_at:
          new Date().toISOString(),

        products
      },
      {
        timeout: 120000
      }
    );

  console.log(
    'Webhook status:',
    response.status
  );

  console.log(
    'Webhook sent successfully'
  );
}

async function run() {
  const browser =
    await chromium.launch({
      headless: true
    });

  const page =
    await browser.newPage();

  try {
    await login(page);

    await openListing(page);

    const productLinks =
      await collectProductLinks(
        page
      );

    if (
      !productLinks.length
    ) {
      console.log(
        'No product links found'
      );

      console.log(
        'DEBUG page url:',
        page.url()
      );

      const debugText =
        await page
          .locator('body')
          .innerText()
          .catch(() => '');

      console.log(
        'DEBUG body:',
        debugText.slice(0, 3000)
      );

      return;
    }

    const selectedLinks =
      productLinks.slice(
        0,
        LIMIT_PRODUCTS
      );

    const products = [];

    for (const productUrl of selectedLinks) {
      try {
        const product =
          await scrapeProductPage(
            page,
            productUrl
          );

        products.push(product);

        console.log(
          'Product scraped:',
          product.supplier_product_code
        );

        console.log(
          'Title:',
          product.title_raw
        );

        console.log(
          'Retail:',
          product.supplier_retail_price
        );

        console.log(
          'Final:',
          product.supplier_final_price
        );
      } catch (error) {
        console.error(
          'Product scrape failed:',
          productUrl
        );

        console.error(
          error.message
        );
      }
    }

    console.log(
      'Prepared products:',
      products.length
    );

    if (!products.length) {
      throw new Error(
        'No products prepared'
      );
    }

    await sendWebhook(
      products
    );

  } finally {
    await browser.close();
  }
}

run().catch(error => {
  console.error(
    'Fatal error:',
    error.message
  );

  if (error.response) {
    console.error(
      'Response status:',
      error.response.status
    );

    console.error(
      'Response data:',
      error.response.data
    );
  }

  process.exit(1);
});
