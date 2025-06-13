#!/bin/bash

# Upload TPL Scraper secrets to Google Cloud Secret Manager
set -e

echo "🔐 Uploading TPL Scraper secrets to Google Cloud Secret Manager"
echo "=============================================================="

# Check if .env file exists
if [ ! -f ".env" ]; then
    echo "❌ .env file not found in the current directory"
    echo "   Please create a .env file with your credentials first"
    exit 1
fi

# Check if gcloud is installed and authenticated
command -v gcloud >/dev/null 2>&1 || { echo "❌ Google Cloud CLI is required but not installed. Please install it first: https://cloud.google.com/sdk/docs/install"; exit 1; }

# Check if user is logged into gcloud
if ! gcloud auth list --filter=status:ACTIVE --format="value(account)" | grep -q .; then
    echo "❌ You are not logged into Google Cloud. Please run: gcloud auth login"
    exit 1
fi

# Get project ID
PROJECT_ID=$(gcloud config get-value project 2>/dev/null)
if [ -z "$PROJECT_ID" ]; then
    echo "❌ No Google Cloud project is set. Please run: gcloud config set project YOUR_PROJECT_ID"
    exit 1
fi

echo "✅ Using Google Cloud project: $PROJECT_ID"

# Source the .env file to load variables
set -a  # automatically export all variables
source .env
set +a  # stop automatically exporting

# Check required variables
if [ -z "$EMAIL_USER" ] || [ -z "$EMAIL_PASS" ] || [ -z "$EMAIL_TO" ] || [ -z "$DATABASE_URL" ]; then
    echo "❌ Missing required environment variables in .env file"
    echo "   Required: EMAIL_USER, EMAIL_PASS, EMAIL_TO, DATABASE_URL"
    exit 1
fi

echo "📋 Found required environment variables"

# Function to create or overwrite secret
create_or_update_secret() {
    local secret_name=$1
    local secret_value=$2
    
    echo "🔑 Processing secret: $secret_name"
    
    # Check if secret exists
    if gcloud secrets describe "$secret_name" --project="$PROJECT_ID" >/dev/null 2>&1; then
        echo "   🗑️  Deleting existing secret: $secret_name"
        gcloud secrets delete "$secret_name" --project="$PROJECT_ID" --quiet
        echo "   ✨ Creating new secret: $secret_name"
        echo -n "$secret_value" | gcloud secrets create "$secret_name" --data-file=- --project="$PROJECT_ID"
    else
        echo "   ✨ Creating new secret: $secret_name"
        echo -n "$secret_value" | gcloud secrets create "$secret_name" --data-file=- --project="$PROJECT_ID"
    fi
}

# Enable Secret Manager API if not already enabled
echo "🔧 Ensuring Secret Manager API is enabled..."
gcloud services enable secretmanager.googleapis.com --project="$PROJECT_ID"

# Upload secrets
create_or_update_secret "tpl-scraper-email-user" "$EMAIL_USER"
create_or_update_secret "tpl-scraper-email-pass" "$EMAIL_PASS"
create_or_update_secret "tpl-scraper-email-to" "$EMAIL_TO"
create_or_update_secret "tpl-scraper-database-url" "$DATABASE_URL"

echo ""
echo "✅ All secrets uploaded successfully!"
echo ""
echo "📋 Created/Updated secrets:"
echo "   - tpl-scraper-email-user"
echo "   - tpl-scraper-email-pass"
echo "   - tpl-scraper-email-to"
echo "   - tpl-scraper-database-url"
echo ""
echo "🚀 You can now deploy your Pulumi infrastructure:"
echo "   cd pulumi"
echo "   pulumi up"
echo ""
echo "🔍 To view secrets in Google Cloud Console:"
echo "   https://console.cloud.google.com/security/secret-manager?project=$PROJECT_ID" 