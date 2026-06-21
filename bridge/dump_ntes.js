const puppeteer = require('puppeteer');
(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.goto('https://enquiry.indianrail.gov.in/mntes/', { waitUntil: 'networkidle0' });
  await new Promise(r => setTimeout(r, 2000));

  // Dismiss overlay
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.trim() === 'X');
    if (btn) btn.click();
  });
  await new Promise(r => setTimeout(r, 800));

  // Click Spot Your Train
  await page.evaluate(() => {
    const link = Array.from(document.querySelectorAll('a')).find(l => l.innerText.includes('Spot Your Train'));
    if (link) link.click();
  });
  await new Promise(r => setTimeout(r, 1500));

  // Type train number
  await page.waitForSelector('#trainNo');
  await page.click('#trainNo');
  await page.evaluate(() => { document.querySelector('#trainNo').value = ''; });
  await page.type('#trainNo', '56714', { delay: 80 });
  await new Promise(r => setTimeout(r, 800));

  // Accept autocomplete or Enter
  try {
    await page.waitForSelector('.tt-suggestion', { timeout: 3000 });
    await page.evaluate(() => { const s = document.querySelector('.tt-suggestion'); if (s) s.click(); });
  } catch (_) { await page.keyboard.press('Enter'); }
  await new Promise(r => setTimeout(r, 3000));

  // Dump EVERYTHING visible now
  const dump = await page.evaluate(() => {
    // All buttons and inputs
    const interactive = Array.from(document.querySelectorAll('button, input, select, a[onclick], a[href="#"]'))
      .map(el => ({
        tag: el.tagName,
        id: el.id,
        class: el.className.slice(0, 50),
        text: (el.innerText || el.value || '').trim().slice(0, 60),
        name: el.name,
        type: el.type
      })).filter(el => el.text || el.id || el.name);

    // HTML around 'Start Date' text
    const allText = document.body.innerText;
    const dateIdx = allText.indexOf('Start Date');
    const dateContext = dateIdx > -1 ? allText.slice(dateIdx - 50, dateIdx + 300) : 'NOT FOUND';

    // Raw HTML of the form/container after train entry
    const form = document.querySelector('form, .w3-container, #spotDiv, #trainStatusDiv, [id*="status"], [id*="spot"]');
    const formHtml = form ? form.outerHTML.slice(0, 2000) : 'NO FORM FOUND';

    return { interactive, dateContext, formHtml };
  });

  console.log('=== INTERACTIVE ELEMENTS ===');
  console.log(JSON.stringify(dump.interactive, null, 2));
  console.log('=== DATE CONTEXT ===');
  console.log(dump.dateContext);
  console.log('=== FORM HTML ===');
  console.log(dump.formHtml);

  await browser.close();
})();
