const { chromium } = require('playwright');

(async () => {

  const browser = await chromium.launch({
    headless: false
  });

  const page = await browser.newPage();

  await page.goto('https://b2bfashion.online');

  console.log('Julian opened');

})();
