FROM node:18-slim

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy source code
COPY . .

# Build TypeScript
RUN npm run build

# Create data directory
RUN mkdir -p /app/data

# Set environment variables (these should be set in Fly.io secrets)
ENV NODE_ENV=production

# Run the script
CMD ["node", "dist/index.js"]
