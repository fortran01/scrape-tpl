#!/bin/bash

# TPL Scraper Google Cloud Setup Script
set -e

echo "🚀 Setting up TPL Scraper on Google Cloud with Pulumi"
echo "=================================================="

# Check if required tools are installed
command -v pulumi >/dev/null 2>&1 || { echo "❌ Pulumi is required but not installed. Please install it first: https://www.pulumi.com/docs/get-started/install/"; exit 1; }
command -v gcloud >/dev/null 2>&1 || { echo "❌ Google Cloud CLI is required but not installed. Please install it first: https://cloud.google.com/sdk/docs/install"; exit 1; }
command -v docker >/dev/null 2>&1 || { echo "❌ Docker is required but not installed. Please install it first: https://docs.docker.com/get-docker/"; exit 1; }

# Check if user is logged into gcloud
if ! gcloud auth list --filter=status:ACTIVE --format="value(account)" | grep -q .; then
    echo "❌ You are not logged into Google Cloud. Please run: gcloud auth login"
    exit 1
fi

# Check if Application Default Credentials are set up
echo "🔐 Checking Application Default Credentials..."
if ! gcloud auth application-default print-access-token >/dev/null 2>&1; then
    echo "⚙️  Setting up Application Default Credentials..."
    echo "   This is required for Pulumi to authenticate with Google Cloud"
    echo "   Requesting only necessary scopes (no SQL permissions needed)"
    gcloud auth application-default login --scopes="https://www.googleapis.com/auth/cloud-platform,https://www.googleapis.com/auth/userinfo.email"
else
    echo "✅ Application Default Credentials already configured"
fi

# Get project ID
PROJECT_ID=$(gcloud config get-value project 2>/dev/null)
if [ -z "$PROJECT_ID" ]; then
    echo "❌ No Google Cloud project is set. Please run: gcloud config set project YOUR_PROJECT_ID"
    exit 1
fi

echo "✅ Using Google Cloud project: $PROJECT_ID"

# Install dependencies
echo "📦 Installing Pulumi dependencies..."
npm install

# Setup GCS backend
echo "🗄️  Setting up Google Cloud Storage backend..."
echo "📤 Configuring Pulumi to use GCS backend..."
./backend-setup.sh

# Initialize Pulumi stack if it doesn't exist
if ! pulumi stack ls | grep -q "dev"; then
    echo "🔧 Creating Pulumi stack..."
    pulumi stack init dev
fi

# Set configuration
echo "⚙️  Setting up configuration..."
pulumi config set gcp:project $PROJECT_ID
pulumi config set gcp:region northamerica-northeast2

# Check if secrets are already uploaded to Secret Manager
echo ""
echo "🔐 Checking for secrets in Google Cloud Secret Manager..."

# Check if .env file exists
if [ ! -f "../.env" ]; then
    echo "❌ .env file not found in project root"
    echo "   Please create a .env file with your credentials first"
    echo "   You can copy from .env.example and fill in your values"
    exit 1
fi

# Check if secrets exist in Secret Manager
SECRETS_EXIST=true
for secret in "tpl-scraper-email-user" "tpl-scraper-email-pass" "tpl-scraper-email-to" "tpl-scraper-database-url"; do
    if ! gcloud secrets describe "$secret" --project="$PROJECT_ID" >/dev/null 2>&1; then
        SECRETS_EXIST=false
        break
    fi
done

if [ "$SECRETS_EXIST" = false ]; then
    echo "📤 Uploading secrets from .env file to Secret Manager..."
    cd ..
    ./scripts/upload-secrets.sh
    cd pulumi
else
    echo "✅ Secrets already exist in Secret Manager"
fi

echo ""
echo "✅ Configuration complete!"
echo ""
echo "🚀 Ready to deploy! Run the following commands:"
echo "   cd pulumi"
echo "   pulumi up"
echo ""
echo "📋 After deployment, you can:"
echo "   - View logs: gcloud logging read 'resource.type=cloud_run_job'"
echo "   - Trigger manually: gcloud scheduler jobs run tpl-scraper-daily --location=us-central1"
echo "   - Monitor scheduled runs in Cloud Console"
echo "   - View secrets: https://console.cloud.google.com/security/secret-manager?project=$PROJECT_ID" 