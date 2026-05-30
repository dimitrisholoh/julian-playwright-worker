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

function extractImages(product, quickviewHtml) {
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

  extractImagesFromHtml(quickviewHtml).forEach(url => addImage(url, null));

  if (Array.isArray(product.images_raw)) {
    product.images_raw.forEach(img => {
      if (typeof img === 'string') addImage(img, img);
      else addImage(img?.url, img);
    });
  }

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

function extractVariants(product) {
  const result = [];
  const attributes = product.attributes || {};

  for (const group of Object.values(attributes)) {
    if (!group || typeof group !== 'object') continue;

    result.push({
      supplier_size: cleanText(group.name || group.value),
      supplier_sku: cleanText(group.reference || product.reference_to_display),
      supplier_variant_code: cleanText(group.id_attribute),
      stock_quantity: product.quantity ?? product.quantity_all_versions ?? 1,
      is_available: product.availability === 'available',
      currency: 'EUR',
      raw_variant_json: group
    });
  }

  return result;
}

function normalizeProduct(product, quickviewHtml, sourceCard = {}) {
  const productCode = cleanText(
    product.reference ||
    product.spu ||
    product.id_product ||
    product.id ||
    sourceCard.id_product
  );

  const retailPrice = toNumber(
    product.price_without_reduction ||
    product.regular_price ||
    product.wholesale_price
  );

  const finalPrice = toNumber(product.price_amount || product.price);

  const discountPercent = toNumber(
    product.discount_percentage_absolute ||
    product.discount_percentage
  );

  return {
    supplier_name: SUPPLIER_NAME,
    supplier_slug: SUPPLIER_SLUG,

    supplier_sku: cleanText(product.reference_to_display || null),
    supplier_product_code: productCode,

    brand_raw: cleanText(
      product.brand_name ||
      product.brand ||
      product.manufacturer_name ||
      product.manufacturer ||
      product.designer ||
      sourceCard.brand ||
      getFeature(product, 'brand')
    ),

    title_raw: cleanText(product.name || product.title || sourceCard.title),
    description_raw: cleanText(product.description),

    gender_raw: getFeature(product, 'gender'),
    category_raw: cleanText(
      getFeature(product, 'category') ||
      product.category_name ||
      product.category
    ),
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

    supplier_product_url: cleanText(product.link || product.url || product.canonical_url),
    listing_url: LISTING_URL,

    product_key: `${SUPPLIER_SLUG}:${productCode}`,
    product_hash: makeHash({
      supplier_slug: SUPPLIER_SLUG,
      supplier_product_code: productCode,
      supplier_final_price: finalPrice,
      is_active: true
    }),

    images_raw: extractImages(product, quickviewHtml),
    variants_raw: extractVariants(product),

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

  await page.waitForTimeout(8000);

  console.log('Login completed');
  console.log('Current URL:', page.url());
}

async function openListing(page, pageNumber = 1) {
  const pageUrl =
    pageNumber > 1
      ? `/306-all?page=${pageNumber}`
      : `/306-all`;

  console.log('Opening listing URL:', `https://b2bfashion.online${pageUrl}`);

  await page.evaluate(url => {
    window.location.href = url;
  }, pageUrl).catch(e => {
    console.log('Location change warning:', e.message);
  });

  await page.waitForTimeout(15000);

  await page.waitForLoadState('domcontentloaded', { timeout: 120000 }).catch(e => {
    console.log('Listing loadstate warning:', e.message);
  });

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

    const text = await card.innerText().catch(() => '');
    const lines = text
      .split('\n')
      .map(line => cleanText(line))
      .filter(Boolean);

    const fullHtml = await card.innerHTML().catch(() => '');

    const idProductMatch =
      fullHtml.match(/id_product[="':\s]+(\d+)/i) ||
      fullHtml.match(/data-id-product[="']+(\d+)/i) ||
      fullHtml.match(/id_product=(\d+)/i);

    const idAttributeMatch =
      fullHtml.match(/id_product_attribute[="':\s]+(\d+)/i) ||
      fullHtml.match(/data-id-product-attribute[="']+(\d+)/i) ||
      fullHtml.match(/id_product_attribute=(\d+)/i);

    const idProduct = idProductMatch?.[1] || null;
    const idProductAttribute = idAttributeMatch?.[1] || '0';

    const quickviewUrl = idProduct
      ? `https://b2bfashion.online/index.php?controller=product?more=55&action=quickview&id_product=${idProduct}&id_product_attribute=${idProductAttribute}`
      : null;

    cards.push({
      index: i + 1,
      brand: lines[0] || null,
      title: lines[1] || lines[0] || null,
      id_product: idProduct,
      id_product_attribute: idProductAttribute,
      quickview_url: quickviewUrl,
      raw_text: text,
      raw_lines: lines
    });

    console.log('CARD:', {
      index: i + 1,
      brand: lines[0] || null,
      id_product: idProduct,
      id_product_attribute: idProductAttribute,
      has_quickview_url: Boolean(quickviewUrl)
    });
  }

  return cards;
}

 fetchQuickview(page, card) {
  if (!card.quickview_url) {
    throw new Error(`Missing quickview_url for card ${card.index}`);
  }

  const response = await page.request.get(card.quickview_url, {
    timeout: 120000,
    headers: {
      Accept: 'application/json, text/javascript, */*; q=0.01',
      'X-Requested-With': 'XMLHttpRequest'
    }
  });

  if (!response.ok()) {
    throw new Error(`Quickview failed ${response.status()} for card ${card.index}`);
  }

  const json = await response.json();

  if (!json.product) {
    throw new Error(`No product in quickview response for card ${card.index}`);
  }

  return {
    product: json.product,
    quickview_html: json.quickview_html || ''
  };
}

 sendWebhook(products) {
  if (!process.env.N8N_WEBHOOK_URL) {
    throw new Error('N8N_WEBHOOK_URL is missing');
  }

  console.log('Sending webhook to n8n...');

  const response = await axios.post(
    process.env.N8N_WEBHOOK_URL,
    {
      supplier_name: SUPPLIER_NAME,
      supplier_slug: SUPPLIER_SLUG,
      source: 'julian_quickview_api_scraper',
      scraped_at: new Date().toISOString(),
      products
    },
    { timeout: 120000 }
  );

  console.log('Webhook status:', response.status);
  console.log('Webhook sent successfully');
}

 run() {
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

      for (const card of cards) {
        try {
          const { product, quickview_html } = await fetchQuickview(page, card);

          const normalized = normalizeProduct(product, quickview_html, card);
          products.push(normalized);

          console.log('PRODUCT OK:', {
            index: card.index,
            code: normalized.supplier_product_code,
            brand: normalized.brand_raw,
            title: normalized.title_raw,
            images: normalized.images_raw.length,
            variants: normalized.variants_raw.length
          });

          await page.waitForTimeout(300);
        } catch (error) {
          console.log('PRODUCT FAILED:', {
            index: card.index,
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
