# Startup Tracker - Production Deployment Guide

## 🎉 Deployment Complete!

| Service | Platform | URL | Status |
|---------|----------|-----|--------|
| Frontend | Firebase Hosting | https://startup-tracker-app.web.app | ✅ Live |
| Backend | Cloud Functions | https://us-central1-startup-tracker-app.cloudfunctions.net/api | ✅ Live |
| Database | In-Memory (MVP) | N/A | ✅ Running |

## Access the Application

🚀 **Live App**: https://startup-tracker-app.web.app

### API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/health` | GET | Health check |
| `/api/auth/register` | POST | Register new user |
| `/api/auth/login` | POST | Login |
| `/api/auth/me` | GET | Get current user |
| `/api/startups` | GET | List startups |
| `/api/startups` | POST | Create startup |
| `/api/startups/:id` | GET/PATCH | Get/Update startup |

### Test the API

```bash
# Health check
curl https://us-central1-startup-tracker-app.cloudfunctions.net/api/health

# Register
curl -X POST https://us-central1-startup-tracker-app.cloudfunctions.net/api/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"you@example.com","password":"secret","name":"Your Name","organizationName":"Your Org"}'
```

## Redeploy Commands

```bash
cd /Users/apple/Desktop/claude/startup-tracker

# Redeploy backend (Cloud Functions)
firebase deploy --only functions --project startup-tracker-app

# Redeploy frontend (Hosting)
npm run build --workspace=@startup-tracker/web
firebase deploy --only hosting --project startup-tracker-app
```

## Note on Data Persistence

⚠️ **Current MVP uses in-memory storage** - data resets on function cold start.

To add persistent storage, upgrade to:
- **Firestore** (recommended for Firebase)
- **Cloud SQL PostgreSQL** (for full Prisma support)

---

## Alternative: Supabase + Render (If Needed)

## Step 1: Create Supabase Database

1. Go to https://supabase.com and sign in
2. Click "New Project"
3. Fill in:
   - Name: `startup-tracker-db`
   - Database Password: Generate a strong password (save this!)
   - Region: Choose closest to you
4. Wait for project to be created (~2 minutes)
5. Go to **Settings > Database**
6. Under **Connection string**, select **URI** tab
7. Copy the connection string (looks like):
   ```
   postgresql://postgres.[ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres
   ```
8. Add `?pgbouncer=true` to the end for connection pooling

**Your DATABASE_URL**: `postgresql://postgres.[ref]:[YOUR_PASSWORD]@aws-0-[region].pooler.supabase.com:6543/postgres?pgbouncer=true`

## Step 2: Deploy Backend to Render

1. Go to https://render.com and sign in
2. Click "New" > "Web Service"
3. Connect your GitHub repository OR use "Public Git repository":
   - If public: `https://github.com/YOUR_USERNAME/startup-tracker`
4. Configure the service:
   - **Name**: `startup-tracker-api`
   - **Region**: Oregon (US West)
   - **Branch**: main
   - **Root Directory**: `apps/api`
   - **Runtime**: Node
   - **Build Command**: `npm install && npx prisma generate && npm run build`
   - **Start Command**: `npm start`
   - **Plan**: Free (or Starter for better performance)

5. Add Environment Variables (click "Advanced" > "Add Environment Variable"):

   | Key | Value |
   |-----|-------|
   | `NODE_ENV` | `production` |
   | `DATABASE_URL` | `[Your Supabase connection string from Step 1]` |
   | `JWT_SECRET` | `[Generate: openssl rand -base64 32]` |
   | `GEMINI_API_KEY` | `AIzaSyDKa5BFPHy90jOtOsWv2pmD7UDo2sy-HY8` |
   | `CORS_ORIGIN` | `https://startup-tracker-ten.vercel.app` |
   | `PORT` | `10000` |

6. Click "Create Web Service"
7. Wait for deployment (~5-10 minutes)
8. Note your Render URL (e.g., `https://startup-tracker-api.onrender.com`)

## Step 3: Run Database Migrations

After Render deployment completes, run migrations:

### Option A: Via Render Shell
1. Go to your Render service
2. Click "Shell" tab
3. Run: `npx prisma migrate deploy`

### Option B: Locally (if you have direct DB access)
```bash
cd /Users/apple/Desktop/claude/startup-tracker/apps/api
DATABASE_URL="your-supabase-connection-string" npx prisma migrate deploy
```

## Step 4: Update Vercel Frontend

Add the backend URL to Vercel:

```bash
cd /Users/apple/Desktop/claude/startup-tracker
vercel env add VITE_API_URL production
# Enter: https://startup-tracker-api.onrender.com/api
vercel --prod
```

Or via Vercel Dashboard:
1. Go to https://vercel.com/nitish-mittersains-projects/startup-tracker
2. Settings > Environment Variables
3. Add:
   - Name: `VITE_API_URL`
   - Value: `https://startup-tracker-api.onrender.com/api`
   - Environment: Production
4. Redeploy from Deployments tab

## Step 5: Verify Deployment

1. Visit: https://startup-tracker-ten.vercel.app
2. Try registering a new account
3. Login and test functionality

## Quick Commands

```bash
# Check Vercel status
vercel ls

# Redeploy frontend
cd /Users/apple/Desktop/claude/startup-tracker && vercel --prod

# View logs
vercel logs startup-tracker-ten.vercel.app
```

## Environment Variables Summary

### Backend (Render)
- `NODE_ENV=production`
- `DATABASE_URL=[Supabase PostgreSQL URL]`
- `JWT_SECRET=[Random 32+ char string]`
- `GEMINI_API_KEY=AIzaSyDKa5BFPHy90jOtOsWv2pmD7UDo2sy-HY8`
- `CORS_ORIGIN=https://startup-tracker-ten.vercel.app`
- `PORT=10000`

### Frontend (Vercel)
- `VITE_API_URL=https://[your-render-url].onrender.com/api`

## Troubleshooting

**CORS errors**: Ensure CORS_ORIGIN exactly matches your Vercel URL (no trailing slash)

**Database errors**: Verify DATABASE_URL uses port 6543 with `?pgbouncer=true`

**Build failures on Render**: Check that root directory is set to `apps/api`
