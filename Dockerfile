FROM node:18-slim

WORKDIR /app

# Create data directory and set permissions
RUN mkdir -p /app/data && chown -R node:node /app/data

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy source code
COPY . .

# Build TypeScript
RUN npm run build

# Set environment variables (these should be set in Fly.io secrets)
ENV NODE_ENV=production

# Switch to non-root user
USER node

# Run the script
CMD ["node", "dist/index.js"]
