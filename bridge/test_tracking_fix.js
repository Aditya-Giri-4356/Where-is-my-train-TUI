const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  const trainNo = '16701';
  console.log(`Testing NTES tracking for train ${trainNo} with slow typing...`);
  
  await page.goto('https://enquiry.indianrail.gov.in/mntes/', { waitUntil: 'networkidle2' });
  await page.waitForSelector('#trainNo', { timeout: 15000 });
  await page.click('#trainNo');
  
  // Type very slowly
  await page.type('#trainNo', trainNo, { delay: 400 });
  
  try {
    console.log("Waiting for .tt-suggestion...");
    await page.waitForSelector('.tt-suggestion', { timeout: 8000 });
    await page.evaluate(() => {
      const sug = document.querySelector('.tt-suggestion');
      if (sug) sug.click();
    });
    console.log("Suggestion clicked.");
  } catch (e) {
    console.log("Suggestion timeout.");
  }

  try {
    await page.waitForFunction(() => {
      const text = document.body.innerText || '';
      return document.querySelector('.table-row') || 
             document.querySelector('.tbl-tracking') || 
             text.includes("Yet to start") || 
             text.includes("not running") || 
             text.includes("No instances found");
    }, { timeout: 15000 });
    
    const text = await page.evaluate(() => document.body.innerText);
    if (text.includes("Yet to start")) {
      console.log("Status: Yet to start.");
    } else if (text.includes("not running")) {
      console.log("Status: Not running.");
    } else {
      console.log("Status: Tracking table found!");
    }
  } catch(e) {
    console.log("Failed to load tracking table.");
  }

  await browser.close();
})();
