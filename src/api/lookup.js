import puppeteer from 'puppeteer';
import { existsSync } from 'fs';
import { join } from 'path';
import config from '../config.js';

// ============================================
// Configuration
// ============================================
const POOL_SIZE = 3;           // Number of browser pages in pool
const MAX_CONCURRENT = 5;      // Max concurrent lookups
const CACHE_TTL = 5 * 60 * 1000; // Cache results for 5 minutes
const PAGE_TIMEOUT = 10000;    // Page load timeout

// ============================================
// State
// ============================================
let browser = null;
let authTokens = null;
let pagePool = [];             // Pool of ready pages
let pageInUse = new Set();     // Track which pages are being used
let requestQueue = [];         // Queue of pending requests
let activeRequests = 0;        // Current number of active requests
const cache = new Map();       // LRU-style cache for results

// ============================================
// Cache Management
// ============================================
function getCached(key) {
  const item = cache.get(key);
  if (!item) return null;
  if (Date.now() > item.expiresAt) {
    cache.delete(key);
    return null;
  }
  return item.data;
}

function setCache(key, data) {
  // Limit cache size
  if (cache.size > 100) {
    const firstKey = cache.keys().next().value;
    cache.delete(firstKey);
  }
  cache.set(key, { data, expiresAt: Date.now() + CACHE_TTL });
}

// ============================================
// Browser & Page Pool Management
// ============================================
async function initialize() {
  if (browser && authTokens) {
    return true;
  }

  console.log('🚀 Initializing browser...');
  
  // Find Chrome executable
  let executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || process.env.CHROME_BIN;
  
  // If not set, try to find it in common locations (for Render deployment)
  if (!executablePath) {
    const possiblePaths = [
      // Render cache location
      '/opt/render/project/.render/.cache/puppeteer/chrome/linux-*/chrome-linux64/chrome',
      '/opt/render/.cache/puppeteer/chrome/linux-*/chrome-linux64/chrome',
      // Local development
      join(process.cwd(), 'node_modules', 'puppeteer', '.local-chromium', '**', 'chrome'),
      // Common system paths
      '/usr/bin/chromium-browser',
      '/usr/bin/chromium',
      '/usr/bin/google-chrome'
    ];
    
    // Check Render cache with version directories
    const renderCacheDir = process.env.PUPPETEER_CACHE_DIR || '/opt/render/project/.render/.cache/puppeteer';
    const chromeDirPath = join(renderCacheDir, 'chrome');
    
    try {
      if (existsSync(chromeDirPath)) {
        const { readdirSync } = await import('fs');
        const versions = readdirSync(chromeDirPath);
        for (const version of versions) {
          const chromePath = join(chromeDirPath, version, 'chrome-linux64', 'chrome');
          if (existsSync(chromePath)) {
            executablePath = chromePath;
            console.log(`✅ Found Chrome at: ${chromePath}`);
            break;
          }
        }
      }
    } catch (e) {
      console.log('Chrome auto-detection:', e.message);
    }
    
    // Fallback: check simple paths
    if (!executablePath) {
      for (const p of ['/usr/bin/chromium-browser', '/usr/bin/chromium', '/usr/bin/google-chrome']) {
        if (existsSync(p)) {
          executablePath = p;
          console.log(`✅ Found Chrome at: ${p}`);
          break;
        }
      }
    }
  }
  
  console.log(`🌐 Launching browser${executablePath ? ' with: ' + executablePath : ' (auto-detect)'}...`);
  
  browser = await puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--no-first-run',
      '--disable-extensions',
      '--disable-background-networking',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',
      '--disable-ipc-flooding-protection'
    ],
    executablePath: executablePath || undefined
  });

  // Authenticate once
  console.log('🔐 Authenticating...');
  const page = await browser.newPage();
  
  try {
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
    
    await page.goto('https://www.accounts.rapidscanapp.com/login', { 
      waitUntil: 'networkidle2', 
      timeout: 30000 
    });

    await page.waitForSelector('input[name="email"]', { timeout: 10000 });
    await page.type('input[name="email"]', config.target.username);
    await page.type('input[name="password"]', config.target.password);

    const submitButton = await page.$('button[type="submit"]');
    await Promise.all([
      submitButton.click(),
      page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(() => {})
    ]);

    await new Promise(r => setTimeout(r, 2000));

    authTokens = await page.evaluate(() => ({
      AUTH_TOKEN: localStorage.getItem('AUTH_TOKEN'),
      AUTH_INFO: localStorage.getItem('AUTH_INFO')
    }));

    if (authTokens.AUTH_TOKEN) {
      console.log('✅ Authenticated successfully!');
    } else {
      console.error('❌ Failed to get auth tokens');
      return false;
    }

    // Initialize page pool
    await initializePagePool();
    
    return true;

  } catch (error) {
    console.error('❌ Auth failed:', error.message);
    return false;
  } finally {
    await page.close();
  }
}

