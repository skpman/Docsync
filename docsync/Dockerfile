# Node services (api, sync). Build with --build-arg SERVICE=api|sync
FROM node:22-alpine
ARG SERVICE
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/common/package.json packages/common/
COPY packages/api/package.json packages/api/
COPY packages/sync/package.json packages/sync/
COPY packages/web/package.json packages/web/
RUN npm ci --no-audit --no-fund -w @docsync/common -w @docsync/${SERVICE} --include-workspace-root=false
COPY tsconfig.base.json ./
COPY db ./db
COPY packages/common ./packages/common
COPY packages/${SERVICE} ./packages/${SERVICE}
ENV NODE_ENV=production SERVICE=${SERVICE}
RUN mkdir -p /data/snapshots && chown node:node /data/snapshots
USER node
CMD npm start -w @docsync/${SERVICE}
