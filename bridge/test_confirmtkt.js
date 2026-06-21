const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  const trainNo = '16701';
  
  console.log(`Testing ConfirmTkt scraping for train ${trainNo}...`);
  
  await page.goto(`https://www.confirmtkt.com/train-running-status/${trainNo}`, { waitUntil: 'networkidle2' });
  
  const text = await page.evaluate(() => document.body.innerText);
  
  console.log(text.substring(0, 500));
  
  if (text.includes("running status")) {
    console.log("Success! We can scrape ConfirmTkt.");
  } else {
    console.log("Something else.");
  }

  await browser.close();
})();
