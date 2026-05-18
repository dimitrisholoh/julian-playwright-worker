async function scrapeLiveProduct(page, row) {

  const supplierProductCode = cleanText(row.cod);

  const loginUrl = new URL(process.env.JULIAN_LOGIN_URL);
  const baseUrl = `${loginUrl.protocol}//${loginUrl.host}`;

  const searchUrl =
    `${baseUrl}/index.php?controller=search&orderby=position&orderway=desc&s=${encodeURIComponent(supplierProductCode)}`;

  console.log('Opening live product search:', supplierProductCode);

  await page.goto(searchUrl, {
    waitUntil: 'domcontentloaded',
    timeout: 120000
  });

  await page.waitForTimeout(3000);

  const productLink = page.locator('a.product_img_link').first();

  if (!(await productLink.count())) {

    console.log('No product found:', supplierProductCode);

    return {
      supplier_retail_price: null,
      supplier_final_price: null,
      discount_percent: null,

      product_url: null,
      page_text: null,

      spu: null,

      composition_raw: null,
      made_in_raw: null,
      size_and_fit_raw: null,
      type_raw: null,
      color_raw: null,
      gender_raw: null,
      season_raw: null,

      images: [],
      variants: []
    };
  }

  const href = await productLink.getAttribute('href');

  if (!href) {

    console.log('No href found:', supplierProductCode);

    return {
      supplier_retail_price: null,
      supplier_final_price: null,
      discount_percent: null,

      product_url: null,
      page_text: null,

      spu: null,

      composition_raw: null,
      made_in_raw: null,
      size_and_fit_raw: null,
      type_raw: null,
      color_raw: null,
      gender_raw: null,
      season_raw: null,

      images: [],
      variants: []
    };
  }

  console.log('Opening product page:', href);

  await page.goto(href, {
    waitUntil: 'domcontentloaded',
    timeout: 120000
  });

  await page.waitForTimeout(5000);

  const pageText = await page.locator('body').innerText({
    timeout: 30000
  });

  function extractValue(label) {

    const regex = new RegExp(
      `${label}\\s*:?\\s*([^\\n]+)`,
      'i'
    );

    const match = pageText.match(regex);

    return match ? cleanText(match[1]) : null;
  }

  const retailFromPage = extractRetailPrice(pageText);
  const finalFromPage = extractFinalPrice(pageText);

  let discountPercent = null;

  if (
    retailFromPage &&
    finalFromPage &&
    retailFromPage > finalFromPage
  ) {

    discountPercent = Math.round(
      (
        (retailFromPage - finalFromPage)
        / retailFromPage
      ) * 100
    );
  }

  const composition =
    extractValue('COMPOSITION') ||
    extractValue('Composition') ||
    extractValue('Material');

  const madeIn =
    extractValue('MADE IN') ||
    extractValue('Made in');

  const sizeAndFit =
    extractValue('SIZE AND FIT') ||
    extractValue('Size and Fit');

  const type =
    extractValue('TYPE') ||
    extractValue('Category');

  const color =
    extractValue('COLOR') ||
    extractValue('Colour');

  const gender =
    extractValue('GENDER') ||
    extractValue('Gender');

  const season =
    extractValue('SEASON') ||
    extractValue('Season');

  const spu =
    extractValue('SPU') ||
    extractValue('SKU');

  const images = await page.$$eval(
    'img',
    imgs =>
      imgs
        .map(img => img.src)
        .filter(Boolean)
        .filter(src =>
          src.includes('julianfashionstorage') ||
          src.includes('/img/')
        )
  );

  const uniqueImages = [...new Set(images)];

  const rows = await page.$$eval(
    'tr',
    trs =>
      trs
        .map(tr => tr.innerText)
        .filter(Boolean)
  ).catch(() => []);

  const detectedVariants = [];

  for (const rowText of rows) {

    const clean = rowText
      .replace(/\s+/g, ' ')
      .trim();

    const sizeMatch =
      clean.match(/^([A-Z0-9./-]+)\s+/i);

    const qtyMatch =
      clean.match(/(\d+)\s*pc/i);

    if (sizeMatch || qtyMatch) {

      detectedVariants.push({

        supplier_size:
          sizeMatch ? sizeMatch[1] : null,

        stock_quantity:
          qtyMatch ? Number(qtyMatch[1]) : null,

        raw_text: clean
      });
    }
  }

  return {

    supplier_retail_price: retailFromPage,
    supplier_final_price: finalFromPage,
    discount_percent: discountPercent,

    product_url: page.url(),
    page_text: pageText,

    spu,

    composition_raw: composition,
    made_in_raw: madeIn,
    size_and_fit_raw: sizeAndFit,
    type_raw: type,
    color_raw: color,
    gender_raw: gender,
    season_raw: season,

    images: uniqueImages,

    variants: detectedVariants
  };
}
