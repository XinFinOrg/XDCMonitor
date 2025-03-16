FROM node:20-alpine

# Create app directory
WORKDIR /app

# Copy package files and install production dependencies
COPY package.json yarn.lock ./
RUN yarn install --production

# Expose ports
EXPOSE 3000
EXPOSE 9090

# Start the application
CMD ["node", "dist/main"]
