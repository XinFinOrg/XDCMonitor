FROM node:18-alpine AS builder

# Create app directory
WORKDIR /app

# Copy package files and install dependencies first
# This layer will be cached unless package.json or yarn.lock changes
COPY package.json yarn.lock ./
RUN yarn install

# Add build timestamp to force Docker to rebuild from this point on every build
# This ensures fresh builds but keeps the dependency cache
ARG BUILD_TIMESTAMP=$(date +%s)
RUN echo "Build timestamp: $BUILD_TIMESTAMP" > build_info.txt

# Copy source files
COPY . .

# Clean any existing build artifacts and build the application
RUN rm -rf dist
RUN yarn build

# Production image
FROM node:18-alpine

# Create app directory
WORKDIR /app

# Copy package files and install production dependencies only
COPY package.json yarn.lock ./
RUN yarn install --production

# Copy the built application from the builder stage
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/build_info.txt ./build_info.txt

# Expose ports
EXPOSE 3000
EXPOSE 9090

# Start the application
CMD ["node", "dist/main"]
