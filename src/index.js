import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { v4 as uuidv4 } from 'uuid';
import cookieParser from 'cookie-parser';
import config from './config.js';
import { lookupNumber, preAuth, cleanup as cleanupLookup, getStats as getLookupStats } from './api/lookup.js';
import sessionManager from './sessions/sessionManager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();

// Trust proxy
app.set('trust proxy', 1);

// Parse cookies
app.use(cookieParser());

// Parse JSON bodies with increased limit for images
app.use(express.json({ limit: '10mb' }));

// Request logging
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`${req.method} ${req.path} -> ${res.statusCode} (${duration}ms)`);
  });
  next();
});

// Gemini API key (from env)
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// Admin password (from env or default)
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

// Validate Gemini API key
if (!GEMINI_API_KEY) {
  console.warn('⚠️  Warning: GEMINI_API_KEY not set in .env - OCR will not work');
}

// Admin tokens (simple in-memory auth)
const adminTokens = new Set();

// ============================================
// Admin Routes (no session required)
// ============================================

// Serve admin page
app.get('/admin', (req, res) => {
  res.sendFile(join(__dirname, '..', 'public', 'admin.html'));
});

// Admin login
app.post('/admin/login', (req, res) => {
  const { password } = req.body;
  
  if (password === ADMIN_PASSWORD) {
    const token = uuidv4();
    adminTokens.add(token);
    console.log('🔐 Admin logged in');
    res.json({ success: true, token });
  } else {
    res.status(401).json({ success: false, error: 'Invalid password' });
  }
});

// Check admin auth
app.get('/admin/check', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (adminTokens.has(token)) {
    res.json({ success: true });
  } else {
    res.status(401).json({ success: false });
  }
});

// Generate QR code
app.post('/admin/generate-qr', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!adminTokens.has(token)) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }
  
  const { durationMinutes = 10 } = req.body;
  
  // Get base URL (use PUBLIC_BASE_URL if set, otherwise construct from request)
  const baseUrl = config.server.publicBaseUrl || 
    `${req.protocol}://${req.get('host')}`;
  
  try {
    const qr = await sessionManager.generateQRCode(durationMinutes, baseUrl);
    res.json({ success: true, qr });
  } catch (error) {
    console.error('QR generation error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get current QR
app.get('/admin/current-qr', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!adminTokens.has(token)) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }
  
  const qr = sessionManager.getCurrentQR();
  res.json({ success: true, qr });
});

// Get stats
app.get('/admin/stats', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!adminTokens.has(token)) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }
  
  // Combine session and lookup stats
  const sessionStats = sessionManager.getStats();
  const lookupStats = getLookupStats();
  
  res.json({
    ...sessionStats,
    lookup: lookupStats
  });
});

// ============================================
// Session Routes
// ============================================

// Start session from QR scan
app.get('/session/:qrId', (req, res) => {
  const { qrId } = req.params;
  
  const session = sessionManager.startSessionFromQR(qrId);
  
  if (session) {
    // Set session cookie
    res.cookie('sessionId', session.id, {
      httpOnly: true,
      maxAge: session.durationMinutes * 60 * 1000,
      sameSite: 'lax'
    });
    // Redirect to scanner
    res.redirect('/');
  } else {
    res.redirect('/expired.html');
  }
});

// Get session status (for timer)
app.get('/api/session-status', (req, res) => {
  const sessionId = req.cookies.sessionId;
  const status = sessionManager.getSessionStatus(sessionId);
  res.json(status);
});

// ============================================
// Protected Routes Middleware
// ============================================

// Check session for scanner API routes
const requireSession = (req, res, next) => {
  const sessionId = req.cookies.sessionId;
  
  if (!sessionManager.isValid(sessionId)) {
    return res.status(401).json({ 
      success: false, 
      error: 'Session expired', 
      expired: true 
    });
  }
  
  next();
};

// Serve static files (but index.html requires session check via client-side)
app.use(express.static(join(__dirname, '..', 'public')));

// ============================================
// API Routes (protected by session)
// ============================================

/**
 * POST /api/ocr
 * Use Gemini Vision to extract LPN from image
 */
app.post('/api/ocr', requireSession, async (req, res) => {
  try {
    const { image } = req.body;
    
    if (!image) {
      return res.status(400).json({ success: false, error: 'No image provided' });
    }
    
    console.log('🔍 Sending image to Gemini...');
    
    // 1. Robust Base64 Cleaning
    const base64Data = image.replace(/^data:image\/\w+;base64,/, "");
    
    // 2. Use v1 API with gemini-pro model
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${GEMINI_API_KEY}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            {
              text: `yu are pro t extracting lpn serail codes/numbersanalyze the imageand outpt the it
Example: "LPNAC786258612"
Return ONLY the code. If not found, return "NOT_FOUND".`
            },
            {
              inline_data: {
                mime_type: "image/jpeg",
                data: base64Data
              }
            }
          ]
        }],
        generationConfig: {
          temperature: 0,
          maxOutputTokens: 50
        }
      })
    });
    
    if (!response.ok) {
      const errText = await response.text();
      console.error('Gemini API Error Detail:', errText);
      throw new Error(`Gemini API returned ${response.status}: ${errText}`);
    }
    
    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
    
    console.log('🔍 Gemini raw response:', text);
    
    // Clean up response
    const code = text.replace(/[^A-Z0-9]/gi, '').toUpperCase();
    
    if (code && !code.includes('NOTFOUND') && code.length >= 8) {
      return res.json({ success: true, code: code });
    } else {
      return res.json({ success: false, error: 'No LPN found', raw: text });
    }
    
  } catch (error) {
    console.error('OCR Route Error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/lookup/:number
 * Lookup an LPN number and return the result
 */
app.get('/api/lookup/:number', requireSession, async (req, res) => {
  const { number } = req.params;
  
  try {
    const result = await lookupNumber(number);
    res.json(result);
  } catch (error) {
    console.error('Lookup error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * GET /api/health
 * Health check endpoint
 */
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ============================================
// Fallback - serve index.html for SPA
// ============================================
app.get('*', (req, res) => {
  res.sendFile(join(__dirname, '..', 'public', 'index.html'));
});

// ============================================
// Error handler
// ============================================
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ success: false, error: 'Something went wrong' });
});

// ============================================
// Start server
// ============================================
async function start() {
  console.log('');
  console.log('🔷 LPN Scanner');
  console.log('==============');
  console.log('');
  console.log('📋 Configuration:');
  console.log(`   Port: ${config.server.port}`);
  console.log(`   Target: amzlpn.com`);
  console.log(`   OCR: Gemini Vision AI`);
  console.log('');

  // Pre-authenticate at startup
  console.log('🔐 Pre-authenticating...');
  const authOk = await preAuth();
  if (!authOk) {
    console.error('⚠️  Warning: Pre-auth failed. Will retry on first lookup.');
  }
  console.log('');

  app.listen(config.server.port, () => {
    console.log(`🚀 Server running on http://localhost:${config.server.port}`);
    console.log('');
    console.log('📱 Open in browser to start scanning');
    console.log('');
  });
}

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n👋 Shutting down...');
  await cleanupLookup();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n👋 Shutting down...');
  await cleanupLookup();
  process.exit(0);
});

start().catch(err => {
  console.error('❌ Failed to start:', err);
  process.exit(1);
});
