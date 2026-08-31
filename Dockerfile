# NOTE — read before using this container.
#
# Production actually deploys to Cloudflare Workers (via OpenNext), not
# Docker — see .github/workflows/deploy.yml and docs/infra.md. This
# Dockerfile exists so third-party devops tooling has a standard way to
# build and run the app, but it only serves STATIC / PUBLIC routes
# correctly (landing page, /legal/*, /sign-in's shell, etc.).
#
# Every authenticated page and API route calls getCloudflareContext()
# (src/lib/api-context.ts), which resolves the Hyperdrive DB binding and
# Worker secrets — that only exists inside the real Cloudflare Workers
# runtime. Outside it, those routes throw/500 (verified: GET /dashboard
# -> 500, GET /api/health -> 503 under plain `next start`). Cron polling,
# Queues, and the Analytics Engine dataset also have no equivalent here.
#
# In short: this container is fine for building/serving the public
# surface, but is NOT a working substitute for a real deploy.

FROM node:24-slim AS base
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

CMD ["npm", "start"]
