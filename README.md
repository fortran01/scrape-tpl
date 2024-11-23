# Toronto Public Library New Items Scraper

A TypeScript application that monitors the Toronto Public Library RSS feed for new items and sends email notifications when changes are detected. The application runs daily on Fly.io and maintains a persistent record of previous feed states to avoid duplicate notifications.

## Features

- 🔍 Monitors TPL RSS feed for new items
- 📧 Sends beautifully formatted HTML emails with new items
- 🆕 Shows summary of new and removed events
- 📌 Highlights new events with badges
- 🔄 Runs daily via Fly.io scheduling
- 💾 Persistent storage to track changes
- 🚀 Containerized deployment
- ⚡ Written in TypeScript for type safety

## Prerequisites

- Node.js (v18 or later)
- npm
- Gmail account (with App Password enabled)
- Fly.io account

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

3. Create a `.env` file in the root directory:
```env
EMAIL_USER=your.email@gmail.com
EMAIL_PASS=your_gmail_app_password
EMAIL_TO=destination@email.com
```

Note: You'll need to generate an App Password for your Gmail account at https://myaccount.google.com/apppasswords

4. Run the application:
```bash
npx ts-node src/index.ts
```

## Deployment to Fly.io

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
```

4. Deploy and schedule:
```bash
# Create a new scheduled machine with volume mount
flyctl machines run . --schedule daily --volume tpl_data:/app/data --restart on-fail
```

5. Monitor the application:
```bash
# List machines
fly machines list

# View logs
fly logs
```

## Redeploying New Versions

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
flyctl machines run . --schedule daily --volume tpl_data:/app/data --restart on-fail
```

Note: The volume data persists between deployments, so your previous RSS feed state will be preserved.

## Email Notifications

The application sends HTML-formatted emails that include:
- Summary of new and removed events
- Event titles with direct links to TPL website
- Visual indicators for new events
- Full event descriptions and details

## Project Structure

- `src/index.ts` - Main application code
- `data/` - Local storage directory for XML files
- `Dockerfile` - Container configuration
- `fly.toml` - Fly.io deployment configuration

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
