FROM node:23-alpine

# Create app directory
WORKDIR /app

# Copy package files and install production dependencies
COPY package.json yarn.lock ./
RUN yarn install --production

# Copy pre-built application (assuming it was built locally first)
COPY ./dist ./dist

# Expose ports
EXPOSE 3000
EXPOSE 9090

# Start the application
CMD ["node", "dist/main"]
