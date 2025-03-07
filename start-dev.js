// Register TypeScript path aliases
require('tsconfig-paths/register');

// Load ts-node configuration
require('ts-node').register({
  transpileOnly: true,
  compilerOptions: {
    module: 'commonjs'
  }
});

// Load the main module
require('./src/main');
