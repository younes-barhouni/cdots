## Build stage for the network performance dashboard.  This uses
## Node.js to install dependencies and run the Vite build.  The
## resulting static files are then served by nginx.

FROM node:18 AS builder
WORKDIR /usr/src/app

# Install dependencies
COPY package.json ./
COPY package-lock.json* ./
RUN npm install

# Copy source code
COPY . .

# Build the production bundle
RUN npm run build

FROM nginx:alpine
COPY --from=builder /usr/src/app/dist /usr/share/nginx/html

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]