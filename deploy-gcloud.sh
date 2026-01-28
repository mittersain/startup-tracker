#!/bin/bash
# Startup Tracker - Google Cloud Deployment Script
# This script deploys the backend to Cloud Run and sets up Cloud SQL

set -e

PROJECT_ID="startup-tracker-app"
REGION="us-central1"
SERVICE_NAME="startup-tracker-api"

echo "🚀 Startup Tracker - Google Cloud Deployment"
echo "============================================"

# Check if gcloud is authenticated
if ! gcloud auth print-access-token &>/dev/null; then
    echo "⚠️  You need to authenticate with Google Cloud first."
    echo "Run: gcloud auth login"
    exit 1
fi

# Set project
echo "📦 Setting project to $PROJECT_ID..."
gcloud config set project $PROJECT_ID

# Enable required APIs
echo "🔧 Enabling required APIs..."
gcloud services enable \
    cloudbuild.googleapis.com \
    run.googleapis.com \
    sqladmin.googleapis.com \
    secretmanager.googleapis.com

# Create Cloud SQL instance (PostgreSQL)
echo "🗄️  Creating Cloud SQL PostgreSQL instance..."
if ! gcloud sql instances describe startup-tracker-db &>/dev/null; then
    gcloud sql instances create startup-tracker-db \
        --database-version=POSTGRES_15 \
        --tier=db-f1-micro \
        --region=$REGION \
        --root-password="$(openssl rand -base64 24)"

    # Create database
    gcloud sql databases create startup_tracker --instance=startup-tracker-db

    # Create user
    DB_PASSWORD=$(openssl rand -base64 24)
    gcloud sql users create app --instance=startup-tracker-db --password="$DB_PASSWORD"

    echo "📝 Database password: $DB_PASSWORD"
    echo "   Save this password! It won't be shown again."
fi

# Get Cloud SQL connection name
SQL_CONNECTION=$(gcloud sql instances describe startup-tracker-db --format='value(connectionName)')

# Store secrets
echo "🔐 Storing secrets..."
echo -n "$DB_PASSWORD" | gcloud secrets create db-password --data-file=- 2>/dev/null || true
echo -n "$(openssl rand -base64 32)" | gcloud secrets create jwt-secret --data-file=- 2>/dev/null || true

# Build and deploy to Cloud Run
echo "🏗️  Building and deploying to Cloud Run..."
cd apps/api

gcloud run deploy $SERVICE_NAME \
    --source . \
    --region=$REGION \
    --platform=managed \
    --allow-unauthenticated \
    --add-cloudsql-instances=$SQL_CONNECTION \
    --set-env-vars="NODE_ENV=production" \
    --set-env-vars="DATABASE_URL=postgresql://app:$DB_PASSWORD@localhost/startup_tracker?host=/cloudsql/$SQL_CONNECTION" \
    --set-secrets="JWT_SECRET=jwt-secret:latest" \
    --set-env-vars="GEMINI_API_KEY=AIzaSyDKa5BFPHy90jOtOsWv2pmD7UDo2sy-HY8" \
    --set-env-vars="CORS_ORIGIN=https://startup-tracker-app.web.app"

# Get service URL
SERVICE_URL=$(gcloud run services describe $SERVICE_NAME --region=$REGION --format='value(status.url)')

echo ""
echo "✅ Deployment Complete!"
echo "========================"
echo "Frontend: https://startup-tracker-app.web.app"
echo "Backend:  $SERVICE_URL"
echo ""
echo "⚠️  Remember to update the frontend VITE_API_URL:"
echo "   VITE_API_URL=$SERVICE_URL/api"
