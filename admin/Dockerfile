# Two stages so the devDependencies and the TypeScript sources stay out of the
# image that runs. What ships is Node, the production dependencies, and dist/.

FROM node:24-slim AS build
WORKDIR /app

# Copied before the sources so this layer is cached until the lockfile changes.
COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
# tsconfig sets noEmitOnError, so a type error fails the image rather than
# producing one built from code that did not compile.
RUN npm run build


FROM node:24-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist

# Baked into the image rather than passed as a Cloud Run env var, because
# Terraform owns the service's environment (see terraform/cloud_run.tf) and
# ignores only the image. An env var set by `gcloud run deploy` would be
# reverted by the next apply; a value built into the image cannot be.
ARG GIT_SHA=dev
ENV GIT_SHA=$GIT_SHA

# The node image ships a non-root `node` user. Cloud Run does not require it,
# but nothing here needs root and an image that never runs as root cannot be
# made to by accident.
USER node

# Documentation only: Cloud Run injects PORT and the server reads it. 8080 is
# both Cloud Run's default and the one src/config.ts falls back to.
EXPOSE 8080

CMD ["node", "dist/index.js"]
