FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --only=production

COPY src ./src

ENV PORT=5180
ENV NODE_ENV=production
EXPOSE 5180

CMD ["npm", "run", "start"]

