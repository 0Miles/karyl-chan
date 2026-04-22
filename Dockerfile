FROM node:22-slim AS build

WORKDIR /usr/src/app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build


FROM node:22-slim AS runtime

WORKDIR /usr/src/app

ENV NODE_ENV=production \
    SQLITE_DB_PATH=/usr/src/app/data/database.sqlite

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /usr/src/app/build ./build

RUN mkdir -p /usr/src/app/data && chown -R node:node /usr/src/app

USER node

VOLUME ["/usr/src/app/data"]

CMD [ "npm", "run", "serve" ]
