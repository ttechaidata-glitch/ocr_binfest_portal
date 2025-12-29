import sessionManager from '../sessions/sessionManager.js';

const SESSION_EXPIRED_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Session Expired</title>
  <style>
    body{font-family:system-ui,-apple-system,Segoe UI,sans-serif;background:#0f172a;color:#e2e8f0;margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center}
    .card{max-width:560px;padding:28px;border-radius:16px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12)}
    h1{margin:0 0 8px;font-size:28px}
    p{margin:0 0 16px;color:#cbd5e1;line-height:1.4}
    a{color:#93c5fd;text-decoration:none}
    a:hover{text-decoration:underline}
  </style>
</head>
<body>
  <div class="card">
    <h1>Session expired</h1>
    <p>Your session has expired. Please scan the QR code again to start a new session.</p>
    <p><a href="/demo">Go back to the QR page</a></p>
  </div>
</body>
</html>`;

export function sessionCheck(req, res, next) {
  const sid = req.cookies?.gateway_session;
  if (!sid || !sessionManager.isValid(sid)) {
    return res.status(440).send(SESSION_EXPIRED_HTML);
  }
  return next();
}

export function sessionCheckWithExclusions(excludedPaths = []) {
  return (req, res, next) => {
    const path = req.path || '';
    if (excludedPaths.some(p => path === p || path.startsWith(p + '/'))) return next();
    return sessionCheck(req, res, next);
  };
}


