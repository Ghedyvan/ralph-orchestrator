FROM node:22-bookworm-slim AS deps
WORKDIR /app
ARG HEROUI_AUTH_TOKEN
COPY package.json package-lock.json ./
RUN HEROUI_AUTH_TOKEN="$HEROUI_AUTH_TOKEN" npm ci --include=dev --no-audit --no-fund

FROM node:22-bookworm-slim AS builder
WORKDIR /app
ARG HEROUI_AUTH_TOKEN
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ARG HEROUI_AUTH_TOKEN
ENV NODE_ENV=production \
    RALPH_GIT_ENABLED=1 \
    RALPH_GIT_AUTO_COMMIT_ENABLED=1 \
    RALPH_GIT_PUSH_ENABLED=0 \
    RALPH_EXPLICIT_PUSH=0
RUN apt-get update \
  && apt-get install -y --no-install-recommends bash bubblewrap ca-certificates git wget \
  && npm install -g @openai/codex@0.128.0 --no-audit --no-fund \
  && rm -rf /var/lib/apt/lists/*
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/package-lock.json ./package-lock.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/.agents/skills /opt/ralph-skills
RUN chmod +x \
      /app/scripts/docker-entrypoint.sh \
      /app/scripts/install-ralph-skill.sh \
      /app/scripts/ralph-git-guard.sh \
      /app/scripts/codex-ralph-wrapper.mjs \
  && ln -sf /app/scripts/ralph-git-guard.sh /usr/local/bin/git \
  && ln -sf /app/scripts/codex-ralph-wrapper.mjs /usr/local/bin/codex-ralph
ENTRYPOINT ["/app/scripts/docker-entrypoint.sh"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
EXPOSE 3000
CMD ["npm", "run", "start"]