async function initializePagePool() {
  console.log(`📦 Creating page pool (${POOL_SIZE} pages)...`);
  
  for (let i = 0; i < POOL_SIZE; i++) {
    try {
      const page = await createReadyPage();
      pagePool.push(page);
      console.log(`   Page ${i + 1}/${POOL_SIZE} ready`);
    } catch (e) {
      console.error(`   Failed to create page ${i + 1}:`, e.message);
    }
  }
  
  console.log(`✅ Page pool ready (${pagePool.length} pages)`);
}

async function createReadyPage() {
  const page = await browser.newPage();
  
  // Optimize page settings
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
  await page.setRequestInterception(true);
  
  // Block unnecessary resources to speed up loading
  page.on('request', (req) => {
    const type = req.resourceType();
    if (['image', 'stylesheet', 'font', 'media'].includes(type)) {
      req.abort();
    } else {
      req.continue();
    }
  });
  
  // Set localStorage
  await page.goto('https://www.amzlpn.com', { waitUntil: 'domcontentloaded', timeout: PAGE_TIMEOUT });
  await page.evaluate((tokens) => {
    localStorage.setItem('AUTH_TOKEN', tokens.AUTH_TOKEN);
    if (tokens.AUTH_INFO) {
      localStorage.setItem('AUTH_INFO', tokens.AUTH_INFO);
    }
  }, authTokens);
  
  return page;
}

async function getAvailablePage() {
  // Find an available page from pool
  for (const page of pagePool) {
    if (!pageInUse.has(page)) {
      pageInUse.add(page);
      return page;
    }
  }
  
  // No available page, create a temporary one if under limit
  if (pagePool.length + pageInUse.size < POOL_SIZE * 2) {
    const page = await createReadyPage();
    pageInUse.add(page);
    return page;
  }
  
  return null; // Will be queued
}

function releasePage(page) {
  pageInUse.delete(page);
  
  // If this was a temporary page, close it
  if (!pagePool.includes(page)) {
    page.close().catch(() => {});
  }
  
  // Process queue
  processQueue();
}

// ============================================
// Request Queue Management
// ============================================
function processQueue() {
  while (requestQueue.length > 0 && activeRequests < MAX_CONCURRENT) {
    const next = requestQueue.shift();
    if (next) {
      next.resolve();
    }
  }
}

async function waitForSlot() {
  if (activeRequests < MAX_CONCURRENT) {
    activeRequests++;
    return;
  }
  
  // Wait in queue
  await new Promise(resolve => {
    requestQueue.push({ resolve });
  });
  activeRequests++;
}

function releaseSlot() {
  activeRequests--;
  processQueue();
}

