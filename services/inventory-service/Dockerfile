FROM node:24.13-alpine

WORKDIR /app

COPY package*.json ./

RUN npm install

COPY . .

EXPOSE 3004

CMD ["npm", "start"]

# Trigger rebuild: 2025-02-03-004

