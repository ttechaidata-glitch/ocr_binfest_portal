import config from '../config.js';

const BLOCKED_PATH_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Access denied</title>
  <style>
    body{font-family:system-ui,-apple-system,Segoe UI,sans-serif;background:#111827;color:#e5e7eb;margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center}
    .card{max-width:640px;padding:28px;border-radius:16px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12)}
    h1{margin:0 0 8px;font-size:28px}
    p{margin:0 0 10px;color:#cbd5e1;line-height:1.4}
    code{background:rgba(255,255,255,.08);padding:2px 6px;border-radius:8px}
  </style>
</head>
<body>
  <div class="card">
    <h1>Access denied</h1>
    <p>This path is blocked by the gateway policy.</p>
    <p>Requested: <code id="p"></code></p>
    <script>
      document.getElementById('p').textContent = location.pathname;
    </script>
  </div>
</body>
</html>`;

export function pathFilter(req, res, next) {
  const p = req.path || '';
  const blocked = config.security.blockedPaths || [];
  if (blocked.some(bp => p === bp || p.startsWith(bp + '/'))) {
    return res.status(403).send(BLOCKED_PATH_HTML);
  }
  return next();
}


