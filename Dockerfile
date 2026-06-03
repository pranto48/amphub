# --- build stage ---
FROM node:20-alpine AS build
WORKDIR /app

# Tell the build which backend to target
ENV VITE_BACKEND_MODE=rest
ENV VITE_API_URL=/api

# Read the build args and set them as environment variables
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_PUBLISHABLE_KEY
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL
ENV VITE_SUPABASE_PUBLISHABLE_KEY=$VITE_SUPABASE_PUBLISHABLE_KEY
ENV VITE_SUPABASE_PROJECT_ID=unused

COPY package.json package-lock.json* bun.lockb* ./
RUN npm install --no-audit --no-fund --legacy-peer-deps

COPY . .
# Build the SPA (TanStack Start with Vite). We only ship the client bundle
# behind nginx; SSR is not used in the Docker deployment.
RUN npm run build

# --- runtime stage ---
FROM nginx:1.27-alpine
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist/client /usr/share/nginx/html
# TanStack Start SPA mode outputs _shell.html instead of index.html.
# Copy it to index.html so Nginx serves it natively.
RUN cp /usr/share/nginx/html/_shell.html /usr/share/nginx/html/index.html || true
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
