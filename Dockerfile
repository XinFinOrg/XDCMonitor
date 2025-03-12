FROM node:23-alpine

# Create app directory
WORKDIR /app

# Copy package files and install production dependencies only
COPY package.json yarn.lock ./
RUN yarn install --production

# Expose ports
EXPOSE 3000
EXPOSE 9090

# Start the application
# Note: We don't copy dist - it will be mounted from host
CMD ["node", "dist/main"]
