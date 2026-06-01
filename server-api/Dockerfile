FROM node:20-alpine

WORKDIR /app

COPY server-api/package*.json ./

RUN npm install --omit=dev

COPY server-api/ ./

EXPOSE 3001

ENV NODE_ENV=production
ENV PORT=3001

CMD ["node", "index.js"]