FROM node:24-slim AS builder

WORKDIR /app
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN pnpm run build && pnpm prune --prod --ignore-scripts

FROM node:24-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production

RUN useradd --system --create-home --shell /bin/bash app

COPY --from=builder --chown=app:app /app/node_modules ./node_modules
COPY --from=builder --chown=app:app /app/dist ./dist
COPY --from=builder --chown=app:app /app/package.json ./package.json

USER app
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4000/health/ready').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "dist/config/main.js"]
