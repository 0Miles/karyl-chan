FROM node:22-trixie-slim AS frontend-build

WORKDIR /app

COPY frontend/package*.json frontend/
RUN cd frontend && npm ci

COPY frontend/ frontend/
RUN cd frontend && npm run build


FROM node:22-trixie-slim AS backend-build

WORKDIR /usr/src/app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build


FROM node:22-trixie-slim AS runtime

WORKDIR /usr/src/app

# ffmpeg is required by @discordjs/voice for audio decoding. The
# ffmpeg-static npm binary segfaults on this Debian Trixie base
# (glibc / linker mismatch with the prebuilt static binary), so we
# install the apt package and let prism-media discover it via PATH.
# --no-install-recommends keeps the image slim (~80MB vs 200MB).
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    SQLITE_DB_PATH=/usr/src/app/data/database.sqlite \
    WEB_PORT=3000

EXPOSE 3000

COPY package*.json ./

# Copy the node_modules resolved in the backend-build stage (where cross-
# platform lockfile issues do not surface because the full install ran
# there) and prune dev dependencies. This avoids `npm ci --omit=dev` in
# the runtime stage, which can fail when the lockfile was generated on
# a different platform (e.g. Windows dev) than the build (Linux).
COPY --from=backend-build /usr/src/app/node_modules ./node_modules
RUN npm prune --omit=dev && npm cache clean --force

COPY --from=backend-build /usr/src/app/build ./build
COPY --from=frontend-build /app/frontend/dist ./build/public

RUN mkdir -p /usr/src/app/data && chown -R node:node /usr/src/app

USER node

VOLUME ["/usr/src/app/data"]

CMD [ "npm", "run", "serve" ]
