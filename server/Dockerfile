# --- build stage ---
FROM node:20-alpine AS builder

WORKDIR /app

# Install native dependencies for compiling better-sqlite3
RUN apk add --no-cache build-base python3

COPY server/package.json server/package-lock.json* ./

RUN npm ci --omit=dev

# Extract git SHA
ARG GIT_SHA=unknown
RUN echo "$GIT_SHA" > git-sha.txt

# --- runtime stage ---
FROM node:20-alpine AS runner

WORKDIR /app

# Create a non-root user and group with predefined UID/GID (10001)
RUN addgroup -g 10001 -S amphubgroup && \
    adduser -u 10001 -S -G amphubgroup -h /home/amphub amphub

# Create persistent data directory and grant write access only to it
RUN mkdir -p /app/data && \
    chown -R amphub:amphubgroup /app/data && \
    chmod 700 /app/data

# Copy dependencies and git SHA
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/git-sha.txt ./git-sha.txt

# Copy application source
COPY server/src ./src

# Set runtime user
USER amphub

EXPOSE 3355 7766

# Run the backend app
CMD ["node", "src/index.js"]
