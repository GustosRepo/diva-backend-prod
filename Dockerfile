# Use official Node LTS image
FROM node:20-slim

# Create app directory
WORKDIR /usr/src/app

# Install native deps first if any (none expected)

# Copy package manifests
COPY package.json package-lock.json* ./

# Install only production deps
RUN npm ci --only=production

# Copy source
COPY . .

# Build step if needed (not using TS build here)

# Expose port
ENV PORT 3001
EXPOSE 3001

# Default start command
CMD ["node", "server.js"]
