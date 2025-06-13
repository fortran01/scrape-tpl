# Toronto Public Library New Items Scraper

A TypeScript application that monitors multiple Toronto Public Library RSS feeds for new items and sends email notifications when changes are detected. The application uses PostgreSQL for efficient data persistence and runs daily on various platforms with minimal database usage.

## Features

- 🔍 Monitors multiple TPL RSS feeds for new items
- 📧 Sends beautifully formatted HTML emails with new items
- 🆕 Shows summary of new and removed events
- 📌 Highlights new events with badges
- 🏢 Shows which branch each event is from
- 🔄 Runs daily via scheduling (GitHub Actions, Google Cloud, Fly.io)
- 🗄️ PostgreSQL database for efficient data persistence
- 🧹 Automatic data pruning to minimize database usage
- ⚙️ Configurable feeds via JSON configuration file
- 🚀 Containerized deployment
- ⚡ Written in TypeScript for type safety

## Prerequisites

- Node.js (v18 or later)
- npm
- PostgreSQL database (hosted recommended)
- Gmail account with App Password enabled
- Deployment platform account

## Quick Setup

1. **Clone and configure:**
   ```bash
   git clone <your-repo-url>
   cd scrape-tpl
   npm install
   cp .env.example .env
   cp config.example.json config.json
   ```

