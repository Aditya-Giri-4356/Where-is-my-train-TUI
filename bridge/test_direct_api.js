const puppeteer = require('puppeteer');

// Date helper: DD-MM-YYYY to DD-MMM-YYYY (e.g. 19-06-2026 to 19-Jun-2026)
function convertDateFormat(dateStr) {
  const parts = dateStr.split('-');
  if (parts.length !== 3) return dateStr;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const monthIdx = parseInt(parts[1], 10) - 1;
  if (monthIdx < 0 || monthIdx > 11) return dateStr;
  return `${parts[0]}-${months[monthIdx]}-${parts[2]}`;
}

(async () => {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  const trainNo = '16701';
  
  // To get today's date in format DD-MMM-YYYY
  const today = new Date();
  const dd = String(today.getDate()).padStart(2, '0');
  const mm = String(today.getMonth() + 1).padStart(2, '0'); //January is 0!
  const yyyy = today.getFullYear();
  const dateStr = convertDateFormat(`${dd}-${mm}-${yyyy}`);
  
  console.log(`Testing direct API scraping for train ${trainNo} on ${dateStr}...`);
  
  // Step 1: Visit main page to get session cookies
  await page.goto('https://enquiry.indianrail.gov.in/mntes/', { waitUntil: 'networkidle2' });
  
  // Step 2: Hit the internal AJAX endpoint
  const url = `https://enquiry.indianrail.gov.in/mntes/q?opt=TrainRunning&subOpt=ShowRunc&trainNo=${trainNo}&jStation=&pStation=&jDate=${dateStr}`;
  console.log("Fetching internal URL: ", url);
  await page.goto(url, { waitUntil: 'networkidle2' });
  
  const text = await page.evaluate(() => document.body.innerText);
  console.log(text.substring(0, 500));
  
  if (text.includes("Yet to start") || text.includes("not running") || text.includes("No instances found")) {
    console.log("Status: Not running.");
  } else if (text.includes("Sch:") || text.includes("Act:")) {
    console.log("Status: Tracking table found!");
  } else {
    console.log("Unknown status.");
  }

  await browser.close();
})();
