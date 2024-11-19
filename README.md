# Toronto Public Library New Items Scraper

A TypeScript application that monitors the Toronto Public Library RSS feed for new items and sends email notifications when changes are detected. The application runs daily on Fly.io and maintains a persistent record of previous feed states to avoid duplicate notifications.

## Features

- 🔍 Monitors TPL RSS feed for new items
- 📧 Sends beautifully formatted HTML emails with new items
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

1. Install the Fly.io CLI:
```bash
brew install flyctl
```

2. Login to Fly.io:
```bash
flyctl auth login
```

3. Create a new Fly.io application:
```bash
flyctl launch --name tpl-scraper --no-deploy -y
```

4. Create a volume for persistent storage in Toronto region:
```bash
flyctl volumes create tpl_data --size 1 --region yyz -y
```

5. Set up environment secrets:
```bash
flyctl secrets set EMAIL_USER=your.email@gmail.com
flyctl secrets set EMAIL_PASS=your_gmail_app_password
flyctl secrets set EMAIL_TO=destination@email.com
```

6. Deploy the application:
```bash
flyctl deploy
```

7. Set up daily scheduling:
```bash
flyctl machines run . --schedule daily
```

Note: The volume is automatically mounted at `/app/data` as configured in `fly.toml`.

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
