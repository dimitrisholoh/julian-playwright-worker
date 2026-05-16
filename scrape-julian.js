const { chromium } = require('playwright');
const fs = require('fs');
const { parse } = require('csv-parse/sync');

function clean(value) {
  return String(value || '').trim();
}

function toNumber(value) {
  const cleaned = clean(value).replace(',', '.');
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : 0;
}

function cleanSize(value) {
  return clean(value).replace(/^size:\s*/i, '').trim();
}

function buildProductKey(item) {
  return [
    clean(item.designer),
    clean(item.cod),
    clean(item.color)
  ].join('__').toLowerCase();
}

function escapeCsv(value) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

async function run() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  console.log('Opening Julian B2B...');

  await page.goto(process.env.JULIAN_LOGIN_URL, {
    waitUntil: 'domcontentloaded',
    timeout: 60000
  });

  console.log('Login page opened');

  await page.fill('input[type="email"]', process.env.JULIAN_EMAIL);
  await page.fill('input[type="password"]', process.env.JULIAN_PASSWORD);

  console.log('Credentials filled');

  await page.click('button[type="submit"]');
  await page.waitForLoadState('domcontentloaded');

  console.log('Login submitted');

  const exportUrl = 'https://b2bfashion.online/module/bbapi/get_export';

  console.log('Fetching export CSV...');

  const result = await page.evaluate(async (url) => {
    const response = await fetch(url, {
      method: 'GET',
      credentials: 'include'
    });

    return {
      status: response.status,
      text: await response.text()
    };
  }, exportUrl);

  console.log('Export status:', result.status);
  console.log('CSV size:', Buffer.byteLength(result.text, 'utf8'), 'bytes');

  fs.writeFileSync('julian-catalog.csv', result.text);

  const records = parse(result.text, {
    columns: true,
    skip_empty_lines: true,
    relax_quotes: true,
    relax_column_count: true
  });

  console.log('CSV rows parsed:', records.length);

  const productsMap = new Map();

  for (const item of records) {
    const sku = clean(item.cod);
    const designer = clean(item.designer);
    const color = clean(item.color);
    const size = cleanSize(item.size);

    if (!sku || !designer) continue;

    const key = buildProductKey(item);

    const images = [
      clean(item.foto1),
      clean(item.foto2),
      clean(item['foto 3'])
    ].filter(Boolean);

    if (!productsMap.has(key)) {
      productsMap.set(key, {
        supplier: 'Julian Fashion',
        product_key: key,
        handle: `${designer}-${sku}-${color}`
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, ''),

        title: `${designer} ${sku}`,
        vendor: designer,
        product_type: clean(item.category),
        gender: clean(item.gender),
        category: clean(item.category),
        color,
        season: clean(item.season),
        description: clean(item.description),

        tags: [
          'supplier:julian-fashion',
          `designer:${designer}`,
          `gender:${clean(item.gender)}`,
          `category:${clean(item.category)}`,
          `season:${clean(item.season)}`
        ].filter(Boolean),

        images: [],
        variants: []
      });
    }

    const product = productsMap.get(key);

    for (const image of images) {
      if (!product.images.includes(image)) {
        product.images.push(image);
      }
    }

    const variantSku = `${sku}-${size || 'OS'}`.replace(/\s+/g, '-');

    product.variants.push({
      option1_name: 'Size',
      option1_value: size || 'One Size',
      sku: variantSku,
      barcode: '',
      inventory_quantity: toNumber(item.qty),
      cost_price: toNumber(item['cost price']),
      retail_price: toNumber(item['retail price']),
      price: toNumber(item['discounted price']) || toNumber(item['retail price']),
      currency: 'EUR'
    });
  }

  const shopifyProducts = Array.from(productsMap.values());

  fs.writeFileSync(
    'julian-shopify-products.json',
    JSON.stringify(shopifyProducts, null, 2)
  );

  console.log('Shopify-ready products:', shopifyProducts.length);

  const totalVariants = shopifyProducts.reduce(
    (sum, product) => sum + product.variants.length,
    0
  );

  console.log('Total variants:', totalVariants);

  const shopifyRows = [];

  for (const product of shopifyProducts) {
    product.variants.forEach((variant, index) => {
      shopifyRows.push({
        Handle: product.handle,
        Title: index === 0 ? product.title : '',
        Body: index === 0 ? product.description : '',
        Vendor: index === 0 ? product.vendor : '',
        Type: index === 0 ? product.product_type : '',
        Tags: index === 0 ? product.tags.join(', ') : '',
        Published: 'TRUE',
        'Option1 Name': variant.option1_name,
        'Option1 Value': variant.option1_value,
        'Variant SKU': variant.sku,
        'Variant Price': variant.price,
        'Variant Compare At Price': variant.retail_price,
        'Variant Cost': variant.cost_price,
        'Variant Inventory Qty': variant.inventory_quantity,
        'Image Src': product.images[index] || '',
        'Image Position': product.images[index] ? index + 1 : '',
        Status: 'active'
      });
    });
  }

  const headers = Object.keys(shopifyRows[0]);

  const csvOutput = [
    headers.join(','),
    ...shopifyRows.map(row =>
      headers.map(header => escapeCsv(row[header])).join(',')
    )
  ].join('\n');

  fs.writeFileSync('julian-shopify-import.csv', csvOutput);

  console.log('Shopify CSV rows:', shopifyRows.length);
  console.log('Shopify CSV generated');

  console.log('First Shopify-ready product:');
  console.log(JSON.stringify(shopifyProducts[0], null, 2));

  await browser.close();
}

run()
  .then(() => {
    console.log('Julian Shopify CSV generation completed');
    setInterval(() => {}, 1000);
  })
  .catch((error) => {
    console.error('Generation failed:', error);
    process.exit(1);
  });
