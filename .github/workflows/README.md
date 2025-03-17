# XDC Monitor CI/CD Workflows

This directory contains GitHub Actions workflows for continuous integration and deployment of the XDC Network Monitor.

## Current Workflows

### 1. CI Workflow (`ci.yml`)

The workflow consists of three jobs:

#### 1.1 Validate Job

Triggered on:

- Push to `main`, `statging` and `develop` branches
- Pull requests to `main`, `statging` and `develop` branches

Steps:

1. Checkout code
2. Setup Node.js environment
3. Install dependencies
4. Lint code
5. Run tests
6. Build application
7. Build Docker image (validates Dockerfile and build process)

#### 1.2 Security Scan Job

Triggered after successful validation:

Steps:

1. Checkout code
2. Setup Node.js environment
3. Install dependencies
4. Run npm audit (checks for npm package vulnerabilities)
5. Build Docker image
6. Scan Docker image with Trivy (checks for container vulnerabilities)

The security scan focuses on:

- High and critical vulnerabilities in npm dependencies
- High and critical vulnerabilities in the Docker image
- Only fixable vulnerabilities are considered as blockers

#### 1.3 Publish Job

Triggered only on:

- Push to `main`, `statging` and `develop` branches (not on pull requests)
- Only runs if both validation and security scanning pass

Steps:

1. Checkout code
2. Set up Docker Buildx
3. Login to GitHub Container Registry
4. Extract metadata for Docker
5. Build and push Docker image to GitHub Container Registry

The Docker images are tagged with:

- Branch name (e.g., `main`, `statging`, `develop`)
- Short commit SHA

### 2. Staging Deployment Workflow (`deploy-staging.yml`)

Triggered automatically when:

- The CI workflow completes successfully
- On the `statging` branch

Steps:

1. Checkout code
2. Set up SSH connection to staging server
3. Add target server to known hosts
4. Copy necessary deployment files to the server:
   - docker-compose.yml
   - .env.staging (renamed to .env on server)
   - run.sh
5. Pull latest Docker images and restart services

## Required Secrets for Workflows

### For CI Workflow

- No additional secrets required (uses GITHUB_TOKEN automatically)

### For Staging Deployment

- `STAGING_SSH_KEY`: Private SSH key for connecting to staging server
- `STAGING_HOST`: Hostname or IP address of staging server
- `STAGING_USER`: Username for SSH connection to staging server
- `STAGING_DEPLOY_PATH`: (Optional) Path where the application should be deployed

## Using the Docker Images

The published Docker images can be pulled from GitHub Container Registry:

```bash
# Pull the latest main branch image
docker pull ghcr.io/[organization]/xdc-monitor:main

# Pull a specific commit
docker pull ghcr.io/[organization]/xdc-monitor:sha-abcdef
```

## Planned Enhancements

Future improvements to our CI/CD pipeline:

1. **Production Deployment**: Add workflow for deploying to production from main branch
2. **Notifications**: Add status notifications for build and deployment
