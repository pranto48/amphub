# --- build stage ---
FROM node:20-alpine AS build
WORKDIR /app

# Tell the build which backend to target
ENV VITE_BACKEND_MODE=rest
ENV VITE_API_URL=/api
# Dummy values so the supabase adapter import doesn't crash at build time
ENV VITE_SUPABASE_URL=http://unused.local
ENV VITE_SUPABASE_PUBLISHABLE_KEY=unused
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
# TanStack Start outputs to .output/public for static assets in SPA mode,
# but standard Vite builds emit to dist/. Copy whichever exists.
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
