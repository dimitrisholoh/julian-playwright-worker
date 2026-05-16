const { chromium } = require('playwright');

async function run() {
  const browser = await chromium.launch({ headless: true });
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
  console.log('Current URL after login:', page.url());

  await page.context().storageState({
    path: 'julian-session.json'
  });

  console.log('Session saved');

  const links = await page.$$eval('a', anchors =>
    anchors
      .map(a => ({
        text: (a.innerText || '').trim(),
        href: a.href
      }))
      .filter(link => link.href)
      .slice(0, 50)
  );

  console.log('Found links after login:');
  console.log(JSON.stringify(links, null, 2));

  await page.screenshot({
    path: 'after-login.png',
    fullPage: true
  });

  console.log('After-login screenshot saved');

  await browser.close();
}

run()
  .then(() => {
    console.log('Julian discovery scraper finished successfully');
    setInterval(() => {}, 1000);
  })
  .catch((error) => {
    console.error('Scraper failed:', error);
    process.exit(1);
  });
