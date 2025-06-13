#!/bin/bash

# TPL Scraper Database Clear Script
# This script clears all data from the TPL scraper database

set -e  # Exit on any error

echo "🗑️  TPL Scraper Database Clear Script"
echo "======================================"
echo ""

# Check if we're in the right directory
if [ ! -f "package.json" ] || [ ! -f "src/index.ts" ]; then
    echo "❌ Error: This script must be run from the project root directory"
    echo "   Make sure you're in the scrape-tpl directory"
    exit 1
fi

# Check if .env file exists
if [ ! -f ".env" ]; then
    echo "❌ Error: .env file not found"
    echo "   Make sure your environment variables are configured"
    exit 1
fi

# Load environment variables
source .env

# Check if DATABASE_URL is set
if [ -z "$DATABASE_URL" ]; then
    echo "❌ Error: DATABASE_URL environment variable is not set"
    echo "   Please configure your database connection in .env"
    exit 1
fi

echo "⚠️  WARNING: This will permanently delete ALL data from the TPL scraper database!"
echo "⚠️  This action cannot be undone."
echo ""
echo "Database: $(echo $DATABASE_URL | sed 's/postgresql:\/\/[^@]*@/postgresql:\/\/***:***@/')"
echo ""

# Production environment check
if [ "$NODE_ENV" = "production" ] || [ "$GITHUB_ACTIONS" = "true" ] || [ -n "$FLY_APP_NAME" ]; then
    echo "🚨 PRODUCTION ENVIRONMENT DETECTED!"
    echo "   To proceed in production, you must set CONFIRM_CLEAR_DB=true"
    echo ""
    
    if [ "$CONFIRM_CLEAR_DB" != "true" ]; then
        echo "❌ Operation cancelled. Set CONFIRM_CLEAR_DB=true to proceed in production."
        exit 1
    fi
    
    echo "✅ Production confirmation received."
    echo ""
fi

# Interactive confirmation for non-production
if [ "$NODE_ENV" != "production" ] && [ "$GITHUB_ACTIONS" != "true" ] && [ -z "$FLY_APP_NAME" ]; then
    read -p "Are you sure you want to clear the database? Type 'yes' to confirm: " confirmation
    
    if [ "$confirmation" != "yes" ]; then
        echo "❌ Operation cancelled."
        exit 0
    fi
fi

echo ""
echo "🔄 Building project..."
npm run build

echo ""
echo "🗑️  Clearing database..."
node dist/index.js --clear-db

echo ""
echo "✅ Database clear operation completed!"
echo "   You can now run the scraper to start fresh." 