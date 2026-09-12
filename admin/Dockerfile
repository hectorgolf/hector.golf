# Build context is the REPOSITORY ROOT, not admin/ — the app imports @hector/ui
# through the npm workspace, so the build needs the root package.json, the
# lockfile and the packages/ it depends on. Build it with
# `docker build -f admin/Dockerfile .`
# from the root; .dockerignore at the root keeps the context small.

FROM node:24-slim AS build
WORKDIR /repo

# Manifests first, so this layer caches until a dependency actually changes.
COPY package.json package-lock.json ./
COPY packages/ui/package.json ./packages/ui/
COPY packages/schemas/package.json ./packages/schemas/
COPY admin/package.json ./admin/
# The site is a workspace member the lockfile knows about; its manifest has to be
# present for `npm ci` to reconcile, but none of its sources are copied.
COPY astrosite/package.json ./astrosite/
RUN npm ci --workspace=hector-admin --include-workspace-root

COPY packages/ui ./packages/ui
COPY packages/schemas ./packages/schemas
COPY admin ./admin
RUN npm run build --workspace=hector-admin


FROM node:24-slim AS runtime
ENV NODE_ENV=production
WORKDIR /repo

COPY package.json package-lock.json ./
COPY packages/ui/package.json ./packages/ui/
COPY packages/schemas/package.json ./packages/schemas/
COPY admin/package.json ./admin/
COPY astrosite/package.json ./astrosite/
RUN npm ci --omit=dev --workspace=hector-admin --include-workspace-root \
    && npm cache clean --force

# Astro's standalone build inlines what it needs from @hector/ui, so only the
# compiled server is copied — the shared sources do not ship.
COPY --from=build /repo/admin/dist ./admin/dist

# Baked in rather than set as a Cloud Run env var: Terraform owns the service's
# environment and ignores only the image, so an env var set by `gcloud run
# deploy` would be reverted by the next apply.
ARG GIT_SHA=dev
ENV GIT_SHA=$GIT_SHA

# The node image ships a non-root user; nothing here needs root.
USER node

# Documentation only. Cloud Run injects PORT; the Astro node adapter reads it,
# and HOST must be 0.0.0.0 or the server is invisible to Cloud Run's router.
ENV HOST=0.0.0.0
EXPOSE 8080

CMD ["node", "./admin/dist/server/entry.mjs"]
