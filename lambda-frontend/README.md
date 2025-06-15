# TPL Lambda Frontend

A serverless AWS Lambda function that provides a web frontend for Toronto Public Library events data. This function connects to the same PostgreSQL database used by the TPL scraper and presents the events in a beautiful, responsive web interface using **AWS Lambda Function URLs** for direct HTTP access.

## Features

- 🌐 **Web Interface**: Clean, responsive HTML interface for browsing TPL events
- 📊 **JSON API**: RESTful API endpoint for programmatic access
- 🗄️ **PostgreSQL Integration**: Direct connection to the TPL scraper database
- 📱 **Mobile Responsive**: Optimized for all device sizes
- ⚡ **Fast Performance**: Bundled with esbuild for minimal cold starts
- 🎨 **Modern UI**: Beautiful calendar-style layout with event grouping
- 🔍 **Event Details**: Full event information including dates, descriptions, and branch info
- 🌐 **Lambda Function URL**: Direct HTTPS access without API Gateway complexity

## API Endpoints

### Web Interface
- `GET /` - Returns HTML interface showing all active events

### JSON API
- `GET /?format=json` - Returns JSON data with all active events

#### JSON Response Format
```json
{
  "items": [
    {
      "id": 1,
      "title": "Event Title",
      "link": "https://...",
      "description": "Event description",
      "event_dates": ["2024-01-15T10:00:00Z"],
      "feed_name": "Branch Name",
      "first_seen": "2024-01-01T00:00:00Z",
      "is_active": true
    }
  ],
  "count": 1,
  "lastUpdated": "2024-01-15T12:00:00Z"
}
```

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `DATABASE_URL` | PostgreSQL connection string | Yes |

## Development

### Prerequisites
- Node.js 20+
- npm
- Access to TPL PostgreSQL database

### Setup
```bash
# Install dependencies
npm install

# Build the function
npm run build

# Run tests
npm test

# Run with coverage
npm run test:coverage
```

### Local Testing
```bash
# Set environment variable
export DATABASE_URL="postgresql://user:pass@host:port/db"

# Build and test locally
npm run dev
```

## Deployment

### Quick Deployment with Script

1. **Set environment variables:**
   ```bash
   export DATABASE_URL="postgresql://user:pass@host:port/db"
   export AWS_REGION="us-east-1"  # optional, defaults to us-east-1
   ```

2. **Deploy:**
   ```bash
   ./deploy.sh
   ```

The script will:
- Build the Lambda function
- Create/update the Lambda function in AWS
- Set up Lambda Function URL with CORS
- Output the public URL for immediate access

### Manual AWS Lambda Deployment

1. **Build the function:**
   ```bash
   npm run build
   ```

2. **Create deployment package:**
   ```bash
   zip -r lambda-function.zip dist/ node_modules/
   ```

3. **Deploy via AWS CLI:**
   ```bash
   aws lambda create-function \
     --function-name tpl-frontend \
     --runtime nodejs20.x \
     --role arn:aws:iam::ACCOUNT:role/lambda-execution-role \
     --handler index.handler \
     --zip-file fileb://lambda-function.zip \
     --environment Variables='{DATABASE_URL=postgresql://...}'
   ```

4. **Create Function URL:**
   ```bash
   aws lambda create-function-url-config \
     --function-name tpl-frontend \
     --auth-type NONE \
     --cors '{
       "AllowCredentials": false,
       "AllowMethods": ["*"],
       "AllowOrigins": ["*"],
       "MaxAge": 86400
     }'
   ```

5. **Add Function URL Permission (Required for Public Access):**
   ```bash
   aws lambda add-permission \
     --function-name tpl-frontend \
     --statement-id FunctionURLAllowPublicAccess \
     --action lambda:InvokeFunctionUrl \
     --principal "*" \
     --function-url-auth-type NONE
   ```

## Architecture

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│ Lambda Function │───▶│  Lambda Function │───▶│   PostgreSQL    │
│      URL        │    │                  │    │    Database     │
│                 │    │ - Query DB       │    │                 │
│ - Direct HTTPS  │    │ - Render HTML    │    │ - TPL Events    │
│ - CORS Enabled  │    │ - Return JSON    │    │ - Active Items  │
│ - No API Gateway│    │ - Connection Pool│    │                 │
└─────────────────┘    └──────────────────┘    └─────────────────┘
```

## Troubleshooting

### 403 Forbidden Error on Function URL

**Problem**: Function URL returns `{"Message":"Forbidden"}` with HTTP 403 status.

**Cause**: Lambda Function URLs require explicit permission for public access, even when `AuthType` is set to `NONE`.

**Solution**: Add the required resource-based policy:
```bash
aws lambda add-permission \
  --function-name tpl-frontend \
  --statement-id FunctionURLAllowPublicAccess \
  --action lambda:InvokeFunctionUrl \
  --principal "*" \
  --function-url-auth-type NONE
```

**Verification**: The permission should create a policy statement like:
```json
{
  "Sid": "FunctionURLAllowPublicAccess",
  "Effect": "Allow",
  "Principal": "*",
  "Action": "lambda:InvokeFunctionUrl",
  "Resource": "arn:aws:lambda:region:account:function:tpl-frontend",
  "Condition": {
    "StringEquals": {
      "lambda:FunctionUrlAuthType": "NONE"
    }
  }
}
```
