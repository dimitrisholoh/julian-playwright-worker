const { chromium } = require('playwright');
const axios = require('axios');
const crypto = require('crypto');

const SUPPLIER_NAME = 'Julian Fashion Srl';
const SUPPLIER_SLUG = 'julian-fashion';

const LIMIT_PRODUCTS = Number(process.env.LIMIT_PRODUCTS || 48);
const MAX_PAGES = Number(process.env.MAX_PAGES || 1);

const START_URL = process.env.JULIAN_START_URL || 'https://b2bfashion.online/';
const LISTING_URL = 'https://b2bfashion.online/306-all';

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

  const features =
    product.grouped_features ||
    product.features ||
    product.attributes ||
    {};

  if (Array.isArray(features)) {
    for (const item of features) {
      const itemName = String(item?.name || '').toLowerCase().trim();
      if (itemName === target) {
        return cleanText(item?.value || item?.reference || item?.name);
      }
    }
  }

  if (features && typeof features === 'object') {
    for (const [key, item] of Object.entries(features)) {
      const keyNorm = String(key).toLowerCase().trim();
      const itemName = String(item?.name || item?.group || item?.label || '')
        .toLowerCase()
        .trim();

      if (keyNorm === target || itemName === target) {
        return cleanText(item?.value || item?.reference || item?.name || item);
      }
    }
  }

  return null;
}

