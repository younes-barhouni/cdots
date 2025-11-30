FROM node:18-alpine
WORKDIR /usr/src/app

# Copy package and lock files
COPY package.json package-lock.json* pnpm-lock.yaml* ./
RUN npm install

# Copy TypeScript config and source code
COPY tsconfig.json ./
COPY src ./src

# Build the TypeScript sources into the dist/ directory
RUN npm run build

# Expose the device service port
EXPOSE 3001

# Run the compiled application. Compile again at runtime in case dist is missing
CMD ["/bin/sh", "-c", "npm run build && node dist/index.js"]