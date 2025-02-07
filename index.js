const fs = require('fs');
const path = require('path');
const { Builder, By, until } = require('selenium-webdriver');
const chrome = require('selenium-webdriver/chrome');
const os = require('os');

/**
 * Given a proxy string like "nhjg97q5:UrF1hhOjAD9v@103.139.124.45:26415",
 * generate a temporary Chrome extension directory that sets the proxy and handles authentication.
 */
function createProxyExtension(proxy) {
  // Split the proxy into authentication and server parts
  const [authPart, serverPart] = proxy.split('@');
  const [username, password] = authPart.split(':');
  const [host, port] = serverPart.split(':');

  // Create manifest.json content
  const manifest = {
    version: "1.0.0",
    manifest_version: 2,
    name: "Chrome Proxy",
    permissions: [
      "proxy",
      "tabs",
      "unlimitedStorage",
      "storage",
      "<all_urls>",
      "webRequest",
      "webRequestBlocking"
    ],
    background: {
      scripts: ["background.js"]
    },
    minimum_chrome_version: "22.0.0"
  };

  // Create background.js content that sets the fixed proxy and provides credentials
  const backgroundJs = `
var config = {
  mode: "fixed_servers",
  rules: {
    singleProxy: {
      scheme: "http",
      host: "${host}",
      port: parseInt(${port})
    },
    bypassList: ["localhost"]
  }
};
chrome.proxy.settings.set({value: config, scope: "regular"}, function() {});
function callbackFn(details) {
  return { authCredentials: { username: "${username}", password: "${password}" } };
}
chrome.webRequest.onAuthRequired.addListener(
  callbackFn,
  {urls: ["<all_urls>"]},
  ["blocking"]
);
  `;

  // Create a unique temporary directory for the extension
  const extDir = path.join(__dirname, `proxy_ext_${host}_${port}`);
  if (!fs.existsSync(extDir)) {
    fs.mkdirSync(extDir);
  }
  fs.writeFileSync(path.join(extDir, 'manifest.json'), JSON.stringify(manifest));
  fs.writeFileSync(path.join(extDir, 'background.js'), backgroundJs);

  return extDir;
}

/**
 * Performs the automation steps for one proxy.
 * The steps are:
 *  1. Open the URL
 *  2. Wait until page loads
 *  3. Click "create wallet" button
 *  4. Wait a bit, fill in and confirm the password "Rtn@2024"
 *  5. Click the "create" button
 *  6. Click the "copy 12 phrases" button, then capture the 12 phrases text
 *  7. Save the phrase (with proxy info) into a JSON file (appending to phrases.json)
 *  8. Click on the phrases element, fill the password again, and click the "unlock" button
 *  9. Wait until the "Welcome to" element appears
 * 10. Scroll down to and click on the "Click to start mining" element
 */

async function safeClick(driver, locator) {
  let attempts = 0;
  while (attempts < 3) {
    try {
      // Re-find the element each time
      const element = await driver.findElement(locator);
      await element.click();
      return; // success, exit the function
    } catch (err) {
      // Check if the error is due to stale element reference
      if (err.name === 'StaleElementReferenceError' || err.name === 'StaleElementReferenceException') {
        attempts++;
        // Optionally wait for a short time before retrying
        await driver.sleep(500);
      } else {
        throw err; // rethrow if it's another error
      }
    }
  }
  throw new Error('Element could not be clicked after multiple attempts');
}


