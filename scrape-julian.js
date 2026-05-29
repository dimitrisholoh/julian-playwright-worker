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

function detectCodeFromLines(lines) {
  return (
    lines.find(line =>
      /[A-Z0-9]{5,}/i.test(line) &&
      !line.includes('€') &&
      !line.includes('%')
    ) || null
  );
}

function detectTitleFromLines(lines) {
  return (
    lines.find(line =>
      line &&
      !line.includes('€') &&
      !line.includes('%') &&
      !/[A-Z0-9]{8,}/.test(line)
    ) || null
  );
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

function extractImages(product) {
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

  if (Array.isArray(product.images_raw)) {
    product.images_raw.forEach(img => {
      if (typeof img === 'string') addImage(img, img);
      else addImage(img?.url, img);
    });
  }

  if (Array.isArray(product.quickview_images)) {
    product.quickview_images.forEach(url => addImage(url, null));
  }

  if (product.card_image) {
    addImage(product.card_image, null);
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

function normalizeProduct(product) {
  const productCode =
    cleanText(
      product.reference ||
      product.spu ||
      product.id_product ||
      product.id ||
      product.card_reference
    );

  const retailPrice = toNumber(
    product.price_without_reduction ||
    product.regular_price ||
    product.wholesale_price ||
    product.card_retail_price
  );

  const finalPrice = toNumber(
    product.price_amount ||
    product.price ||
    product.card_final_price
  );

  const discountPercent = toNumber(
    product.discount_percentage ||
    product.card_discount_percent
  );

  return {
    supplier_name: SUPPLIER_NAME,
    supplier_slug: SUPPLIER_SLUG,

    supplier_sku: null,
    supplier_product_code: productCode,

    brand_raw: cleanText(
      product.brand_name ||
      product.brand ||
      product.manufacturer ||
      product.designer ||
      product.card_brand ||
      getFeature(product, 'brand')
    ),

    title_raw: cleanText(product.name || product.card_title),
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
    listing_url: LISTING_URL,

    product_key: `${SUPPLIER_SLUG}:${productCode}`,
    product_hash: makeHash({
      supplier_slug: SUPPLIER_SLUG,
      supplier_product_code: productCode,
      supplier_final_price: finalPrice,
      is_active: true
    }),

    images_raw: extractImages(product),

    raw_json: product,

    scrape_status: 'new',
    is_active: true,
    is_archived: false,
    scraped_at: new Date().toISOString()
  };
}

async function login(page) {
  console.log('Opening Julian login page...');

  if (!process.env.JULIAN_LOGIN_URL) {
    throw new Error('JULIAN_LOGIN_URL is missing');
  }

  if (!process.env.JULIAN_EMAIL || !process.env.JULIAN_PASSWORD) {
    throw new Error('JULIAN_EMAIL or JULIAN_PASSWORD is missing');
  }

  await page.goto(process.env.JULIAN_LOGIN_URL, {
    waitUntil: 'networkidle',
    timeout: 120000
  });

  console.log('Login page loaded');

  await page.fill('input[type="email"]', process.env.JULIAN_EMAIL);
  await page.fill('input[type="password"]', process.env.JULIAN_PASSWORD);

  console.log('Credentials filled');

  await page.keyboard.press('Enter');
  await page.waitForLoadState('networkidle', { timeout: 120000 }).catch(() => {});

  console.log('Login completed');
  console.log('Current URL:', page.url());
}

async function openListing(page, pageNumber = 1) {
  console.log('Opening listing page...');

  await page.goto(START_URL, {
    waitUntil: 'domcontentloaded',
    timeout: 120000
  }).catch(e => {
    console.log('Home goto warning:', e.message);
  });

  await page.waitForTimeout(8000);

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

  await page.waitForLoadState('domcontentloaded', { timeout: 120000 }).catch(() => {});
  await page.waitForTimeout(15000);

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

  const productCount = await page.locator('.product-miniature').count();
  const limit = Math.min(productCount, LIMIT_PRODUCTS);

  console.log('Product miniature count:', productCount);
  console.log('LIMIT_PRODUCTS:', LIMIT_PRODUCTS);
  console.log('Products to process:', limit);

  const listingCards = [];
  const quickviewImages = [];

  for (let i = 0; i < limit; i++) {
    let card = null;
    let cardImage = null;

    try {
      const productCard = page.locator('.product-miniature').nth(i);

      const cardText = await productCard.innerText().catch(() => '');

      const cardLines = cardText
        .split('\n')
        .map(line => cleanText(line))
        .filter(Boolean);

      const cardBrand = cardLines[0] || null;
      const cardTitle = detectTitleFromLines(cardLines);
      const cardReference = detectCodeFromLines(cardLines);

      cardImage = await productCard
        .locator('img')
        .first()
        .getAttribute('src')
        .catch(() => null);

      card = {
        card_brand: cardBrand,
        card_title: cardTitle,
        card_reference: cardReference,
        card_image: cardImage,
        raw_text: cardText,
        raw_lines: cardLines,
        listing_index: i + 1
      };

      listingCards.push(card);

      console.log('Listing card:', {
        index: i + 1,
        brand: cardBrand,
        title: cardTitle,
        reference: cardReference,
        image: cardImage
      });

      const button = page.locator('.button-action.quick-view').nth(i * 2);

      await button.evaluate(el => {
        el.scrollIntoView({
          behavior: 'instant',
          block: 'center'
        });
      }).catch(() => {});

      await page.waitForTimeout(1500);

      if (await button.count() && await button.isVisible()) {
        await button.click({
          force: true,
          timeout: 10000
        });

        console.log('Quickview clicked:', i + 1);

        await page.waitForTimeout(3000);

        const modalImages = await page
          .locator('.quickview img, .modal img')
          .evaluateAll(imgs =>
            imgs
              .map(img =>
                img.src ||
                img.getAttribute('data-src') ||
                img.getAttribute('data-full-size-image-url')
              )
              .filter(Boolean)
          )
          .catch(() => []);

        const cleanModalImages = [...new Set(
          modalImages
            .map(url => cleanText(url))
            .filter(Boolean)
        )];

        if (!cleanModalImages.length && cardImage) {
          cleanModalImages.push(cardImage);
        }

        quickviewImages.push(cleanModalImages);

        console.log('Quickview images:', i + 1, cleanModalImages.length);

        const closeBtn = page
          .locator('.quickview .close, .modal .close, button.close')
          .first();

        if (await closeBtn.count()) {
          await closeBtn.click({ force: true }).catch(() => {});
          await page.waitForTimeout(1000);
        }
      } else {
        console.log('Quickview button not visible:', i + 1);
        quickviewImages.push(cardImage ? [cardImage] : []);
      }
    } catch (error) {
      console.log('Quickview step failed:', i + 1, error.message);

      if (!card) {
        listingCards.push({
          card_brand: null,
          card_title: null,
          card_reference: null,
          card_image: cardImage,
          raw_text: null,
          raw_lines: [],
          listing_index: i + 1,
          error: error.message
        });
      }

      quickviewImages.push(cardImage ? [cardImage] : []);
    }
  }

  return {
    cards: listingCards,
    images: quickviewImages
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
      source: 'julian_listing_with_quickview_enrichment',
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

  const page = await browser.newPage({
    viewport: {
      width: 1440,
      height: 1200
    }
  });

  const quickviewProducts = [];
  const allListingCards = [];
  const allQuickviewImages = [];

  page.on('response', async response => {
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
        console.log('JSON parse failed:', error.message);
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

      const pageData = await clickQuickviews(page);

      allListingCards.push(...pageData.cards);
      allQuickviewImages.push(...pageData.images);
    }

    console.log('Captured quickview products:', quickviewProducts.length);
    console.log('Captured listing cards:', allListingCards.length);
    console.log('Captured image groups:', allQuickviewImages.length);

    const products = allListingCards.map((card, index) => {
      const quickviewProduct = quickviewProducts[index] || {};
      const productImages = allQuickviewImages[index] || [];

      const cleanImages = productImages
        .filter(Boolean)
        .filter(url =>
          url.includes('.jpg') ||
          url.includes('.jpeg') ||
          url.includes('.png') ||
          url.includes('.webp')
        );

      const mergedProduct = {
        ...card,
        ...quickviewProduct,

        reference:
          quickviewProduct.reference ||
          quickviewProduct.spu ||
          quickviewProduct.id_product ||
          quickviewProduct.id ||
          card.card_reference ||
          `listing-${card.listing_index}`,

        name:
          quickviewProduct.name ||
          card.card_title ||
          card.card_brand ||
          `Listing product ${card.listing_index}`,

        brand:
          quickviewProduct.brand_name ||
          quickviewProduct.brand ||
          quickviewProduct.manufacturer ||
          quickviewProduct.designer ||
          card.card_brand ||
          null,

        card_image: card.card_image,

        images_raw: cleanImages.length
          ? cleanImages
          : extractImages({
              ...quickviewProduct,
              card_image: card.card_image
            }),

        listing_fallback_used: !quickviewProducts[index]
      };

      console.log('PRODUCT BUILD DEBUG:', {
        index: index + 1,
        fallback: mergedProduct.listing_fallback_used,
        code: mergedProduct.reference,
        brand: mergedProduct.brand,
        title: mergedProduct.name,
        images_count: mergedProduct.images_raw.length
      });

      return normalizeProduct(mergedProduct);
    });

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
      size_and_fit_raw: products[0].size_and_fit_raw,
      images_count: products[0].images_raw.length,
      fallback: products[0].raw_json?.listing_fallback_used
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
