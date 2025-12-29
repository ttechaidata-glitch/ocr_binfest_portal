import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Get the directory of the current module
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables from .env file in project root
// Go up one level from src/ to project root
const envPath = join(__dirname, '..', '.env');
const result = dotenv.config({ path: envPath });

if (result.error) {
  console.warn(`⚠️  Warning: Could not load .env file from ${envPath}`);
  console.warn(`   Error: ${result.error.message}`);
  console.warn('   Continuing with environment variables only...\n');
} else {
  console.log(`✅ Loaded .env file from ${envPath}`);
}

/**
 * Validates that required environment variables are set
 * @param {string[]} required - Array of required variable names
 */
function validateRequired(required) {
  const missing = required.filter(key => !process.env[key]);
  if (missing.length > 0) {
    console.error('❌ Missing required environment variables:');
    missing.forEach(key => console.error(`   - ${key}`));
    console.error('\nPlease set these in your .env file or environment.');
    process.exit(1);
  }
}

// Validate required credentials
validateRequired(['TARGET_URL', 'TARGET_USERNAME', 'TARGET_PASSWORD']);

/**
 * Application configuration loaded from environment variables
 */
const config = {
  // Target site configuration (app + optional separate auth host)
  target: {
    // App origin that we proxy (e.g. https://amazonlpn.com)
    appUrl: process.env.TARGET_URL,
    // Optional auth origin if login happens on a different host (e.g. https://www.accounts.rapidscanapp.com)
    authUrl: process.env.TARGET_AUTH_URL || process.env.TARGET_URL,
    username: process.env.TARGET_USERNAME,
    password: process.env.TARGET_PASSWORD,
    loginPath: process.env.TARGET_LOGIN_PATH || '/login',
    // Optional: force a specific full login URL (overrides authUrl+loginPath)
    authLoginUrl: process.env.TARGET_AUTH_LOGIN_URL || null,
    // Optional overrides for login field names
    usernameField: process.env.TARGET_USERNAME_FIELD || null,
    passwordField: process.env.TARGET_PASSWORD_FIELD || null
  },

  // Session configuration
  session: {
    timeoutMinutes: parseInt(process.env.SESSION_TIMEOUT_MINUTES, 10) || 10,
    cleanupIntervalMs: 60000, // Clean up expired sessions every minute
  },

  // Server configuration
  server: {
    port: parseInt(process.env.PORT, 10) || 3000,
    // Optional: used for QR generation so it doesn't point to localhost when scanned on a phone
    publicBaseUrl: process.env.PUBLIC_BASE_URL || null
  },

  // Security configuration
  security: {
    blockedPaths: process.env.BLOCKED_PATHS
      ? process.env.BLOCKED_PATHS.split(',').map(p => p.trim())
      : ['/settings', '/admin', '/account'],
  },

  debug: {
    auth: String(process.env.DEBUG_AUTH || '').toLowerCase() === 'true'
  }
};

export default config;

