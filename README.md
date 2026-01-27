# Startup Investment & Portfolio Tracker

An AI-powered platform for tracking startup investments, analyzing pitch decks, and monitoring communications to dynamically score investibility.

## Features

- **Pitch Deck Analysis**: Upload PDFs and get AI-powered extraction and scoring
- **Dynamic Investibility Scoring**: Score updates based on all communications and signals
- **Email Integration**: Connect Gmail (via IMAP) to automatically track startup communications
- **Multi-user Support**: Role-based access control (Admin, Partner, Analyst, Viewer)
- **Communication Analytics**: Track response times, consistency, and red flags

## Tech Stack

- **Frontend**: React 19, TypeScript, Vite, TailwindCSS, React Query
- **Backend**: Node.js, Express, TypeScript, Prisma ORM
- **Database**: PostgreSQL
- **AI**: Google Gemini API
- **Storage**: S3-compatible (MinIO for local dev)

## Project Structure

```
startup-tracker/
├── apps/
│   ├── api/          # Express backend
│   └── web/          # React frontend
├── packages/
│   ├── shared/       # Shared types & utilities
│   └── ai-prompts/   # AI prompt templates
├── docker-compose.yml
└── turbo.json
```

## Prerequisites

- Node.js 20+
- npm 10+
- Docker & Docker Compose (for local database)
- Google Gemini API key

## Getting Started

### 1. Clone and Install

```bash
cd startup-tracker
npm install
```

### 2. Start Infrastructure

```bash
docker compose up -d
```

This starts:
- PostgreSQL on port 5432
- MinIO (S3) on ports 9000/9001

### 3. Configure Environment

```bash
# Copy example env file
cp apps/api/.env.example apps/api/.env

# Edit with your values
# Required: GEMINI_API_KEY, JWT_SECRET
```

### 4. Set Up Database

```bash
# Generate Prisma client
npm run db:generate

# Run migrations
npm run db:migrate
```

### 5. Start Development

```bash
npm run dev
```

- Frontend: http://localhost:5173
- Backend: http://localhost:3001

## Environment Variables

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_SECRET` | Secret for JWT signing |
| `ANTHROPIC_API_KEY` | Claude API key |
| `GEMINI_API_KEY` | Google Gemini API key (for AI analysis) |

## API Endpoints

### Authentication
- `POST /api/auth/register` - Register new user/org
- `POST /api/auth/login` - Login
- `POST /api/auth/refresh` - Refresh tokens
- `GET /api/auth/me` - Get current user

### Startups
- `GET /api/startups` - List startups
- `POST /api/startups` - Create startup
- `GET /api/startups/:id` - Get startup details
- `PATCH /api/startups/:id` - Update startup
- `GET /api/startups/:id/score-events` - Get score events
- `POST /api/startups/:id/score-events` - Add manual score event

### Pitch Decks
- `POST /api/decks/startup/:startupId` - Upload deck
- `GET /api/decks/:id` - Get deck details
- `POST /api/decks/:id/reprocess` - Reprocess with AI

### Emails
- `GET /api/emails/startup/:startupId` - Get emails for startup
- `POST /api/emails/:id/match` - Match email to startup
- `GET /api/emails/contacts/:startupId` - Get contacts

## Scoring System

The investibility score (0-100) is calculated from:

| Category | Weight | Description |
|----------|--------|-------------|
| Team | 25 | Founder experience, technical capability |
| Market | 25 | TAM/SAM/SOM, timing, growth |
| Product | 20 | Problem clarity, differentiation, moat |
| Traction | 20 | Revenue, growth, customers |
| Deal | 10 | Valuation, terms, use of funds |

Additional modifiers from communications:
- **Communication quality**: Response time, transparency
- **Momentum signals**: Growth updates, investor interest
- **Red flags**: Inconsistencies, evasiveness

## User Roles

| Role | Permissions |
|------|-------------|
| Admin | Full access, user management |
| Partner | View all deals, add/edit |
| Analyst | Assigned deals only |
| Viewer | Read-only assigned deals |

## Development

```bash
# Type checking
npm run type-check

# Linting
npm run lint

# Build
npm run build

