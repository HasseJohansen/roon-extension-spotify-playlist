# Dockerfile for the Roon Spotify Playlist Importer extension
# Multi-stage build for a smaller final image

# Build stage
FROM node:24-alpine AS builder

WORKDIR /app

# git is required to install the git-hosted node-roon-api* dependencies
RUN apk add --no-cache git

# Copy package files and install dependencies
COPY package*.json ./
RUN npm ci

# Production stage
FROM node:24-alpine

WORKDIR /app

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 -h /home/nodejs

# /home/node kept for compatibility; /app must stay writable (config.json is
# persisted there by node-roon-api and the extension at runtime)
RUN mkdir -p /home/nodejs/.config /home/node && \
    chown -R nodejs:nodejs /app /home/nodejs /home/node

# Copy installed dependencies from the build stage
COPY --from=builder /app/node_modules ./node_modules

# Copy application files
COPY package*.json ./
COPY src ./src

# Hand everything to the non-root user
RUN chown -R nodejs:nodejs /app

USER nodejs

# Roon uses 9100-9200 for extensions; 8888 is the Spotify OAuth callback
EXPOSE 9100-9200
EXPOSE 8888

ENV NODE_ENV=production
ENV HOME=/home/nodejs

# Start the extension
CMD ["node", "src/index.js"]
