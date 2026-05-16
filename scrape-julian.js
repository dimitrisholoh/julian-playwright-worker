const { chromium } = require('playwright');
const fs = require('fs');
const { parse } = require('csv-parse/sync');

async function run() {
  const browser = await chromium.launch({
    headless: true
  });

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

  const exportUrl =
    'https://b2bfashion.online/module/bbapi/get_export';

  console.log('Fetching export CSV...');

  const result = await page.evaluate(async (url) => {
    const response = await fetch(url, {
      method: 'GET',
      credentials: 'include'
    });

    const text = await response.text();

    return {
      status: response.status,
      text
    };
  }, exportUrl);

  console.log('Export status:', result.status);

  fs.writeFileSync('julian-catalog.csv', result.text);

  console.log('CSV saved');

  const records = parse(result.text, {
    columns: true,
    skip_empty_lines: true,
    relax_quotes: true,
    relax_column_count: true
  });

  console.log('Parsed products:', records.length);

  const normalized = records.map((item) => {
    return {
      sku: item.cod || '',
      designer: item.designer || '',
      category: item.category || '',
      gender: item.gender || '',
      color: item.color || '',
      size: item.size || '',
      season: item.season || '',
      quantity: Number(item.qty || 0),

      description: item.description || '',

      cost_price: Number(item['cost price'] || 0),

      retail_price: Number(item['retail price'] || 0),

      discounted_price: Number(item['discounted price'] || 0),

      images: [
        item.foto1,
        item.foto2,
        item['foto 3']
      ].filter(Boolean)
    };
  });

  fs.writeFileSync(
    'julian-normalized.json',
    JSON.stringify(normalized, null, 2)
  );

  console.log('Normalized JSON saved');

  console.log('First 3 products:');

  console.log(
    JSON.stringify(normalized.slice(0, 3), null, 2)
  );

  await browser.close();
}

run()
  .then(() => {
    console.log('Julian normalization completed');
    setInterval(() => {}, 1000);
  })
  .catch((error) => {
    console.error('Normalization failed:', error);
    process.exit(1);
  });
