const { chromium } = require('playwright');
const axios = require('axios');
const { parse } = require('csv-parse/sync');

async function run() {
  const browser = await chromium.launch({
    headless: true
  });

  const page = await browser.newPage();

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
    .map(c => `${c.name}=${c.value}`)
    .join('; ');

  console.log('Fetching export CSV...');

  const exportResponse = await axios.get(
    'https://b2bfashion.online/module/bbapi/get_export',
    {
      responseType: 'text',
      headers: {
        Cookie: cookieHeader
      }
    }
  );

  console.log('Export status:', exportResponse.status);

  const csvText = exportResponse.data;

  console.log('CSV size:', csvText.length, 'bytes');

  const records = parse(csvText, {
    columns: true,
    skip_empty_lines: true
  });

  console.log('Parsed rows:', records.length);

  const products = [];

  for (const row of records.slice(0, 10)) {

    const product = {
      supplier: 'julian-fashion',

      title: `${row.designer} ${row.cod}`,

      vendor: row.designer,

      sku: row.cod,

      category: row.category,

      gender: row.gender,

      color: row.color,

      size: row.size,

      season: row.season,

      description: row.description,

      cost_price: Number(row['cost price']),

      retail_price: Number(row['retail price']),

      discounted_price: Number(row['discounted price']),

      quantity: Number(row.qty),

      images: [
        row.foto1,
        row.foto2,
        row['foto 3']
      ].filter(Boolean)
    };

    products.push(product);
  }

  console.log('Prepared products:', products.length);

  console.log('Sending webhook to n8n...');

  const webhookResponse = await axios.post(
    process.env.N8N_WEBHOOK_URL,
    {
      supplier: 'julian-fashion',
      products
    }
  );

  console.log('Webhook status:', webhookResponse.status);

  console.log('Webhook sent successfully');

  await browser.close();
}

run().catch(error => {
  console.error('Fatal error:', error.message);

  process.exit(1);
});
