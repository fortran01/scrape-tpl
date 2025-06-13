#!/bin/bash

# Script to upload secrets from .env file to GitHub repository
# Requires GitHub CLI (gh) to be installed and authenticated

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${YELLOW}TPL Scraper - GitHub Secrets Upload Script${NC}"
echo "=============================================="

# Check if GitHub CLI is installed
if ! command -v gh &> /dev/null; then
    echo -e "${RED}Error: GitHub CLI (gh) is not installed.${NC}"
    echo "Please install it from: https://cli.github.com/"
    echo "Or run: brew install gh"
    exit 1
fi

# Check if user is authenticated
if ! gh auth status &> /dev/null; then
    echo -e "${RED}Error: Not authenticated with GitHub CLI.${NC}"
    echo "Please run: gh auth login"
    exit 1
fi

# Check if .env file exists
if [ ! -f ".env" ]; then
    echo -e "${RED}Error: .env file not found in current directory.${NC}"
    echo "Please make sure you're running this script from the project root."
    exit 1
fi

echo -e "${YELLOW}Reading secrets from .env file...${NC}"

# Read .env file and upload secrets
while IFS='=' read -r key value || [ -n "$key" ]; do
    # Skip empty lines and comments
    if [[ -z "$key" || "$key" =~ ^[[:space:]]*# ]]; then
        continue
    fi
    
    # Remove any whitespace
    key=$(echo "$key" | xargs)
    value=$(echo "$value" | xargs)
    
    if [[ -n "$key" && -n "$value" ]]; then
        echo -e "Uploading secret: ${GREEN}$key${NC}"
        
        # Upload the secret to GitHub
        if echo "$value" | gh secret set "$key"; then
            echo -e "✅ Successfully uploaded: ${GREEN}$key${NC}"
        else
            echo -e "❌ Failed to upload: ${RED}$key${NC}"
            exit 1
        fi
    fi
done < .env

echo ""
echo -e "${GREEN}✅ All secrets uploaded successfully!${NC}"
echo ""
echo -e "${YELLOW}Next steps:${NC}"
echo "1. The GitHub Actions workflow will now have access to your secrets"
echo "2. You can verify the secrets in your repository settings:"
echo "   Settings → Secrets and variables → Actions"
echo "3. The workflow will run daily at 9:00 AM UTC"
echo "4. You can also trigger it manually from the Actions tab"
echo ""
echo -e "${GREEN}Your TPL scraper is now ready to run on GitHub Actions!${NC}" 