# Database studio
npm run db:studio
```

## Production Deployment (Supabase)

### 1. Create a Supabase Project

1. Go to [supabase.com](https://supabase.com) and create a new project
2. Note your project reference ID and database password

### 2. Get Connection String

1. Go to **Project Settings > Database**
2. Copy the **Connection string (URI)**
3. Choose **Transaction pooler** for serverless deployments (port 6543)
4. Add `?pgbouncer=true` to the connection string

Example:
```
postgresql://postgres.[project-ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres?pgbouncer=true
```

### 3. Configure Production Environment

Create `apps/api/.env` with production values:

```bash
DATABASE_URL="postgresql://postgres.[ref]:[pass]@aws-0-[region].pooler.supabase.com:6543/postgres?pgbouncer=true"
JWT_SECRET="generate-a-secure-random-string-min-32-chars"
GEMINI_API_KEY="your-gemini-api-key"
NODE_ENV=production
CORS_ORIGIN="https://your-frontend-domain.com"
BACKUP_ENABLED=false  # Supabase handles backups
```

### 4. Run Migrations

```bash
cd apps/api
npx prisma migrate deploy
```

### 5. Deploy

**Backend (Railway/Render/Fly.io):**
- Set environment variables
- Deploy `apps/api` directory
- Run `npm run build && npm start`

**Frontend (Vercel/Netlify):**
- Deploy `apps/web` directory
- Set `VITE_API_URL` to your backend URL

---

## Vercel Deployment (Recommended)

### Architecture Overview

For production, deploy as two separate services:
- **Frontend**: Vercel (static hosting with edge CDN)
- **Backend**: Railway, Render, or Fly.io (Node.js runtime)

### Step 1: Deploy Backend (Railway)

Railway is recommended for the Express backend:

1. **Create Railway account** at [railway.app](https://railway.app)

2. **Create new project** and select "Deploy from GitHub repo"

3. **Configure build settings**:
   - Root Directory: `apps/api`
   - Build Command: `npm install && npx prisma generate && npm run build`
   - Start Command: `npm start`

4. **Set environment variables** in Railway dashboard:
   ```
   DATABASE_URL=postgresql://postgres.[ref]:[pass]@aws-0-[region].pooler.supabase.com:6543/postgres?pgbouncer=true
   JWT_SECRET=your-secure-jwt-secret-min-32-chars
   GEMINI_API_KEY=your-gemini-api-key
   NODE_ENV=production
   CORS_ORIGIN=https://your-app.vercel.app
   PORT=3001
   ```

5. **Run migrations** (one-time):
   ```bash
   # In Railway shell or locally with production DATABASE_URL
   npx prisma migrate deploy
   ```

6. **Note your backend URL** (e.g., `https://startup-tracker-api.railway.app`)

### Step 2: Deploy Frontend (Vercel)

1. **Create Vercel account** at [vercel.com](https://vercel.com)

2. **Import your GitHub repository**

3. **Configure project settings**:
   - Framework Preset: Vite
   - Root Directory: `apps/web`
   - Build Command: `cd ../.. && npm install && npm run build --workspace=@startup-tracker/web`
   - Output Directory: `dist`
   - Install Command: `cd ../.. && npm install`

4. **Set environment variables**:
   ```
   VITE_API_URL=https://your-backend.railway.app/api
   ```

5. **Deploy**

### Step 3: Configure CORS

Update your backend's `CORS_ORIGIN` environment variable to match your Vercel domain:
```
CORS_ORIGIN=https://your-app.vercel.app
```

### Alternative: Vercel CLI Deployment

```bash
# Install Vercel CLI
npm i -g vercel

# Deploy frontend
cd apps/web
vercel --prod

# Follow prompts to configure project
```

### Environment Variables Summary

**Backend (Railway/Render)**:
| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | Supabase PostgreSQL connection string |
| `JWT_SECRET` | Secure random string (min 32 chars) |
| `GEMINI_API_KEY` | Google Gemini API key |
| `NODE_ENV` | Set to `production` |
| `CORS_ORIGIN` | Your Vercel frontend URL |
| `PORT` | 3001 (or as assigned by platform) |

**Frontend (Vercel)**:
| Variable | Description |
|----------|-------------|
| `VITE_API_URL` | Full URL to your backend API (e.g., `https://api.example.com/api`) |

### Troubleshooting

**CORS errors**: Ensure `CORS_ORIGIN` in backend matches your Vercel domain exactly

**Database connection issues**: Use the Transaction Pooler connection string (port 6543) for serverless

**Build failures**: Ensure all workspace dependencies are installed before building

### Supabase Features

- **Automatic Backups**: Daily backups included (Pro plan: point-in-time recovery)
- **Connection Pooling**: Built-in PgBouncer for efficient connections
- **Dashboard**: Manage data via Supabase Studio
- **Storage**: Use Supabase Storage for pitch deck files

---

## Local Development

### Database Backup (SQLite - local only)

For local development with SQLite, automatic backups are available:

- **Automatic backups**: Every 6 hours (configurable)
- **Startup backup**: Created when the server starts
- **Manual backups**: Available via Settings > Integrations > Database & Backups

Configure in `.env`:

```bash
BACKUP_ENABLED=true          # Enable/disable automatic backups
BACKUP_INTERVAL_HOURS=6      # Hours between automatic backups
BACKUP_MAX_COUNT=10          # Maximum number of backups to keep
```

### Backup API Endpoints (local SQLite only)

- `GET /api/backup/status` - Get backup status and database stats
- `GET /api/backup/list` - List all available backups
- `POST /api/backup/create` - Create a manual backup
- `GET /api/backup/integrity` - Check database integrity
- `POST /api/backup/restore` - Restore from a backup (requires admin)

## License

MIT
