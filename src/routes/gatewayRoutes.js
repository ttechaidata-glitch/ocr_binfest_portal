import { Router } from 'express';
import QRCode from 'qrcode';
import sessionManager from '../sessions/sessionManager.js';
import config from '../config.js';

const router = Router();

router.get('/start', (req, res) => {
  const session = sessionManager.createSession();
  const maxAge = config.session.timeoutMinutes * 60 * 1000;

  res.cookie('gateway_session', session.id, {
    httpOnly: true,
    maxAge,
    sameSite: 'lax',
    path: '/'
  });

  console.log(`🚀 New session started: ${session.id.slice(0, 8)}...`);
  res.redirect('/proxy/');
});

router.get('/qr', async (req, res) => {
  try {
    const baseUrl =
      config.server.publicBaseUrl ||
      `${req.protocol}://${req.get('host')}`;

    const startUrl = `${baseUrl}/start`;
    const png = await QRCode.toBuffer(startUrl, { type: 'png', width: 340, margin: 2 });

    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'no-store');
    res.send(png);
  } catch (e) {
    console.error('❌ Failed to generate QR:', e?.message || e);
    res.status(500).send('Failed to generate QR code');
  }
});

router.get('/demo', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Gateway QR</title>
  <style>
    body{font-family:system-ui,-apple-system,Segoe UI,sans-serif;background:#0b1220;color:#e2e8f0;margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center}
    .card{max-width:760px;padding:28px;border-radius:18px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);text-align:center}
    h1{margin:0 0 10px}
    p{margin:0 0 18px;color:#cbd5e1}
    img{width:340px;height:340px;border-radius:12px;background:white;padding:10px}
    .row{display:flex;gap:18px;justify-content:center;flex-wrap:wrap}
    a{color:#93c5fd;text-decoration:none}
    a:hover{text-decoration:underline}
    code{background:rgba(255,255,255,.08);padding:2px 6px;border-radius:8px}
  </style>
</head>
<body>
  <div class="card">
    <h1>Scan to start a session</h1>
    <p>Session expires after <code>${config.session.timeoutMinutes}</code> minutes.</p>
    <div class="row">
      <div>
        <img src="/qr" alt="QR code" />
        <p style="margin-top:12px"><a href="/start">Or click here on this device</a></p>
      </div>
    </div>
  </div>
</body>
</html>`);
});

router.get('/status', (req, res) => {
  res.json({ ok: true, uptime: process.uptime() });
});

export default router;


