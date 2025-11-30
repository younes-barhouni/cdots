FROM node:18-alpine
WORKDIR /usr/src/app

# Copy package and lock files
COPY package.json package-lock.json* pnpm-lock.yaml* ./
RUN npm install

# Copy TypeScript config and source code
COPY tsconfig.json ./
COPY src ./src

# Expose the network collector port
EXPOSE 3002

# Build the TypeScript sources into the dist/ directory
RUN npm run build

# Start the service using the compiled JavaScript
CMD ["node", "dist/index.js"]