// ============================================
// Main Lookup Function
// ============================================
export async function lookupNumber(number) {
  const cleanNumber = String(number).replace(/[^a-zA-Z0-9]/g, '');
  
  if (!cleanNumber || cleanNumber.length < 3) {
    return { success: false, error: 'Invalid number format' };
  }

  // Check cache first
  const cached = getCached(cleanNumber);
  if (cached) {
    console.log(`📦 Cache hit: ${cleanNumber}`);
    return { ...cached, fromCache: true };
  }

  // Ensure authenticated
  if (!authTokens) {
    const ok = await initialize();
    if (!ok) {
      return { success: false, error: 'Authentication failed' };
    }
  }

  // Wait for a slot in the queue
  await waitForSlot();
  
  console.log(`🔍 Looking up: ${cleanNumber} (active: ${activeRequests}, queue: ${requestQueue.length})`);
  const startTime = Date.now();

  let page = null;
  
  try {
    // Get a page from pool
    page = await getAvailablePage();
    
    if (!page) {
      // All pages busy, wait a bit and retry
      await new Promise(r => setTimeout(r, 500));
      page = await getAvailablePage();
    }
    
    if (!page) {
      throw new Error('No pages available');
    }

    const lookupUrl = `https://www.amzlpn.com/${cleanNumber}`;
    await page.goto(lookupUrl, { waitUntil: 'domcontentloaded', timeout: PAGE_TIMEOUT });

    // Wait for content (short timeout)
    try {
      await page.waitForFunction(
        () => !document.body.innerText.includes('Loading') && document.body.innerText.length > 200,
        { timeout: 5000 }
      );
    } catch (e) {
      // Continue anyway
    }

    // Extract data
    const data = await page.evaluate(() => {
      const result = { data: {}, image: null };
      const fullText = document.body.innerText;
      
      // Extract fields
      const patterns = [
        { key: 'LPN', regex: /LPN\s*[:\s]?\s*([A-Z0-9]+)/i },
        { key: 'UPC', regex: /UPC\s*[:\s]?\s*(\d+)/i },
        { key: 'ASIN', regex: /ASIN\s*[:\s]?\s*([A-Z0-9]+)/i },
        { key: 'Brand', regex: /Brand\s*[:\s]?\s*([A-Za-z0-9\s]+?)(?=Category|Price|$)/i },
        { key: 'Price', regex: /Price\s*[:\s]?\s*\$?([\d.]+)/i },
        { key: 'Category', regex: /Category\s*[:\s]?\s*([A-Za-z\s]+?)(?=Price|Brand|$)/i }
      ];

      patterns.forEach(({key, regex}) => {
        const match = fullText.match(regex);
        if (match && match[1]) {
          result.data[key] = match[1].trim();
        }
      });

      // Product name
      const productMatch = fullText.match(/LPN Details\s*(.+?)\s*LPN/s);
      if (productMatch && productMatch[1] && productMatch[1].length > 10) {
        result.data['Product'] = productMatch[1].trim();
      }

      // Image - check src attribute, don't rely on loaded dimensions
      const images = document.querySelectorAll('img');
      for (const img of images) {
        const src = img.src || img.getAttribute('src');
        if (src && 
            !src.includes('logo') && 
            !src.includes('icon') && 
            !src.includes('avatar') && 
            !src.includes('data:') &&
            !src.includes('profile') &&
            (src.includes('amazon') || src.includes('media') || src.includes('product') || src.includes('images'))) {
          result.image = src;
          break;
        }
      }

      result.notFound = fullText.includes('not found') || fullText.includes('404');
      return result;
    });

    const duration = Date.now() - startTime;
    console.log(`✅ Lookup done in ${duration}ms`);

    const result = {
      success: true,
      number: cleanNumber,
      url: `https://www.amzlpn.com/${cleanNumber}`,
      data: Object.keys(data.data).length > 0 ? data.data : null,
      image: data.image,
      notFound: data.notFound,
      duration
    };

    // Cache the result
    setCache(cleanNumber, result);

    return result;

  } catch (error) {
    console.error(`❌ Lookup failed: ${error.message}`);
    
    // Reset page on error
    if (page && pagePool.includes(page)) {
      const idx = pagePool.indexOf(page);
      pagePool.splice(idx, 1);
      page.close().catch(() => {});
      
      // Create replacement page async
      createReadyPage().then(newPage => {
        pagePool.push(newPage);
      }).catch(() => {});
    }
    
    if (error.message.includes('401') || error.message.includes('403')) {
      authTokens = null;
      return { success: false, error: 'Session expired. Please try again.' };
    }
    
    return { success: false, error: error.message };
    
  } finally {
    if (page) {
      releasePage(page);
    }
    releaseSlot();
  }
}

// ============================================
// Exports
// ============================================
export async function preAuth() {
  return initialize();
}

export async function cleanup() {
  for (const page of pagePool) {
    try { await page.close(); } catch (e) {}
  }
  pagePool = [];
  pageInUse.clear();
  
  if (browser) {
    await browser.close();
    browser = null;
    authTokens = null;
  }
  
  cache.clear();
}

export function getStats() {
  return {
    poolSize: pagePool.length,
    pagesInUse: pageInUse.size,
    activeRequests,
    queueLength: requestQueue.length,
    cacheSize: cache.size
  };
}
