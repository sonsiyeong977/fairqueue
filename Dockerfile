FROM node:22-slim AS storefront-build

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY shared ./shared
COPY agent/offer-policy.js ./agent/offer-policy.js
COPY anchor-escrow/idl ./anchor-escrow/idl

WORKDIR /app/storefront
COPY storefront/package*.json ./
RUN npm ci
COPY storefront/index.html storefront/tsconfig.json storefront/vite.config.ts storefront/catalog.json ./
COPY storefront/src ./src
COPY storefront/public ./public
RUN npm run build

FROM node:22-slim

WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev

COPY agent ./agent
COPY shared ./shared
COPY anchor-escrow/idl ./anchor-escrow/idl
COPY dashboard ./dashboard
COPY platform-sim ./platform-sim
COPY storefront/catalog.json ./storefront/catalog.json
COPY --from=storefront-build /app/storefront/dist ./storefront/dist
COPY start.js ./

EXPOSE 8080
CMD ["npm", "start"]
