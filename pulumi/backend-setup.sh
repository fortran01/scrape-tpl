#!/bin/bash

# Setup Google Cloud Storage backend for Pulumi
set -e

echo "🗄️  Setting up Google Cloud Storage backend for Pulumi"
echo "===================================================="

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

# Set bucket name (must be globally unique)
BUCKET_NAME="pulumi-state-${PROJECT_ID}"
REGION="us-central1"

# Check if the bucket already exists
if gcloud storage buckets describe gs://$BUCKET_NAME >/dev/null 2>&1; then
    echo "✅ Found existing Pulumi state bucket: $BUCKET_NAME"
    EXISTING_BUCKET="$BUCKET_NAME"
else
    echo "📦 Creating new GCS bucket: $BUCKET_NAME"
    EXISTING_BUCKET=""
fi

# Enable Cloud Storage API
echo "🔧 Enabling Cloud Storage API..."
gcloud services enable storage.googleapis.com --project="$PROJECT_ID"

# Create the bucket only if it doesn't exist
if [ -z "$EXISTING_BUCKET" ]; then
    echo "📦 Creating GCS bucket: gs://$BUCKET_NAME"
    gcloud storage buckets create gs://$BUCKET_NAME \
        --project="$PROJECT_ID" \
        --location="$REGION" \
        --uniform-bucket-level-access

    # Enable versioning for state file history
    echo "🔄 Enabling versioning on bucket..."
    gcloud storage buckets update gs://$BUCKET_NAME --versioning

    # Set lifecycle policy to clean up old versions (keep last 10 versions)
    echo "🧹 Setting up lifecycle policy..."
    cat > lifecycle.json << EOF
{
  "lifecycle": {
    "rule": [
      {
        "action": {
          "type": "Delete"
        },
        "condition": {
          "numNewerVersions": 10
        }
      }
    ]
  }
}
EOF

    gcloud storage buckets update gs://$BUCKET_NAME --lifecycle-file=lifecycle.json
    rm lifecycle.json
else
    echo "✅ Using existing bucket configuration"
fi

# Configure Pulumi to use GCS backend
echo "⚙️  Configuring Pulumi backend..."

# Check if we're already using this backend
CURRENT_BACKEND=""
if CURRENT_BACKEND=$(pulumi whoami 2>/dev/null); then
    if echo "$CURRENT_BACKEND" | grep -q "gs://$BUCKET_NAME"; then
        echo "✅ Already using GCS backend: gs://$BUCKET_NAME"
        exit 0
    elif echo "$CURRENT_BACKEND" | grep -q "gs://"; then
        echo "ℹ️  Currently using different GCS backend: $CURRENT_BACKEND"
        echo "   Switching to: gs://$BUCKET_NAME"
    else
        echo "ℹ️  Currently using backend: $CURRENT_BACKEND"
        echo "   Switching to GCS backend: gs://$BUCKET_NAME"
    fi
fi

# Login to GCS backend
pulumi login gs://$BUCKET_NAME

echo ""
echo "✅ GCS backend setup complete!"
echo ""
echo "📋 Backend Details:"
echo "   Bucket: gs://$BUCKET_NAME"
echo "   Region: $REGION"
echo "   Versioning: Enabled"
echo "   Lifecycle: Keep last 10 versions"
echo ""
echo "🔧 Pulumi is now configured to use GCS backend"
echo "   Your state files will be stored securely in Google Cloud Storage"
echo ""
echo "📝 To use this backend in the future:"
echo "   pulumi login gs://$BUCKET_NAME"
echo ""
echo "🚀 You can now proceed with your Pulumi deployment:"
echo "   pulumi stack init dev"
echo "   pulumi up" 