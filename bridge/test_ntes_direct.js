const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  const trainNo = '16701';
  console.log(`Navigating directly to train ${trainNo}...`);
  // Try direct navigation
  await page.goto(`https://enquiry.indianrail.gov.in/mntes/q?opt=TrainRunning&subOpt=ShowRunc&trainNo=${trainNo}-TrainName`, { waitUntil: 'networkidle2' });
  
  const text = await page.evaluate(() => document.body.innerText);
  if (text.includes("Yet to start") || text.includes("not running") || text.includes("No instances found")) {
    console.log("Train not running message found.");
  } else if (await page.$('.table-row') || await page.$('.tbl-tracking')) {
    console.log("Tracking table found!");
  } else {
    console.log("Unknown state. Text snippet:", text.substring(0, 200));
  }
  await browser.close();
})();
