import { createProxyMiddleware } from 'http-proxy-middleware';
import { createGunzip, createInflate, gunzipSync, inflateSync } from 'zlib';
import config from '../config.js';
import targetAuth from '../auth/targetAuth.js';

const REWRITABLE_CONTENT_TYPES = [
  'text/html',
  'text/css',
  'application/javascript',
  'text/javascript'
];

function shouldRewrite(contentType) {
  if (!contentType) return false;
  return REWRITABLE_CONTENT_TYPES.some(t => contentType.includes(t));
}

function isHtml(contentType) {
  return contentType && contentType.includes('text/html');
}

/**
 * Decompress body based on content-encoding
 */
function decompressBody(body, encoding) {
  if (!encoding) return body;
  
  const enc = encoding.toLowerCase();
  try {
    if (enc === 'gzip' || enc === 'x-gzip') {
      return gunzipSync(body);
    }
    if (enc === 'deflate') {
      return inflateSync(body);
    }
    if (enc === 'br') {
      // Brotli - need to import dynamically or use a package
      // For now, return as-is and let browser handle it
      return body;
    }
  } catch (e) {
    console.error('Decompression error:', e.message);
  }
  return body;
}

function createRewriters(proxyBasePath) {
  const appUrl = new URL(config.target.appUrl);
  const origin = appUrl.origin;
  const host = appUrl.host;

  return [
    // absolute origin -> proxy
    { re: new RegExp(origin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), rep: proxyBasePath },
    // protocol-relative //host -> proxy
    { re: new RegExp(`//${host.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'g'), rep: '' },
    // href/src absolute paths "/x" -> "/proxy/x"
    { re: /((?:href|src)=["'])\//gi, rep: `$1${proxyBasePath}/` }
  ];
}

/**
 * Create script to inject auth tokens into localStorage
 */
function createAuthInjectionScript() {
  const authToken = targetAuth.authToken;
  const authInfo = targetAuth.authInfo;
  
  if (!authToken) {
    return '';
  }

  // Escape the tokens for safe injection into JavaScript
  const escapedToken = JSON.stringify(authToken);
  const escapedInfo = authInfo ? JSON.stringify(authInfo) : 'null';

  return `
<script>
(function() {
  // Inject auth tokens into localStorage for the SPA
  try {
    localStorage.setItem('AUTH_TOKEN', ${escapedToken});
    localStorage.setItem('AUTH_INFO', ${escapedInfo});
    console.log('[Gateway] Auth tokens injected');
  } catch (e) {
    console.error('[Gateway] Failed to inject auth:', e);
  }
})();
</script>
`;
}

export function createProxyHandler(proxyBasePath = '/proxy') {
  const rewriters = createRewriters(proxyBasePath);

  return createProxyMiddleware({
    target: config.target.appUrl,
    changeOrigin: true,
    ws: true,
    selfHandleResponse: true,
    logLevel: 'warn',
    // Request to NOT receive compressed response (easier to manipulate)
    onProxyReq: async (proxyReq, req, res) => {
      // Ensure we have auth available
      if (!targetAuth.isAuthenticated()) {
        await targetAuth.login();
      }

      // Inject Authorization header (JWT token)
      const authHeaders = targetAuth.getAuthHeaders();
      Object.entries(authHeaders).forEach(([key, value]) => {
        proxyReq.setHeader(key, value);
      });

      // Request uncompressed response for easier manipulation
      proxyReq.setHeader('Accept-Encoding', 'identity');

      // Forward original headers as much as possible
      if (req.headers['user-agent']) proxyReq.setHeader('User-Agent', req.headers['user-agent']);
      if (req.headers['accept']) proxyReq.setHeader('Accept', req.headers['accept']);
      if (req.headers['accept-language']) proxyReq.setHeader('Accept-Language', req.headers['accept-language']);
    },
    onProxyRes: async (proxyRes, req, res) => {
      // Never leak Set-Cookie from the upstream
      delete proxyRes.headers['set-cookie'];

      // Retry once on auth failure
      if (proxyRes.statusCode === 401 || proxyRes.statusCode === 403) {
        await targetAuth.refreshIfNeeded();
      }

      const chunks = [];
      proxyRes.on('data', chunk => chunks.push(chunk));
      proxyRes.on('end', () => {
        let body = Buffer.concat(chunks);
        const ct = proxyRes.headers['content-type'] || '';
        const encoding = proxyRes.headers['content-encoding'];

        // Decompress if needed
        if (encoding) {
          body = decompressBody(body, encoding);
        }

        // Copy headers (minus problematic ones)
        Object.entries(proxyRes.headers).forEach(([k, v]) => {
          const key = k.toLowerCase();
          if (key === 'set-cookie') return;
          if (key === 'content-length') return; // We'll recalculate
          if (key === 'content-encoding') return; // We decompressed
          if (key === 'transfer-encoding') return; // Let Express handle
          if (typeof v !== 'undefined') res.setHeader(k, v);
        });

        // For HTML responses, inject auth tokens into localStorage
        if (isHtml(ct)) {
          let text = body.toString('utf8');
          
          // Apply URL rewriting
          for (const r of rewriters) {
            text = text.replace(r.re, r.rep);
          }
          
          // Inject auth script right after <head> tag
          const authScript = createAuthInjectionScript();
          if (authScript) {
            text = text.replace(/<head([^>]*)>/i, `<head$1>${authScript}`);
          }
          
          res.setHeader('content-length', Buffer.byteLength(text, 'utf8'));
          res.status(proxyRes.statusCode || 200).send(text);
          return;
        }

        // For other rewritable content (CSS, JS), apply URL rewriting
        if (shouldRewrite(ct)) {
          let text = body.toString('utf8');
          for (const r of rewriters) {
            text = text.replace(r.re, r.rep);
          }
          res.setHeader('content-length', Buffer.byteLength(text, 'utf8'));
          res.status(proxyRes.statusCode || 200).send(text);
          return;
        }

        // For all other content, pass through as-is
        res.setHeader('content-length', body.length);
        res.status(proxyRes.statusCode || 200).send(body);
      });
    },
    pathRewrite: (path, req) => {
      // strip /proxy prefix
      if (path.startsWith(proxyBasePath)) return path.slice(proxyBasePath.length) || '/';
      return path;
    }
  });
}