async function runAutomation(proxy) {
  // Create the extension directory for this proxy
  const extPath = createProxyExtension(proxy);

  // Set up Chrome options to load the proxy extension
  let options = new chrome.Options();
  options.addArguments(`--load-extension=${extPath}`);
  options.addArguments('start-maximized');

  const args = [];

  if (os.platform() === 'linux') {
    args.push('--headless', '--no-sandbox', '--disable-gpu');
    options.setChromeBinaryPath('/usr/bin/chromium-browser');
  }

  options.addArguments(args);

  // Build the driver with Chrome
  let driver = await new Builder()
    .forBrowser('chrome')
    .setChromeOptions(options)
    .build();

  try {
    // 1. Open the URL
    await driver.get('https://platform.conet.network/');

    // 2. Wait until the "create wallet" button is located (adjust timeout as needed)
    const createWalletXpath = '//*[@id="root"]/div[1]/div[2]/div/div/div/div/div[2]/div/button';
    let createWalletBtn = await driver.wait(until.elementLocated(By.xpath(createWalletXpath)), 60000);
    await createWalletBtn.click();

    // 3. Wait a bit for the page transition
    await driver.sleep(2000);

    // 4. Find both password fields (they share the same xpath) and fill them with "Rtn@2024"
    const passwordXpath = '//*[@id="outlined-password-input"]';
    let passwordFields = await driver.findElements(By.xpath(passwordXpath));
    if (passwordFields.length >= 2) {
      await passwordFields[0].sendKeys('Rtn@2024');
      await passwordFields[1].sendKeys('Rtn@2024');
    } else {
      console.error("Could not locate both password fields.");
    }

    // 5. Click the "create" button
    const createBtnXpath = '//*[@id="root"]/div[1]/div[2]/div/div/div/div/div[3]/button';
    let createBtn = await driver.wait(until.elementLocated(By.xpath(createBtnXpath)), 10000);
    await createBtn.click();

    await driver.sleep(5000);

    // 6. Click the "copy 12 phrases" button
    // const copyButtonXpath = '//*[@id="root"]/div[1]/div[2]/div/div/div/div/div[3]/div[1]/button/div';
    // let copyButton = await driver.wait(until.elementLocated(By.xpath(copyButtonXpath)), 10000);
    // await copyButton.click();

    // const toastLocator = By.css('.Toastify__toast-container--bottom-center');
    // await driver.wait(until.elementIsNotVisible(driver.findElement(toastLocator)), 10000);
    

    // 7. Get the 12 phrases text from the element (assumed to be in the following element)
    const phrasesXpath = '//*[@id="root"]/div[1]/div[2]/div/div/div/div/div[3]/div[1]/p';
    const targetLocator = By.css('#root > div.MuiStack-root.css-10vdxbb > div.MuiStack-root.css-6ewln5 > div > div > div > div > div:nth-child(3) > div.MuiContainer-root.MuiContainer-maxWidthLg.css-1regies > p');
    let phrasesElement = await driver.wait(until.elementLocated(By.xpath(phrasesXpath)), 10000);
    // let phrasesText = await phrasesElement.getText();

    // // Save the phrases to a JSON file (phrases.json). Append this proxy’s result.
    // const jsonFile = path.join(__dirname, 'phrases.json');
    // let savedData = [];
    // if (fs.existsSync(jsonFile)) {
    //   savedData = JSON.parse(fs.readFileSync(jsonFile, 'utf-8'));
    // }
    // savedData.push({ proxy: proxy, phrases: phrasesText });
    // fs.writeFileSync(jsonFile, JSON.stringify(savedData, null, 2));
    // console.log(`Saved phrases for proxy ${proxy}`);

    // 8. Click the phrases element (as instructed), then fill in the password again
    await safeClick(driver, targetLocator);

    // await driver.sleep(5000000);

    let unlockPasswordField = await driver.wait(until.elementLocated(By.xpath(passwordXpath)), 10000);
    await unlockPasswordField.sendKeys('Rtn@2024');

    // 9. Click the "unlock" button
    const unlockBtnXpath = '//*[@id="root"]/div[1]/div[2]/div/div/div/div/div[2]/button';
    let unlockBtn = await driver.wait(until.elementLocated(By.xpath(unlockBtnXpath)), 10000);
    await unlockBtn.click();

    // 10. Wait until the "Welcome to" element appears.
    // Here we wait for an element with id "welcome" that contains the text "Welcome to"
    const welcomeXpath = '//*[@id="welcome" and contains(text(), "Welcome to")]';
    await driver.wait(until.elementLocated(By.xpath(welcomeXpath)), 15000);

    // 11. Scroll down to find the "Click to start mining" element and click it.
    const miningXpath = '//*[@id="root"]/div[1]/div[3]/div/div/div[1]/div[2]/div/div[1]/div/div[2]/div/div[2]/div/div/p';
    let miningElement = await driver.wait(until.elementLocated(By.xpath(miningXpath)), 10000);
    // Scroll into view
    await driver.executeScript("arguments[0].scrollIntoView();", miningElement);
    await driver.sleep(10000); // brief pause after scrolling
    await miningElement.click();

    while (true) {
      if ((await isMining(driver))) {
        console.log('driver is mining!');
      } else if ((await isDismissing(driver))) {
        await clickMining(driver);
      } else {
        await clickMining(driver);
      }
    }

  } catch (err) {
    console.error(`Error automating proxy ${proxy}:`, err);
  } finally {
    await driver.quit();
  }
}

async function clickMining(driver) {
  try {
    const miningXpath = '//*[@id="root"]/div[1]/div[3]/div/div/div[1]/div[2]/div/div[1]/div/div[2]/div/div[2]/div/div/p';
    let miningElement = await driver.wait(until.elementLocated(By.xpath(miningXpath)), 10000);
    await driver.sleep(5000);
    await miningElement.click();
    console.log('click mining success');
    return true;
  } catch (e) {
    console.log('click mining fail');
    return false;
  }
}

async function isMining(driver) {
  try {
    const miningXpath = '//*[@id="root"]/div[1]/div[3]/div/div/div[1]/div[2]/div/div[1]/div/div[2]/div/div[1]/div/div/div[1]/div[2]/p[2]';
    let miningElement = await driver.wait(until.elementLocated(By.xpath(miningXpath)), 500);
    console.log('is Mining');
    return true;
  } catch (e) {
    console.log('is not Mining');
    return false;
  }
}

async function isDismissing(driver) {
  try {
    const dismissXpath = '//*[@id="root"]/div[1]/div[3]/div/div/div[1]/div[2]/div/div[1]/div/div[2]/div/div[2]/div/div/div[2]/p';
    let dismissElement = await driver.wait(until.elementLocated(By.xpath(dismissXpath)), 500);
    console.log('is Dismiss');
    console.log('clicking Dismiss btn...');
    await dismissElement.click();
    console.log('Dismiss clicked');
    return true;
  } catch (e) {
    console.log('is not Dismiss');
    return false;
  }
}

/**
 * Main function: Reads proxies from proxies.txt and runs automation for each.
 */
async function main() {
  // Read proxies from file; each non-empty line is assumed to be one proxy in the proper format.
  const proxiesFile = path.join(__dirname, 'proxies.txt');
  if (!fs.existsSync(proxiesFile)) {
    console.error("proxies.txt file not found.");
    return;
  }
  const proxies = fs
    .readFileSync(proxiesFile, 'utf-8')
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0);

  // You can run them sequentially or in parallel. Here we run them sequentially.
  for (const proxy of proxies) {
    console.log(`Starting automation for proxy: ${proxy}`);
    await runAutomation(proxy);
  }
}

main()
