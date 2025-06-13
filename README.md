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

## License

MIT License - see LICENSE file for details.