function extractImagesFromHtml(html) {
  if (!html) return [];

  const urls = [];
  const decoded = html.replaceAll('\\/', '/');

  const matches = decoded.matchAll(
    /https:\/\/julianfashionstorage\.blob\.core\.windows\.net\/jbc\/[^"'<> ]+\.(jpg|jpeg|png|webp)/gi
  );

  for (const match of matches) {
    const url = cleanText(match[0]);
    if (url && !urls.includes(url)) urls.push(url);
  }

  return urls;
}

function extractImages(product, quickviewHtml, sourceCard = {}) {
  const images = [];

  const addImage = (url, raw = null) => {
    const cleanUrl = cleanText(url);
    if (!cleanUrl) return;
    if (images.some(img => img.url === cleanUrl)) return;

    images.push({
      url: cleanUrl,
      position: images.length + 1,
      type: images.length === 0 ? 'main' : 'gallery',
      is_main: images.length === 0,
      raw
    });
  };

  if (sourceCard.image_main) addImage(sourceCard.image_main, null);
  if (sourceCard.image_hover) addImage(sourceCard.image_hover, null);

  extractImagesFromHtml(quickviewHtml).forEach(url => addImage(url, null));

  if (Array.isArray(product.images)) {
    product.images.forEach(img => {
      if (typeof img === 'string') {
        addImage(img, img);
      } else {
        addImage(img?.large?.url, img);
        addImage(img?.medium?.url, img);
        addImage(img?.bySize?.large_default?.url, img);
        addImage(img?.bySize?.home_default?.url, img);
        addImage(img?.url, img);
      }
    });
  }

  addImage(product.cover?.large?.url, product.cover);
  addImage(product.cover?.medium?.url, product.cover);
  addImage(product.cover?.bySize?.large_default?.url, product.cover);
  addImage(product.cover?.bySize?.home_default?.url, product.cover);
  addImage(product.cover?.url, product.cover);

  return images;
}

function extractVariants(product, sourceCard = {}) {
  const variants = [];

  const attributes = product.attributes || {};

  for (const group of Object.values(attributes)) {
    if (!group || typeof group !== 'object') continue;

    variants.push({
      supplier_size: cleanText(group.name || group.value || sourceCard.size),
      supplier_sku: cleanText(group.reference || product.reference_to_display || sourceCard.sku),
      supplier_variant_code: cleanText(group.id_attribute || sourceCard.id_product_attribute),
      stock_quantity: product.quantity ?? product.quantity_all_versions ?? sourceCard.stock_quantity ?? 1,
      is_available: product.availability === 'available' || Boolean(sourceCard.stock_quantity),
      currency: 'EUR',
      raw_variant_json: group
    });
  }

  if (!variants.length && sourceCard.size) {
    variants.push({
      supplier_size: cleanText(sourceCard.size),
      supplier_sku: cleanText(sourceCard.sku),
      supplier_variant_code: cleanText(sourceCard.id_product_attribute),
      stock_quantity: sourceCard.stock_quantity ?? 1,
      is_available: Boolean(sourceCard.stock_quantity),
      currency: 'EUR',
      raw_variant_json: sourceCard
    });
  }

  return variants;
}

function normalizeProduct(product, quickviewHtml, sourceCard = {}) {
  const productCode = cleanText(
    product.reference ||
    getFeature(product, 'spu') ||
    sourceCard.sku ||
    sourceCard.product_code ||
    product.id_product ||
    product.id
  );

  const retailPrice = toNumber(
    sourceCard.retail_price ||
    product.price_without_reduction ||
    product.regular_price ||
    product.regular_price_amount
  );

  const finalPrice = toNumber(
    sourceCard.final_price ||
    product.price_amount ||
    product.price
  );

  const discountPercent = toNumber(
    sourceCard.discount_percent ||
    product.discount_percentage_absolute ||
    product.discount_percentage
  );

  return {
    supplier_name: SUPPLIER_NAME,
    supplier_slug: SUPPLIER_SLUG,

    supplier_sku: cleanText(product.reference_to_display || sourceCard.sku),
    supplier_product_code: productCode,

    brand_raw: cleanText(
      sourceCard.brand ||
      product.brand_name ||
      product.brand ||
      product.manufacturer_name ||
      product.manufacturer ||
      product.designer ||
      getFeature(product, 'brand')
    ),

    title_raw: cleanText(product.name || product.title || sourceCard.title),
    description_raw: cleanText(product.description),

    gender_raw: getFeature(product, 'gender'),
    category_raw: cleanText(
      getFeature(product, 'category') ||
      product.category_name ||
      product.category ||
      sourceCard.category
    ),
    subcategory_raw: null,
    type_raw: getFeature(product, 'type'),
    color_raw: getFeature(product, 'color'),
    season_raw: cleanText(getFeature(product, 'season') || sourceCard.season),

    composition_raw: getFeature(product, 'composition'),

    made_in_raw:
      getFeature(product, 'made in') ||
      getFeature(product, 'made_in') ||
      getFeature(product, 'country') ||
      getFeature(product, 'origin'),

    size_and_fit_raw: cleanText(getFeature(product, 'size and fit') || sourceCard.size),

    supplier_retail_price: retailPrice,
    supplier_final_price: finalPrice,
    supplier_discount_percent: discountPercent,

    currency: 'EUR',
    is_sale: Boolean(product.has_discount || discountPercent),

    supplier_product_url: cleanText(product.link || product.url || product.canonical_url),
    listing_url: LISTING_URL,

    product_key: `${SUPPLIER_SLUG}:${productCode}`,
    product_hash: makeHash({
      supplier_slug: SUPPLIER_SLUG,
      supplier_product_code: productCode,
      supplier_final_price: finalPrice,
      is_active: true
    }),

    images_raw: extractImages(product, quickviewHtml, sourceCard),
    variants_raw: extractVariants(product, sourceCard),

    raw_json: {
      ...product,
      quickview_html: quickviewHtml,
      source_card: sourceCard
    },

    scrape_status: 'new',
    is_active: true,
    is_archived: false,
    scraped_at: new Date().toISOString()
  };
}

async function login(page) {
  console.log('Opening Julian login page...');

  if (!process.env.JULIAN_LOGIN_URL) throw new Error('JULIAN_LOGIN_URL is missing');
  if (!process.env.JULIAN_EMAIL || !process.env.JULIAN_PASSWORD) {
    throw new Error('JULIAN_EMAIL or JULIAN_PASSWORD is missing');
  }

  await page.goto(process.env.JULIAN_LOGIN_URL, {
    waitUntil: 'domcontentloaded',
    timeout: 120000
  }).catch(e => {
    console.log('Login goto warning:', e.message);
  });

  await page.waitForTimeout(3000);

  await page.fill('input[type="email"]', process.env.JULIAN_EMAIL);
  await page.fill('input[type="password"]', process.env.JULIAN_PASSWORD);

  await page.keyboard.press('Enter');

  await page.waitForTimeout(12000);

  console.log('Login completed');
  console.log('Current URL:', page.url());
}

async function openListing(page, pageNumber = 1) {
  const pageUrl =
    pageNumber > 1
      ? `${LISTING_URL}?page=${pageNumber}`
      : LISTING_URL;

  console.log('Opening listing URL:', pageUrl);

  await page.goto(pageUrl, {
    waitUntil: 'domcontentloaded',
    timeout: 120000
  }).catch(e => {
    console.log('Listing goto warning:', e.message);
  });

  await page.waitForTimeout(15000);
  await page.mouse.wheel(0, 15000);
  await page.waitForTimeout(5000);

  console.log('Listing opened');
  console.log('Current listing URL:', page.url());

  const productCount = await page.locator('.product-miniature').count();
  console.log('Products found on page:', productCount);

  return productCount;
}

async function collectListingCards(page) {
  const cards = [];

  const productCards = page.locator('.product-miniature');
  const count = await productCards.count();
  const limit = Math.min(count, LIMIT_PRODUCTS);

  console.log('Listing cards to collect:', limit);

  for (let i = 0; i < limit; i++) {
    const card = productCards.nth(i);

    const data = await card.evaluate(el => {
      const text = el.innerText || '';
      const lines = text
        .split('\n')
        .map(x => x.replace(/\s+/g, ' ').trim())
        .filter(Boolean);

      const html = el.innerHTML || '';

      const imgTags = Array.from(el.querySelectorAll('img'));
      const imageUrls = imgTags
        .map(img =>
          img.getAttribute('src') ||
          img.getAttribute('data-src') ||
          img.getAttribute('data-full-size-image-url')
        )
        .filter(Boolean);

      const quickBtn = el.querySelector(
        '[data-link-action="quickview"], .quick-view, .button-action.quick-view'
      );

      const sizeRow = lines.find(line => /\b\d+\s?(IT|FR|EU)?\b|XS|S|M|L|XL|XXL|U/i.test(line)) || null;
      const stockLine = lines.find(line => /pc\.|pcs|in stock/i.test(line)) || null;

      const retailLine = lines.find(line => /RETAIL PRICE/i.test(line)) || null;
      const finalLine = lines.find(line => /FINAL PRICE/i.test(line)) || null;

      const moneyMatches = text.match(/€\s?[\d.,]+/g) || [];
      const discountMatch = text.match(/-\s?\d+%/);

      const productCodeLine = lines.find(line =>
        /^[A-Z0-9]{8,}$/i.test(line) &&
        !line.includes('€') &&
        !line.includes('%')
      );

      return {
        lines,
        html,
        image_urls: imageUrls,
        quickview_outer_html: quickBtn ? quickBtn.outerHTML : null,
        retail_line: retailLine,
        final_line: finalLine,
        money_matches: moneyMatches,
        discount: discountMatch ? discountMatch[0] : null,
        product_code_line: productCodeLine,
        size_line: sizeRow,
        stock_line: stockLine
      };
    });

    const brand = data.lines[0] || null;
    const season = data.lines.find(line => /Spring|Summer|Fall|Winter|Autumn|FW|SS/i.test(line)) || null;
    const productCode = data.product_code_line || null;

    const retailPrice = data.money_matches[0] || null;
    const finalPrice = data.money_matches[data.money_matches.length - 1] || null;

    const imageMain = data.image_urls[0] || null;
    const imageHover = data.image_urls[1] || null;

    cards.push({
      index: i + 1,
      brand,
      title: null,
      season,
      product_code: productCode,
      sku: productCode,
      retail_price: retailPrice,
      final_price: finalPrice,
      discount_percent: data.discount,
      size: data.size_line,
      stock_quantity: data.stock_line ? 1 : null,
      image_main: imageMain,
      image_hover: imageHover,
      quickview_outer_html: data.quickview_outer_html,
      raw_lines: data.lines,
      raw_html: data.html
    });

    console.log('CARD:', {
      index: i + 1,
      brand,
      product_code: productCode,
      retail_price: retailPrice,
      final_price: finalPrice,
      discount: data.discount,
      image: imageMain ? 'yes' : 'no',
      quickview_button: data.quickview_outer_html ? 'yes' : 'no'
    });
  }

  return cards;
}

async function clickQuickviewAndCapture(page, index) {
  const responsePromise = page.waitForResponse(
    response =>
      response.url().includes('controller=product') &&
      response.url().includes('action=quickview'),
    { timeout: 30000 }
  );

  const button = page
    .locator('.product-miniature')
    .nth(index)
    .locator('[data-link-action="quickview"], .quick-view, .button-action.quick-view')
    .first();

  await button.scrollIntoViewIfNeeded().catch(() => {});
  await page.waitForTimeout(500);

  await button.click({ force: true, timeout: 10000 });

  const response = await responsePromise;
  const json = await response.json();

  const closeBtn = page.locator('.quickview .close, .modal .close, button.close').first();
  if (await closeBtn.count()) {
    await closeBtn.click({ force: true }).catch(() => {});
    await page.waitForTimeout(500);
  }

  if (!json.product) {
    throw new Error(`No product in quickview response`);
  }

  return {
    product: json.product,
    quickview_html: json.quickview_html || ''
  };
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
      source: 'julian_click_quickview_listing_merge',
      scraped_at: new Date().toISOString(),
      products
    },
    { timeout: 120000 }
  );

  console.log('Webhook status:', response.status);
  console.log('Webhook sent successfully');
}