2. **Set up Gmail App Password:**
   - Go to [Google Account Security](https://myaccount.google.com/security)
   - Enable 2-Step Verification
   - Generate App Password for "Mail"
   - Use this 16-character password in your `.env` file

3. **Configure PostgreSQL database:**
   - Create a free database at [Neon](https://neon.tech), [Supabase](https://supabase.com), or [Railway](https://railway.app)
   - Add connection string to `.env` as `DATABASE_URL`

4. **Edit configuration files:**
   - Update `.env` with your email and database credentials
   - Update `config.json` with desired TPL branch feeds

## Configuration

### Environment Variables (.env)
```env
EMAIL_USER=your.email@gmail.com
EMAIL_PASS=your_gmail_app_password
EMAIL_TO=destination@email.com
DATABASE_URL=postgresql://username:password@hostname:port/database_name
```

### Feed Configuration (config.json)
```json
{
  "feeds": [
    {
      "name": "Parkdale Branch",
      "url": "https://www.torontopubliclibrary.ca/rss.jsp?N=37867+33162+37846&Ns=p_pub_date_sort&Nso=0",
      "enabled": true
    }
  ],
  "email": {
    "subject_prefix": "TPL New Items",
    "include_branch_name": true
  },
  "database": {
    "prune_inactive_after_days": 30
  }
}
```

## Deployment Options

### Option 1: Google Cloud Run (Recommended)

**Prerequisites:**
- Google Cloud account with billing enabled
- [Google Cloud CLI](https://cloud.google.com/sdk/docs/install) installed
- [Pulumi CLI](https://www.pulumi.com/docs/get-started/install/) installed
- Docker running

**Deploy:**
```bash
# Authenticate with Google Cloud
gcloud auth login
gcloud config set project YOUR_PROJECT_ID

# Deploy infrastructure
cd pulumi
./setup.sh
pulumi up
```

**Monitor:**
```bash
# View logs
gcloud logging read 'resource.type=cloud_run_job' --limit=10

# Manual execution
gcloud scheduler jobs run tpl-scraper-daily --location=us-central1

# Check status
gcloud scheduler jobs list --location=us-central1
```

### Option 2: GitHub Actions

**Setup:**
```bash
# Fork repository, then:
gh auth login
npm run upload-secrets  # Uploads .env to GitHub secrets
```

**Features:**
- Runs daily at 9:00 AM UTC
- Monitor via Actions tab
- Manual trigger available

### Option 3: Fly.io

**Setup:**
```bash
# Install and authenticate
brew install flyctl
fly auth login

# Deploy
fly apps create tpl-scraper
fly secrets set EMAIL_USER=your.email@gmail.com EMAIL_PASS=your_app_password EMAIL_TO=destination@email.com DATABASE_URL=your_db_url
flyctl machines run . --schedule daily --restart on-fail --region yyz
```

**Monitor:**
```bash
fly machines list
fly logs
```

## Operations

### Local Development
```bash
npx ts-node src/index.ts
```

### Database Management
```bash
# Clear database (with safety checks)
npm run clear-db
```

### Google Cloud Registry Cleanup

For Google Cloud deployments, Docker images accumulate over time and can consume storage quota. The project includes a cleanup utility to manage old container images:

**Prerequisites:**
- Google Cloud CLI authenticated (`gcloud auth login`)
- Pulumi configuration in place (`pulumi/Pulumi.dev.yaml`)

**Step-by-step execution:**

1. **Navigate to scripts directory and install dependencies:**
   ```bash
   cd scripts
   npm install
   ```

2. **Run basic cleanup (keeps 5 most recent images):**
   ```bash
   npm run cleanup-gcr
   ```

3. **Run cleanup including untagged images:**
   ```bash
   npm run cleanup-gcr-untagged
   ```

4. **Run directly with TypeScript (alternative method):**
   ```bash
   # Basic cleanup
   npx ts-node cleanup-gcr-images.ts
   
   # With untagged cleanup
   npx ts-node cleanup-gcr-images.ts --cleanup-untagged
   ```

**Configuration options:**
- `IMAGE_NAME` - Container image name (default: `tpl-scraper`)
- `KEEP_COUNT` - Number of recent images to keep (default: `5`)
- `REGISTRY` - Container registry (default: `gcr.io`)
- `CLEANUP_UNTAGGED` - Set to `true` to automatically clean untagged images

**Examples with custom settings:**
```bash
# Keep only 3 images instead of 5
KEEP_COUNT=3 npm run cleanup-gcr

# Clean up a different image
IMAGE_NAME=my-custom-app npm run cleanup-gcr

# Use Artifact Registry instead of Container Registry
REGISTRY=us-central1-docker.pkg.dev npm run cleanup-gcr

# Automatically clean untagged images without prompt
CLEANUP_UNTAGGED=true npx ts-node cleanup-gcr-images.ts
```

**What the script does:**
- Authenticates with Google Cloud
- Lists all tagged container images for your project
- Keeps the N most recent images (default: 5)
- Deletes older images to free up storage
- Optionally cleans up untagged images
- Provides detailed output of what was deleted

### Updates

**Google Cloud:**
```bash
cd pulumi && pulumi up
```

**GitHub Actions:**
```bash
git push origin main  # Auto-deploys on next run
```

**Fly.io:**
```bash
fly machine destroy <machine-id>
flyctl machines run . --schedule daily --restart on-fail --region yyz
```

## PostgreSQL Hosting Options

### Free Tier
- **[Neon](https://neon.tech/)** - Serverless PostgreSQL
- **[Supabase](https://supabase.com/)** - Open source Firebase alternative
- **[Railway](https://railway.app/)** - Simple deployment platform

## Utility Scripts

The `scripts/` directory contains additional utilities for managing the deployment:

### Available Scripts

- **`cleanup-gcr-images.ts`** - Google Cloud Registry cleanup tool
  - Automatically removes old Docker images to save storage costs
  - Configurable retention policy (default: keep 5 most recent)
  - Handles both tagged and untagged images
  - Reads configuration from Pulumi settings

### How to Run Scripts

1. **First-time setup:**
   ```bash
   cd scripts
   npm install
   ```

2. **Available npm commands:**
   ```bash
   # Clean up old container images (keep 5 most recent)
   npm run cleanup-gcr
   
   # Clean up old images including untagged ones
   npm run cleanup-gcr-untagged
   ```

3. **Direct execution with ts-node:**
   ```bash
   cd scripts
   npx ts-node cleanup-gcr-images.ts [options]
   ```

4. **Available options:**
   - `--cleanup-untagged` - Also remove untagged images
   - Environment variables: `IMAGE_NAME`, `KEEP_COUNT`, `REGISTRY`, `CLEANUP_UNTAGGED`

### Supporting Files
- **`package.json`** - Defines npm scripts and dependencies
- **`tsconfig.json`** - TypeScript configuration for scripts
- **`package-lock.json`** - Dependency lock file

These scripts are particularly useful for Google Cloud deployments where container images can accumulate over time and consume storage quota.

## License

MIT License - see LICENSE file for details.
