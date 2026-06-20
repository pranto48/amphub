# --- build stage ---
FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json* ./

RUN npm ci --omit=dev

# Create a non-root user and group with predefined UID/GID (10001)
RUN addgroup -g 10001 -S amphubgroup && \
    adduser -u 10001 -S -G amphubgroup -h /home/amphubuser amphubuser

# Create log directory and assign ownership
RUN mkdir -p /var/log/amphub && \
    chown -R amphubuser:amphubgroup /var/log/amphub

# --- runtime stage ---
FROM gcr.io/distroless/nodejs20-debian12 AS runner

WORKDIR /app

# Copy passwd and group definitions for user mapping
COPY --from=builder /etc/passwd /etc/passwd
COPY --from=builder /etc/group /etc/group

# Copy dependencies and log folder with correct permissions
COPY --from=builder --chown=amphubuser:amphubgroup /app/node_modules ./node_modules
COPY --from=builder --chown=amphubuser:amphubgroup /var/log/amphub /var/log/amphub

# Copy application source
COPY --chown=amphubuser:amphubgroup src ./src

# Set runtime user
USER amphubuser

EXPOSE 4000

# distroless node image has node binary as entrypoint, so CMD is the script path
CMD ["src/index.js"]
