#!/bin/bash

# Usage information
function show_usage {
  echo "XDC Monitor Control Script"
  echo "-------------------------"
  echo "Usage: ./run.sh [command]"
  echo ""
  echo "Commands:"
  echo "  up              Start the complete stack (app + prometheus + grafana) with latest code"
  echo "  down            Stop the complete stack"
  echo "  logs            View logs from all services"
  echo "  app-logs        View logs from the app service only"
  echo "  clear-metrics   Clear all prometheus metrics data"
  echo "  rebuild         Rebuild and restart the application container"
  echo "  clean           Stop and remove all containers, volumes and networks"
  echo "  fix-permissions Fix permissions for data directories"
  echo "  dev             Quick rebuild of just the app service with latest code"
  echo "  fast-dev        Start in development mode with hot reloading (FASTEST OPTION)"
  echo "  local-dev       Build locally and run in container (NO CONTAINER REBUILD NEEDED)"
  echo "  help            Show this help message"
  echo ""
}

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
  echo "Error: Docker is not running. Please start Docker first."
  exit 1
fi

# Process command line arguments
case "$1" in
  fast-dev)
    echo "Starting in FAST development mode with hot reloading..."
    # Ensure directories exist with proper permissions
    ./run.sh fix-permissions

    # Stop any existing containers
    docker-compose down 2>/dev/null || true
    docker-compose -f docker-compose.dev.yml down 2>/dev/null || true

    # Build and start the development services
    docker-compose -f docker-compose.dev.yml up -d

    echo "Development services running at:"
    echo "- XDC Monitor:  http://localhost:3000 (with hot reloading)"
    echo "- Metrics:      http://localhost:9090/metrics"
    echo "- Prometheus:   http://localhost:9091"
    echo "- Grafana:      http://localhost:3001 (admin/admin)"
    echo ""
    echo "To view logs: docker-compose -f docker-compose.dev.yml logs -f xdc-monitor-dev"
    echo "Code changes will automatically trigger rebuilds!"
    ;;

  up)
    echo "Starting complete stack with latest code..."
    # Ensure directories exist with proper permissions
    ./run.sh fix-permissions

    yarn build

    # Start all services
    docker-compose up -d

    echo "Services running at:"
    echo "- XDC Monitor:  http://localhost:3000"
    echo "- Metrics:      http://localhost:9090/metrics"
    echo "- Prometheus:   http://localhost:9091"
    echo "- Grafana:      http://localhost:3001 (admin/admin)"
    ;;

  down)
    echo "Stopping all services..."
    docker-compose down
    docker-compose -f docker-compose.dev.yml down 2>/dev/null || true
    ;;

  logs)
    echo "Showing logs from all services. Press Ctrl+C to exit."
    docker-compose logs -f
    ;;

  app-logs)
    echo "Showing logs from the app service. Press Ctrl+C to exit."
    # Check which compose file is active
    if [ -z "$(docker ps --filter name=xdc-monitor-dev -q)" ]; then
      docker-compose logs -f xdc-monitor
    else
      docker-compose -f docker-compose.dev.yml logs -f xdc-monitor-dev
    fi
    ;;

  rebuild)
    echo "Rebuilding and restarting the application..."
    docker-compose down
    docker-compose build --no-cache
    # Ensure directories exist with proper permissions
    ./run.sh fix-permissions
    docker-compose up -d
    echo "Rebuild complete. Services are running at:"
    echo "- XDC Monitor:  http://localhost:3000"
    echo "- Metrics:      http://localhost:9090/metrics"
    echo "- Prometheus:   http://localhost:9091"
    echo "- Grafana:      http://localhost:3001 (admin/admin)"
    ;;

  dev)
    echo "Quick rebuild and restart of just the xdc-monitor service..."
    docker-compose stop xdc-monitor
    docker-compose build xdc-monitor
    docker-compose up -d xdc-monitor
    echo "xdc-monitor service updated with latest code and running at http://localhost:3000"
    ;;

  clean)
    echo "Stopping and removing all containers, volumes and networks..."
    # Stop and remove all containers
    docker-compose down --volumes --remove-orphans
    docker-compose -f docker-compose.dev.yml down --volumes --remove-orphans 2>/dev/null || true

    # Prune containers, volumes and networks
    echo "Removing orphaned containers..."
    docker container prune -f

    echo "System cleaned successfully."
    ;;

  clear-metrics)
    echo "Clearing Prometheus metrics data..."
    # Stop relevant containers first
    docker-compose stop prometheus 2>/dev/null || true
    docker-compose -f docker-compose.dev.yml stop prometheus-dev 2>/dev/null || true

    read -p "Clear metrics data? (y/n) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
      rm -rf prometheus_data/*
      mkdir -p prometheus_data
      echo "Metrics data cleared."
    fi

    echo "Restarting prometheus..."
    # Fix permissions before starting
    ./run.sh fix-permissions

    # Check which compose file is active
    if [ -z "$(docker ps --filter name=xdc-monitor-dev -q)" ]; then
      docker-compose up -d prometheus
    else
      docker-compose -f docker-compose.dev.yml up -d prometheus-dev
    fi
    ;;

  fix-permissions)
    echo "Fixing permissions for data directories..."

    # Create directories if they don't exist
    mkdir -p prometheus_data
    mkdir -p grafana_config/provisioning/dashboards
    mkdir -p grafana_config/provisioning/datasources
    mkdir -p grafana_config/provisioning/alerting
    mkdir -p grafana_config/provisioning/plugins
    mkdir -p dist
    mkdir -p logs

    # Fix permissions for Prometheus data directory
    # Prometheus typically runs as nobody:nobody (uid 65534)
    chmod -R 777 prometheus_data

    # Fix permissions for Grafana config directory
    chmod -R 777 grafana_config

    # Fix permissions for mounted code directories
    chmod -R 777 dist
    chmod -R 777 logs

    echo "Permissions fixed."
    ;;

  local-dev)
    echo "Using local build workflow (build locally, run in container)..."

    # Build the application locally
    echo "Building application locally..."
    yarn build

    # Check if container exists and is running
    if [ -z "$(docker ps -q -f name=xdc-monitor)" ]; then
      # Container doesn't exist or isn't running, start it
      docker-compose up -d
    else
      # Container exists and is running, just restart it
      docker-compose restart xdc-monitor
    fi

    echo "Local build deployed to container. Services running at:"
    echo "- XDC Monitor:  http://localhost:3000"
    echo "- Metrics:      http://localhost:9090/metrics"
    echo "- Prometheus:   http://localhost:9091"
    echo "- Grafana:      http://localhost:3001 (admin/admin)"
    echo ""
    echo "To apply code changes:"
    echo "1. Edit your code"
    echo "2. Run 'yarn build' locally"
    echo "3. Run './run.sh local-dev' again or just 'docker-compose restart xdc-monitor'"
    ;;

  help|--help|-h)
    show_usage
    ;;

  *)
    echo "Unknown command: $1"
    show_usage
    exit 1
    ;;
esac
