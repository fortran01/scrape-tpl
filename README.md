# Toronto Public Library New Items Scraper

A TypeScript application that monitors the Toronto Public Library RSS feed for new items and sends email notifications when changes are detected. The application uses PostgreSQL for efficient data persistence and runs daily on various platforms with minimal database usage.

## Features

- 🔍 Monitors TPL RSS feed for new items
- 📧 Sends beautifully formatted HTML emails with new items
- 🆕 Shows summary of new and removed events
- 📌 Highlights new events with badges
- 🔄 Runs daily via scheduling (GitHub Actions, Fly.io, etc.)
- 🗄️ PostgreSQL database for efficient data persistence
- 🧹 Automatic data pruning to minimize database usage
- 🚀 Containerized deployment
- ⚡ Written in TypeScript for type safety

## Prerequisites

- Node.js (v18 or later)
- npm
- PostgreSQL database (local or hosted)
- Gmail account (with App Password enabled)
- Deployment platform account (GitHub Actions, Fly.io, etc.)

## Local Development Setup

1. Clone the repository:
```bash
git clone <your-repo-url>
cd scrape-tpl
```

2. Install dependencies:
```bash
npm install
```

3. Set up PostgreSQL database:
Use a hosted PostgreSQL service (see PostgreSQL Hosting Options section below) and get your connection string.

4. Create a `.env` file in the root directory:
```bash
# Copy the example file and edit with your values
cp .env.example .env
```

Then edit `.env` with your actual values:
```env
EMAIL_USER=your.email@gmail.com
EMAIL_PASS=your_gmail_app_password
EMAIL_TO=destination@email.com
DATABASE_URL=postgresql://username:password@hostname:port/database_name
```

Note: You'll need to generate an App Password for your Gmail account at https://myaccount.google.com/apppasswords

5. Run the application:
```bash
npx ts-node src/index.ts
```

## Deployment Options

### Option 1: GitHub Actions (Recommended)

1. Fork this repository to your GitHub account

2. Set up your `.env` file locally (if you haven't already):
```bash
cp .env.example .env
# Then edit .env with your actual values
```

3. Install and authenticate with GitHub CLI:
```bash
# Install GitHub CLI (if not already installed)
brew install gh

# Authenticate with GitHub
gh auth login
```

4. Upload secrets automatically using the provided script:
```bash
# Using npm script
npm run upload-secrets

# Or run directly
./scripts/upload-secrets.sh
```

5. The workflow will automatically run daily at 9:00 AM UTC
   - You can also trigger it manually from the Actions tab
   - Data persistence is handled via PostgreSQL database
   - Requires a hosted PostgreSQL database (e.g., Neon, Supabase, AWS RDS)

6. Monitor runs:
   - Go to the Actions tab in your repository
   - View logs and status of each run

### Option 2: Fly.io

1. Install the Fly.io CLI and authenticate:
```bash
brew install flyctl
fly auth login
```

2. Create a new app and volume (first time only):
```bash
fly apps create tpl-scraper
fly volumes create tpl_data --region yyz
```

3. Set up secrets:
```bash
fly secrets set EMAIL_USER=your.email@gmail.com
fly secrets set EMAIL_PASS=your_gmail_app_password
fly secrets set EMAIL_TO=destination@email.com
fly secrets set DATABASE_URL=postgresql://username:password@hostname:port/database_name
```

4. Deploy and schedule:
```bash
# Create a new scheduled machine with volume mount
flyctl machines run . --schedule daily --volume tpl_data:/app/data --restart on-fail --region yyz
```

5. Monitor the application:
```bash
# List machines
fly machines list

# View logs
fly logs
```

## Updating the Application

### For GitHub Actions Deployment

Simply push your changes to the main branch of your forked repository:
```bash
git add .
git commit -m "Update scraper functionality"
git push origin main
```

The next scheduled run will automatically use your updated code. Previous data is preserved via GitHub artifacts.

### For Fly.io Deployment

When you make changes to the code:

1. Stop and destroy the existing machine:
```bash
# List machines to get the ID
fly machines list

# Destroy the machine
fly machine destroy <machine-id>
```

2. Create a new scheduled machine:
```bash
# This will build and deploy your changes
flyctl machines run . --schedule daily --volume tpl_data:/app/data --restart on-fail --region yyz
```

Note: The volume data persists between deployments, so your previous RSS feed state will be preserved.

## Email Notifications

The application sends HTML-formatted emails that include:
- Summary of new and removed events
- Event titles with direct links to TPL website
- Visual indicators for new events
- Full event descriptions and details

## Project Structure

- `src/index.ts` - Main application code with PostgreSQL integration
- `scripts/` - Utility scripts
  - `init-db.sql` - PostgreSQL database initialization script
  - `upload-secrets.sh` - Bash script to upload .env secrets to GitHub
- `.github/workflows/tpl-scraper.yml` - GitHub Actions workflow for daily runs
- `Dockerfile` - Container configuration
- `fly.toml` - Fly.io deployment configuration

## Database Schema

The application uses a single PostgreSQL table `rss_items` with the following structure:

- `id` - Primary key (auto-increment)
- `title` - Event title (unique identifier)
- `link` - Direct link to the event page
- `description` - Event description
- `content_encoded` - Full HTML content
- `record_data` - Additional metadata (JSONB)
- `first_seen` - When item was first detected
- `last_seen` - When item was last seen in feed
- `is_active` - Whether item is currently in the RSS feed
- `created_at` / `updated_at` - Timestamps

The application automatically:
- Creates the table and indexes on first run
- Prunes inactive items older than 30 days to minimize database usage
- Uses efficient upsert operations to minimize database writes

## PostgreSQL Hosting Options

For production deployments, you'll need a hosted PostgreSQL database. Here are some recommended options:

### Free Tier Options
- **[Neon](https://neon.tech/)** - Serverless PostgreSQL with generous free tier
- **[Supabase](https://supabase.com/)** - Open source Firebase alternative with PostgreSQL
- **[Railway](https://railway.app/)** - Simple deployment platform with PostgreSQL
- **[Aiven](https://aiven.io/)** - Free tier available for small projects

### Paid Options
- **AWS RDS** - Managed PostgreSQL on Amazon Web Services
- **Google Cloud SQL** - Managed PostgreSQL on Google Cloud Platform
- **Azure Database for PostgreSQL** - Microsoft's managed PostgreSQL service
- **DigitalOcean Managed Databases** - Simple and affordable managed PostgreSQL

### Setup Example (Neon)
1. Sign up at [neon.tech](https://neon.tech/)
2. Create a new project
3. Copy the connection string
4. Add it to your `.env` file as `DATABASE_URL`

## Error Handling

The application includes robust error handling:
- Email notifications for RSS feed fetch failures
- Persistent storage error recovery
- Email sending error handling

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Acknowledgments

- Toronto Public Library for providing the RSS feed
- Fly.io for hosting and scheduling capabilities
- Node.js and TypeScript communities for excellent tools and libraries
