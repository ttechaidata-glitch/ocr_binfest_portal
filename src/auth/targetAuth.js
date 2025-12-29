import puppeteer from 'puppeteer';
import config from '../config.js';

/**
 * Target site authentication manager using Puppeteer for JS-based login
 * Captures JWT tokens from localStorage after login
 */
class TargetAuth {
  constructor() {
    this.authToken = null;
    this.authInfo = null;
    this.lastLoginTime = null;
    this.isLoggingIn = false;
    this.browser = null;
  }

  isAuthenticated() {
    return this.authToken !== null && this.lastLoginTime !== null;
  }

  /**
   * Get Authorization header for proxy requests
   */
  getAuthHeaders() {
    if (!this.authToken) {
      return {};
    }
    return {
      'Authorization': `Bearer ${this.authToken}`
    };
  }

  /**
   * Main login flow using Puppeteer
   * Automates browser to handle JavaScript-based login
   */
  async login() {
    if (this.isLoggingIn) {
      console.log('⏳ Login already in progress, waiting...');
      while (this.isLoggingIn) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      return this.isAuthenticated();
    }

    this.isLoggingIn = true;

    try {
      console.log(`🔐 Logging in via browser automation...`);
      
      // Launch browser
      if (!this.browser) {
        this.browser = await puppeteer.launch({
          headless: true,
          args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
      }

      const page = await this.browser.newPage();

      try {
        // Set user agent
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        // Navigate to login page
        const loginUrl = config.target.authLoginUrl || 
                        new URL(config.target.loginPath, config.target.authUrl).toString();
        
        if (config.debug.auth) {
          console.log(`🐛 Loading login page: ${loginUrl}`);
        }

        await page.goto(loginUrl, {
          waitUntil: 'networkidle2',
          timeout: 30000
        });

        // Wait for form fields
        await page.waitForSelector('input[name="email"]', { timeout: 10000 });
        await page.waitForSelector('input[name="password"]', { timeout: 10000 });

        if (config.debug.auth) {
          console.log(`🐛 Filling credentials...`);
        }

        // Fill the form
        await page.type('input[name="email"]', config.target.username);
        await page.type('input[name="password"]', config.target.password);

        // Submit form
        const submitButton = await page.$('button[type="submit"]');
        if (!submitButton) {
          throw new Error('Submit button not found');
        }

        if (config.debug.auth) {
          console.log(`🐛 Submitting login...`);
        }

        // Click and wait for navigation
        await Promise.all([
          submitButton.click(),
          page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(() => {})
        ]);

        // Wait a bit for any additional redirects/loading
        await new Promise(resolve => setTimeout(resolve, 2000));

        const finalUrl = page.url();
        if (config.debug.auth) {
          console.log(`🐛 Final URL: ${finalUrl}`);
        }

        // Extract tokens from localStorage
        const storage = await page.evaluate(() => {
          return {
            authToken: localStorage.getItem('AUTH_TOKEN'),
            authInfo: localStorage.getItem('AUTH_INFO')
          };
        });

        if (!storage.authToken) {
          // Check if still on login page = failed
          if (finalUrl.includes('/login')) {
            throw new Error('Login failed - still on login page. Check credentials.');
          }
          throw new Error('No AUTH_TOKEN found in localStorage after login');
        }

        this.authToken = storage.authToken;
        this.authInfo = storage.authInfo;
        this.lastLoginTime = Date.now();

        console.log(`✅ Login successful! Token obtained (length: ${this.authToken.length})`);
        console.log(`📍 Authenticated to: ${finalUrl}`);

        return true;

      } finally {
        await page.close();
      }

    } catch (error) {
      console.error('❌ Login failed:', error.message);
      return false;
    } finally {
      this.isLoggingIn = false;
    }
  }

  /**
   * Refresh authentication
   */
  async refreshIfNeeded() {
    console.log('🔄 Refreshing authentication...');
    this.authToken = null;
    this.authInfo = null;
    this.lastLoginTime = null;
    return this.login();
  }

  /**
   * Handle authentication errors from proxy responses
   */
  async handleAuthError(statusCode) {
    if (statusCode === 401 || statusCode === 403) {
      console.log(`⚠️ Received ${statusCode} from target, attempting re-login...`);
      return this.refreshIfNeeded();
    }
    return false;
  }

  /**
   * Cleanup browser on shutdown
   */
  async cleanup() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }
}

// Export singleton instance
const targetAuth = new TargetAuth();
export default targetAuth;
