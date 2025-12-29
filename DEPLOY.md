# Deployment Guide - Render

## Quick Deploy Steps

### 1. Push to GitHub
```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin YOUR_GITHUB_REPO_URL
git push -u origin main
```

### 2. Deploy to Render

1. Go to https://render.com and sign up/login
2. Click **New** → **Web Service**
3. Connect your GitHub repository
4. Configure Build & Deploy settings:
   - **Build Command:** `npm install && PUPPETEER_CACHE_DIR=/opt/render/project/.render/.cache/puppeteer npx puppeteer browsers install chrome`
   - **Start Command:** `npm start`

### 3. Set Environment Variables

In the Render dashboard, add these environment variables:

```
TARGET_URL=https://www.app.rapidscanapp.com
TARGET_AUTH_URL=https://www.accounts.rapidscanapp.com
TARGET_USERNAME=fl9568@gmail.com
TARGET_PASSWORD=Bin@FL25!
ADMIN_PASSWORD=your_secure_password_here
GEMINI_API_KEY=AIzaSyDwQ0jktYVi4rYFCDSaj4GrGkdsOlUWBu0
PUBLIC_BASE_URL=https://YOUR-APP-NAME.onrender.com
SESSION_TIMEOUT_MINUTES=10
PUPPETEER_CACHE_DIR=/opt/render/project/.render/.cache/puppeteer
```

**Important:** After first deploy, update `PUBLIC_BASE_URL` with your actual Render URL.

### 4. Post-Deployment

1. Get your Render URL (e.g., `https://lpn-scanner.onrender.com`)
2. Update `PUBLIC_BASE_URL` environment variable to that URL
3. Click "Manual Deploy" to restart with new settings

### 5. Test Your App

1. Navigate to `https://YOUR-APP.onrender.com/admin`
2. Login with your `ADMIN_PASSWORD`
3. Generate a QR code
4. Test scanning from your phone

## Render Plans

- **Free Tier**: App spins down after 15 minutes of inactivity, takes ~30 seconds to wake up
- **Starter ($7/month)**: Always-on, 512MB RAM
- **Standard ($25/month)**: 2GB RAM, better for Puppeteer

## Troubleshooting

### Puppeteer Issues
If Chrome crashes on Render:
- Upgrade to Standard plan (more RAM)
- Or reduce `POOL_SIZE` in `src/api/lookup.js` (line 15) from 3 to 1

### Slow First Load
- Free tier spins down; first request takes 30+ seconds
- Upgrade to paid plan for always-on

### Environment Variables Not Working
- Double-check spelling in Render dashboard
- Make sure `PUBLIC_BASE_URL` uses your actual Render URL

## Support

- Render Docs: https://render.com/docs
- Puppeteer on Render: https://render.com/docs/web-services#using-puppeteer

