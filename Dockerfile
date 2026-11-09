# syntax=docker/dockerfile:1.7
FROM node:26.12.1-alpine3.24 AS dependencies

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --ignore-scripts --no-audit --no-fund \
    && npm cache clean --force

FROM node:26.12.1-alpine3.24

ENV NODE_ENV=production \
    PORT=8080
WORKDIR /app

COPY --from=dependencies --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json ./
COPY --chown=node:node src ./src

USER node
EXPOSE 8080

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=5 \
  CMD ["node", "-e", "const p=process.env.API_BASE_PATH||'api/v1';fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/'+p.replace(/^\\/+|\\/+$/g,'')+'/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]

CMD ["node", "src/server.js"]