async function run() {
  const browser = await chromium.launch({
    headless: true
  });

  const page = await browser.newPage({
    viewport: {
      width: 1440,
      height: 1200
    }
  });

  const products = [];
  const errors = [];

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

      const cards = await collectListingCards(page);

      for (let i = 0; i < cards.length; i++) {
        const card = cards[i];

        try {
          const { product, quickview_html } = await clickQuickviewAndCapture(page, i);

          const normalized = normalizeProduct(product, quickview_html, card);
          products.push(normalized);

          console.log('PRODUCT OK:', {
            index: card.index,
            code: normalized.supplier_product_code,
            brand: normalized.brand_raw,
            title: normalized.title_raw,
            retail: normalized.supplier_retail_price,
            final: normalized.supplier_final_price,
            images: normalized.images_raw.length,
            variants: normalized.variants_raw.length
          });

          await page.waitForTimeout(700);
        } catch (error) {
          console.log('PRODUCT FAILED:', {
            index: card.index,
            brand: card.brand,
            error: error.message
          });

          errors.push({
            card,
            error: error.message
          });
        }
      }
    }

    console.log('Prepared products:', products.length);
    console.log('Errors:', errors.length);

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
      size_and_fit_raw: products[0].size_and_fit_raw,
      images_count: products[0].images_raw.length,
      variants_count: products[0].variants_raw.length
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
