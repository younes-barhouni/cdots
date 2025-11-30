FROM node:18

# Create app directory
WORKDIR /usr/src/app

# Copy package and lock files to install dependencies
COPY package.json package-lock.json* tsconfig.json ./

# Install dependencies including dev dependencies so that the build step can run
RUN npm install

# Copy source files
COPY src ./src

# Build the TypeScript sources into the dist/ directory
RUN npm run build

# Expose the port used by the service
EXPOSE 3003

# Run the compiled application using node
CMD ["node", "dist/index.js"]