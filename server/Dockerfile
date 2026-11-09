# Pose server image; runs on any container host (see docs/deployment.md).
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:24-bookworm-slim
ENV NODE_ENV=production \
    FORMCOACH_HOST=0.0.0.0 \
    FORMCOACH_PORT=8080
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
# The BlazePose models are committed under models/, so nothing is downloaded at boot.
COPY models ./models
COPY static ./static

USER node
ARG VERSION=dev
ENV FORMCOACH_VERSION=${VERSION}
EXPOSE 8080
CMD ["node", "dist/main.js"]
