# Use the official Bun image
FROM oven/bun:1

# Install tini for proper signal handling (allows Ctrl+C to work)
RUN apt-get update && apt-get install -y --no-install-recommends tini && \
    rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy package files first for better layer caching
COPY package.json bun.lock* ./

# Install dependencies
RUN bun install --frozen-lockfile --production

# Copy application source code
# This is done after dependency installation to leverage Docker layer caching
COPY *.ts *.js ./
COPY types/ ./types/

# Expose the port the app runs on
EXPOSE 3030

# Set environment to production
ENV NODE_ENV=production

# Use tini as the entrypoint to handle signals properly
ENTRYPOINT ["/usr/bin/tini", "-s", "--"]

# Run the app
CMD ["bun", "check-number.ts"]

