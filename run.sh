#!/bin/bash

# Usage information
function show_usage {
  echo "XDC Monitor Control Script"
  echo "-------------------------"
  echo "Usage: ./run.sh [command]"
  echo ""
  echo "Commands:"
  echo "  up              Start the complete stack (app + prometheus + grafana)"
  echo "  down            Stop the complete stack"
  echo "  logs            View logs from all services"
  echo "  app-logs        View logs from the app service only"
  echo "  clear-metrics   Clear all prometheus metrics data"
  echo "  rebuild         Rebuild and restart the application container"
  echo "  clean           Stop and remove all containers, volumes and networks"
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
  up)
    echo "Starting complete stack..."
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
    ;;

  logs)
    echo "Showing logs from all services. Press Ctrl+C to exit."
    docker-compose logs -f
    ;;

  app-logs)
    echo "Showing logs from the app service. Press Ctrl+C to exit."
    docker-compose logs -f xdc-monitor
    ;;

  rebuild)
    echo "Rebuilding and restarting the application..."
    docker-compose down
    docker-compose build --no-cache
    docker-compose up -d
    echo "Rebuild complete. Services are running at:"
    echo "- XDC Monitor:  http://localhost:3000"
    echo "- Metrics:      http://localhost:9090/metrics"
    echo "- Prometheus:   http://localhost:9091"
    echo "- Grafana:      http://localhost:3001 (admin/admin)"
    ;;

  clean)
    echo "Stopping and removing all containers, volumes and networks..."
    # Stop and remove all containers
    docker-compose down --volumes --remove-orphans

    # Prune containers, volumes and networks
    echo "Removing orphaned containers..."
    docker container prune -f

    echo "System cleaned successfully."
    ;;

  clear-metrics)
    echo "Clearing Prometheus metrics data..."
    # Stop relevant containers first
    docker-compose stop prometheus 2>/dev/null || true

    read -p "Clear metrics data? (y/n) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
      rm -rf prometheus_data/*
      mkdir -p prometheus_data
      echo "Metrics data cleared."
    fi

    echo "Restarting prometheus..."
    docker-compose up -d prometheus
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
