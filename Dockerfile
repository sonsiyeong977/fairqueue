FROM node:20-slim

WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev

COPY agent ./agent
COPY anchor-escrow/idl ./anchor-escrow/idl
COPY dashboard ./dashboard
COPY platform-sim ./platform-sim
COPY start.js ./

EXPOSE 8080
CMD ["npm", "start"]
