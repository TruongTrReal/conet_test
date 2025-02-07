const fs = require('fs');
const path = require('path');
const os = require('os');
const { Builder, By, until } = require('selenium-webdriver');
const chrome = require('selenium-webdriver/chrome');

/**
 * Creates a Chrome extension to handle proxy authentication.
 * The extension sets the proxy configuration and intercepts auth requests.
 *
 * @param {string} proxyUsername - The proxy username.
 * @param {string} proxyPassword - The proxy password.
 * @param {string} host - The proxy host.
 * @param {string} port - The proxy port.
 * @returns {string} - The path to the temporary extension directory.
 */
function createProxyAuthExtension(proxyUsername, proxyPassword, host, port) {
  // Create a temporary directory for the extension.
  const extensionDir = path.join(os.tmpdir(), `proxy_auth_extension_${Date.now()}`);
  fs.mkdirSync(extensionDir);

  // Create manifest.json for the extension.
  const manifest = {
    "version": "1.0.0",
    "manifest_version": 2,
    "name": "Chrome Proxy Auth Extension",
    "permissions": [
      "proxy",
      "tabs",
      "unlimitedStorage",
      "storage",
      "<all_urls>",
      "webRequest",
      "webRequestBlocking"
    ],
    "background": {
      "scripts": ["background.js"]
    }
  };
  fs.writeFileSync(path.join(extensionDir, 'manifest.json'), JSON.stringify(manifest));

  // Create background.js which sets the proxy settings and handles auth.
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
    chrome.webRequest.onAuthRequired.addListener(
      function(details) {
        return {
          authCredentials: {
            username: "${proxyUsername}",
            password: "${proxyPassword}"
          }
        };
      },
      {urls: ["<all_urls>"]},
      ["blocking"]
    );
  `;
  fs.writeFileSync(path.join(extensionDir, 'background.js'), backgroundJs);

  return extensionDir;
}

/**
 * Helper function that safely clicks on an element given a locator.
 */
async function safeClick(driver, locator) {
  let attempts = 0;
  while (attempts < 3) {
    try {
      const element = await driver.findElement(locator);
      await element.click();
      return; // success
    } catch (err) {
      if (err.name === 'StaleElementReferenceError' || err.name === 'StaleElementReferenceException') {
        attempts++;
        await driver.sleep(500);
      } else {
        throw err;
      }
    }
  }
  throw new Error('Element could not be clicked after multiple attempts');
}

/**
 * Performs the automation steps using the given proxy.
 * This version now loads a dynamically created extension to handle proxy authentication.
 */
async function runAutomation(proxy) {
  // Expect proxy in the format "username:password@host:port"
  const [authPart, serverPart] = proxy.split('@');
  if (!serverPart) {
    console.error(`Invalid proxy format (expected username:password@host:port): ${proxy}`);
    return;
  }
  const [proxyUsername, proxyPassword] = authPart.split(':');
  const [host, port] = serverPart.split(':');

  // Set up Chrome options.
  let options = new chrome.Options();
  // Remove the simple --proxy-server flag; we will load an extension to handle both the proxy server and auth.
  // options.addArguments(`--proxy-server=http://${host}:${port}`);
  options.addArguments('start-maximized');

  // On Linux, adjust headless settings or the Chrome binary path if needed.
  const args = [];
  if (os.platform() === 'linux') {
    // Uncomment the following line if you wish to run in headless mode.
    // args.push('--headless');
    args.push('--no-sandbox', '--disable-gpu');
    options.setChromeBinaryPath('/usr/bin/chromium-browser');
  }
  options.addArguments(args);

  // Create and load the proxy auth extension.
  const extensionPath = createProxyAuthExtension(proxyUsername, proxyPassword, host, port);
  options.addArguments(`--load-extension=${extensionPath}`);

  // Build the WebDriver.
  let driver = await new Builder()
    .forBrowser('chrome')
    .setChromeOptions(options)
    .build();

  try {
    // 1. Open the URL.
    await driver.get('https://platform.conet.network/');

    // 2. Wait for the "create wallet" button and click it.
    const createWalletXpath = '//*[@id="root"]/div[1]/div[2]/div/div/div/div/div[2]/div/button';
    let createWalletBtn = await driver.wait(until.elementLocated(By.xpath(createWalletXpath)), 60000);
    await createWalletBtn.click();

    // 3. Wait a bit for the page transition.
    await driver.sleep(2000);

    // 4. Find both password fields and fill them with "Rtn@2024".
    const passwordXpath = '//*[@id="outlined-password-input"]';
    let passwordFields = await driver.findElements(By.xpath(passwordXpath));
    if (passwordFields.length >= 2) {
      await passwordFields[0].sendKeys('Rtn@2024');
      await passwordFields[1].sendKeys('Rtn@2024');
    } else {
      console.error("Could not locate both password fields.");
    }

    // 5. Click the "create" button.
    const createBtnXpath = '//*[@id="root"]/div[1]/div[2]/div/div/div/div/div[3]/button';
    let createBtn = await driver.wait(until.elementLocated(By.xpath(createBtnXpath)), 10000);
    await createBtn.click();

    await driver.sleep(5000);

    // 6. Locate the element that contains the 12 phrases (if needed).
    const phrasesXpath = '//*[@id="root"]/div[1]/div[2]/div/div/div/div/div[3]/div[1]/p';
    let phrasesElement = await driver.wait(until.elementLocated(By.xpath(phrasesXpath)), 10000);
    // If you want to save the phrases, uncomment the following lines:
    // let phrasesText = await phrasesElement.getText();
    // Save the phrases with proxy info to a JSON file (append to phrases.json)
    // const jsonFile = path.join(__dirname, 'phrases.json');
    // let savedData = fs.existsSync(jsonFile) ? JSON.parse(fs.readFileSync(jsonFile, 'utf-8')) : [];
    // savedData.push({ proxy: proxy, phrases: phrasesText });
    // fs.writeFileSync(jsonFile, JSON.stringify(savedData, null, 2));
    // console.log(`Saved phrases for proxy ${proxy}`);

    // 7. Click on the phrases element.
    const targetLocator = By.css('#root > div.MuiStack-root.css-10vdxbb > div.MuiStack-root.css-6ewln5 > div > div > div > div > div:nth-child(3) > div.MuiContainer-root.MuiContainer-maxWidthLg.css-1regies > p');
    await safeClick(driver, targetLocator);

    // 8. Fill in the password to unlock.
    let unlockPasswordField = await driver.wait(until.elementLocated(By.xpath(passwordXpath)), 10000);
    await unlockPasswordField.sendKeys('Rtn@2024');

    // 9. Click the "unlock" button.
    const unlockBtnXpath = '//*[@id="root"]/div[1]/div[2]/div/div/div/div/div[2]/button';
    let unlockBtn = await driver.wait(until.elementLocated(By.xpath(unlockBtnXpath)), 10000);
    await unlockBtn.click();

    // 10. Wait until the "Welcome to" element appears.
    const welcomeXpath = '//*[@id="welcome" and contains(text(), "Welcome to")]';
    await driver.wait(until.elementLocated(By.xpath(welcomeXpath)), 15000);

    // 11. Scroll down to and click on the "Click to start mining" element.
    const miningXpath = '//*[@id="root"]/div[1]/div[3]/div/div/div[1]/div[2]/div/div[1]/div/div[2]/div/div[2]/div/div/p';
    let miningElement = await driver.wait(until.elementLocated(By.xpath(miningXpath)), 10000);
    await driver.executeScript("arguments[0].scrollIntoView();", miningElement);
    await driver.sleep(10000); // pause briefly after scrolling
    await miningElement.click();

    // Example loop to check mining status.
    while (true) {
      if ((await isMining(driver))) {
        console.log('Driver is mining!');
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

/**
 * Tries to click on the mining element.
 */
async function clickMining(driver) {
  try {
    const miningXpath = '//*[@id="root"]/div[1]/div[3]/div/div/div[1]/div[2]/div/div[1]/div/div[2]/div/div[2]/div/div/p';
    let miningElement = await driver.wait(until.elementLocated(By.xpath(miningXpath)), 10000);
    await driver.sleep(5000);
    await miningElement.click();
    console.log('Click mining success');
    return true;
  } catch (e) {
    console.log('Click mining failed');
    return false;
  }
}

/**
 * Checks if the driver is currently mining.
 */
async function isMining(driver) {
  try {
    const miningXpath = '//*[@id="root"]/div[1]/div[3]/div/div/div[1]/div[2]/div/div[1]/div/div[2]/div/div[1]/div/div/div[1]/div[2]/p[2]';
    await driver.wait(until.elementLocated(By.xpath(miningXpath)), 500);
    console.log('Is mining');
    return true;
  } catch (e) {
    console.log('Is not mining');
    return false;
  }
}

/**
 * Checks for and dismisses any mining-related popups.
 */
async function isDismissing(driver) {
  try {
    const dismissXpath = '//*[@id="root"]/div[1]/div[3]/div/div/div[1]/div[2]/div/div[1]/div/div[2]/div/div[2]/div/div/div[2]/p';
    let dismissElement = await driver.wait(until.elementLocated(By.xpath(dismissXpath)), 500);
    console.log('Dismissing popup found, clicking it...');
    await dismissElement.click();
    console.log('Popup dismissed');
    return true;
  } catch (e) {
    console.log('No dismiss popup found');
    return false;
  }
}

/**
 * Main function: Reads proxies from proxies.txt and runs automation for each.
 */
async function main() {
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

  // Run the automation sequentially for each proxy.
  for (const proxy of proxies) {
    console.log(`Starting automation for proxy: ${proxy}`);
    await runAutomation(proxy);
  }
}

main();
