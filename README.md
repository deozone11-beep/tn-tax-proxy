# TN Property Tax Proxy — Cloud Deploy

## Deploy to Railway (Free)

1. Go to https://railway.app
2. Login with GitHub
3. "New Project" → "Deploy from GitHub repo"
4. Upload this folder OR connect GitHub

## Deploy to Render (Free)

1. Go to https://render.com
2. "New" → "Web Service"
3. Connect GitHub repo
4. Build Command: (empty)
5. Start Command: node server.js

## After Deploy

Your URL will be like:
https://tn-tax.railway.app

Then use:
https://tn-tax.railway.app/view/082%2F001%2F900540

## Quick Deploy via Railway CLI

```bash
npm install -g @railway/cli
railway login
railway init
railway up
```
