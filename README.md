# Startup Investment & Portfolio Tracker

An AI-powered platform for tracking startup investments, analyzing pitch decks, and monitoring communications to dynamically score investibility.

## Features

- **Pitch Deck Analysis**: Upload PDFs and get AI-powered extraction and scoring
- **Dynamic Investibility Scoring**: Score updates based on all communications and signals
- **Email Integration**: Connect Gmail (via IMAP) to automatically track startup communications
- **Analysis Timeline**: Track evolving understanding of startups over time
- **Multi-user Support**: Role-based access control (Admin, Partner, Analyst, Viewer)
- **Communication Analytics**: Track response times, consistency, and red flags

## Tech Stack

- **Frontend**: React 19, TypeScript, Vite, TailwindCSS, React Query
- **Backend**: Firebase Cloud Functions, Express, TypeScript
- **Database**: Firestore (NoSQL)
- **AI**: Google Gemini API
- **Authentication**: Firebase Auth
- **Hosting**: Firebase Hosting

## Project Structure

```
startup-tracker/
├── apps/
│   └── web/          # React frontend
├── functions/        # Firebase Cloud Functions (Express API)
├── packages/
│   ├── shared/       # Shared types & utilities
│   └── ai-prompts/   # AI prompt templates
└── turbo.json
```

## Prerequisites

- Node.js 20+
- npm 10+
- Firebase CLI (`npm install -g firebase-tools`)
- Google Gemini API key

## Getting Started

### 1. Clone and Install

```bash
cd startup-tracker
npm install
cd functions && npm install
```

### 2. Configure Firebase

```bash
# Login to Firebase
firebase login

# Initialize project (if not already done)
firebase init
```

### 3. Configure Environment

Create `functions/.env` with:

```bash
GEMINI_API_KEY="your-gemini-api-key"
```

### 4. Start Development

```bash
# Start Firebase emulators
cd functions && npm run serve

# In another terminal, start frontend
npm run dev --workspace=@startup-tracker/web
```

- Frontend: http://localhost:5173
- Backend: http://localhost:5001

## Environment Variables

| Variable | Description |
|----------|-------------|
| `GEMINI_API_KEY` | Google Gemini API key (for AI analysis) |

## API Endpoints

### Authentication
- `POST /api/auth/register` - Register new user/org
- `POST /api/auth/login` - Login
- `GET /api/auth/me` - Get current user

### Startups
- `GET /api/startups` - List startups
- `POST /api/startups` - Create startup
- `GET /api/startups/:id` - Get startup details
- `PATCH /api/startups/:id` - Update startup
- `GET /api/startups/:id/analysis-timeline` - Get analysis timeline
- `POST /api/startups/:id/regenerate-reply` - Regenerate AI draft reply

### Pitch Decks
- `POST /api/decks/startup/:startupId` - Upload deck
- `GET /api/decks/:id` - Get deck details
- `POST /api/decks/:id/analyze` - Analyze deck with AI

### Emails
- `GET /api/emails/startup/:startupId` - Get emails for startup
- `POST /api/emails/:id/match` - Match email to startup

### Inbox (Proposal Queue)
- `GET /api/inbox` - Get proposal queue
- `POST /api/inbox/:id/approve` - Approve proposal and create startup
- `POST /api/inbox/:id/reject` - Reject proposal

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
```

## Deployment

### Deploy to Firebase

```bash
# Deploy everything
firebase deploy --project startup-tracker-app

# Deploy only functions
firebase deploy --only functions --project startup-tracker-app

# Deploy only hosting
npm run build --workspace=@startup-tracker/web
firebase deploy --only hosting --project startup-tracker-app
```

### Live URLs

- **Frontend**: https://startup-tracker-app.web.app
- **Backend**: https://us-central1-startup-tracker-app.cloudfunctions.net/api

## License

MIT
