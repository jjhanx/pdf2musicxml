const puppeteer = require('puppeteer');

(async () => {
    const browser = await puppeteer.launch();
    const page = await browser.newPage();
    
    page.on('console', msg => console.log('PAGE LOG:', msg.text()));
    page.on('pageerror', err => console.log('PAGE ERROR:', err.message));
    
    await page.goto('file:///' + __dirname.replace(/\\/g, '/') + '/_smoke/test_osmd_html.html');
    
    // wait a bit for parsing
    await new Promise(r => setTimeout(r, 2000));
    
    await browser.close();
})();
