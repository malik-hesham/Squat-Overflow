# API server image (sign-in, leaderboard, sync); runs on any container host (see docs/deployment.md).
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
COPY static ./static
# Exercise demo videos (GET /demos/<move>.mp4), made by extension/scripts/make-demo-video.mjs.
COPY demos ./demos

USER node
ARG VERSION=dev
ENV FORMCOACH_VERSION=${VERSION}
EXPOSE 8080
CMD ["node", "dist/main.js"]
