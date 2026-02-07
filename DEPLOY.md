# Startup Tracker - Production Deployment Guide

## Deployment Complete!

| Service | Platform | URL | Status |
|---------|----------|-----|--------|
| Frontend | Firebase Hosting | https://startup-tracker-app.web.app | Live |
| Backend | Cloud Functions | https://us-central1-startup-tracker-app.cloudfunctions.net/api | Live |
| Database | Firestore | N/A | Running |

## Access the Application

**Live App**: https://startup-tracker-app.web.app

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
| `/api/startups/:id/analysis-timeline` | GET | Get analysis timeline |
| `/api/startups/:id/regenerate-reply` | POST | Regenerate AI draft reply |
| `/api/inbox` | GET | Get proposal queue |
| `/api/inbox/:id/approve` | POST | Approve proposal |

### Test the API

```bash
# Health check
curl https://us-central1-startup-tracker-app.cloudfunctions.net/api/health

# Register
curl -X POST https://us-central1-startup-tracker-app.cloudfunctions.net/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"you@example.com","password":"secret","name":"Your Name","organizationName":"Your Org"}'
```

## Redeploy Commands

```bash
cd /path/to/startup-tracker

# Redeploy backend (Cloud Functions)
firebase deploy --only functions --project startup-tracker-app

# Redeploy frontend (Hosting)
npm run build --workspace=@startup-tracker/web
firebase deploy --only hosting --project startup-tracker-app

# Deploy everything
firebase deploy --project startup-tracker-app
```

## Environment Variables

Set in Firebase Functions config or `functions/.env`:

| Variable | Description |
|----------|-------------|
| `GEMINI_API_KEY` | Google Gemini API key for AI analysis |

## Firestore Collections

| Collection | Description |
|------------|-------------|
| `users` | User accounts |
| `organizations` | Organization data |
| `startups` | Startup records |
| `emails` | Email communications |
| `decks` | Pitch deck metadata and analysis |
| `proposalQueue` | Incoming proposals awaiting review |
| `analysisEvents` | Timeline of AI analysis events |

## Troubleshooting

**CORS errors**: Check that the frontend origin is allowed in the Cloud Functions CORS config

**Auth errors**: Verify Firebase Auth is properly configured

**Firestore errors**: Check Firestore rules allow the operation

## Local Development

```bash
# Start Firebase emulators
cd functions && npm run serve

# Start frontend dev server
npm run dev --workspace=@startup-tracker/web
```
