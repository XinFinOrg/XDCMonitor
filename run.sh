#!/bin/bash

# Usage information
function show_usage {
  echo "XDC Monitor Control Script"
  echo "-------------------------"
  echo "Usage: ./run.sh [command]"
  echo ""
  echo "Commands:"
  echo "  up                Start the complete stack (app + prometheus + grafana) with latest code"
  echo "  down              Stop the complete stack"
  echo "  logs              View logs from all services"
  echo "  rebuild           Rebuild and restart the application container"
  echo "  clean             Stop and remove all containers, volumes and networks"
  echo "  restart [name]    Restart a specific container (e.g., grafana, prometheus, xdc-monitor)"
  echo "  xdc-monitor-logs  View logs from the app service only"
  echo "  grafana-logs      View logs from the grafana service only"
  echo "  prometheus-logs   View logs from the prometheus service only"
  echo "  clear-prometheus  Clear all prometheus metrics data"
  echo "  fix-permissions   Fix permissions for data directories"
  echo "  grafana-export    Export Grafana configs to version-controlled directory"
  echo "  grafana-import    Import Grafana configs from version-controlled directory"
  echo "  help              Show this help message"
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
    ;;

  logs)
    echo "Showing logs from all services. Press Ctrl+C to exit."
    docker-compose logs -f
    ;;

  xdc-monitor-logs)
    echo "Showing logs from the app xdc-monitor. Press Ctrl+C to exit."
    docker-compose logs -f xdc-monitor
    ;;

  grafana-logs)
    echo "Showing logs from the grafana service. Press Ctrl+C to exit."
    docker-compose logs -f grafana
    ;;

  prometheus-logs)
    echo "Showing logs from the prometheus service. Press Ctrl+C to exit."
    docker-compose logs -f prometheus
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

  clean)
    echo "Stopping and removing all containers, volumes and networks..."
    # Stop and remove all containers
    docker-compose down --volumes --remove-orphans

    # Prune containers, volumes and networks
    echo "Removing orphaned containers..."
    docker container prune -f

    echo "System cleaned successfully."
    ;;

  clear-prometheus)
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
    # Fix permissions before starting
    ./run.sh fix-permissions

    docker-compose up -d prometheus
    ;;

  fix-permissions)
    echo "Fixing permissions for data directories..."

    # Create directories if they don't exist
    mkdir -p prometheus_data
    mkdir -p grafana_data
    mkdir -p dist
    mkdir -p logs

    # Fix permissions for Prometheus data directory
    # Prometheus typically runs as nobody:nobody (uid 65534)
    chmod -R 777 prometheus_data

    # Fix permissions for Grafana data directory
    # Grafana runs as user 472
    chmod -R 777 grafana_data

    # Fix permissions for mounted code directories
    chmod -R 777 dist
    chmod -R 777 logs

    echo "Permissions fixed."
    ;;

  restart)
    if [ -z "$2" ]; then
      echo "Error: Missing container name"
      echo "Usage: ./run.sh restart [container-name]"
      echo "Available containers: xdc-monitor, prometheus, grafana"
      exit 1
    fi

    container_name="$2"
    echo "Restarting $container_name container..."
    docker-compose restart "$container_name"
    echo "$container_name container restarted successfully."
    ;;

  grafana-export)
    echo "Exporting Grafana configs to version-controlled directory..."

    # Ensure directories exist
    mkdir -p grafana_config/config
    mkdir -p grafana_config/provisioning/dashboards
    mkdir -p grafana_config/provisioning/datasources
    mkdir -p grafana_config/provisioning/plugins
    mkdir -p grafana_config/provisioning/alerting

    # Copy config files
    if [ -d "grafana_data/config" ]; then
      cp -rf grafana_data/config/* grafana_config/config/ 2>/dev/null || true
      echo "✓ Exported config files"
    else
      echo "× No config files found to export"
    fi

    # Copy provisioning files
    if [ -d "grafana_data/provisioning" ]; then
      # Dashboards
      if [ -d "grafana_data/provisioning/dashboards" ]; then
        cp -rf grafana_data/provisioning/dashboards/* grafana_config/provisioning/dashboards/ 2>/dev/null || true
        echo "✓ Exported dashboard provisioning files"
      fi

      # Datasources
      if [ -d "grafana_data/provisioning/datasources" ]; then
        cp -rf grafana_data/provisioning/datasources/* grafana_config/provisioning/datasources/ 2>/dev/null || true
        echo "✓ Exported datasource provisioning files"
      fi

      # Plugins
      if [ -d "grafana_data/provisioning/plugins" ]; then
        cp -rf grafana_data/provisioning/plugins/* grafana_config/provisioning/plugins/ 2>/dev/null || true
        echo "✓ Exported plugin provisioning files"
      fi

      # Alerting
      if [ -d "grafana_data/provisioning/alerting" ]; then
        cp -rf grafana_data/provisioning/alerting/* grafana_config/provisioning/alerting/ 2>/dev/null || true
        echo "✓ Exported alerting provisioning files"
      fi
    else
      echo "× No provisioning files found to export"
    fi

    echo "Grafana configuration exported to grafana_config/"
    echo "To commit these changes, run: git add grafana_config/ && git commit -m 'Update Grafana configuration'"
    ;;

  grafana-import)
    echo "Importing Grafana configs from version-controlled directory..."

    # Check if Grafana is running
    if docker ps | grep -q grafana; then
      echo "⚠️ Warning: Grafana is currently running. Changes may not take effect until restart."
      echo "Consider running './run.sh restart grafana' after import."
    fi

    # Ensure directories exist
    mkdir -p grafana_data/config
    mkdir -p grafana_data/provisioning/dashboards
    mkdir -p grafana_data/provisioning/datasources
    mkdir -p grafana_data/provisioning/plugins
    mkdir -p grafana_data/provisioning/alerting

    # Copy config files with verbose output
    if [ -d "grafana_config/config" ] && [ "$(ls -A grafana_config/config 2>/dev/null)" ]; then
      echo "Importing config files:"
      for file in grafana_config/config/*; do
        if [ -f "$file" ]; then
          filename=$(basename "$file")
          cp -f "$file" "grafana_data/config/" 2>/dev/null || true
          echo "  ✓ $filename"
        fi
      done
    else
      echo "× No config files found to import"
    fi

    # Copy provisioning files
    if [ -d "grafana_config/provisioning" ]; then
      # Dashboards
      if [ -d "grafana_config/provisioning/dashboards" ] && [ "$(ls -A grafana_config/provisioning/dashboards 2>/dev/null)" ]; then
        cp -rf grafana_config/provisioning/dashboards/* grafana_data/provisioning/dashboards/ 2>/dev/null || true
        echo "✓ Imported dashboard provisioning files"
      fi

      # Datasources
      if [ -d "grafana_config/provisioning/datasources" ] && [ "$(ls -A grafana_config/provisioning/datasources 2>/dev/null)" ]; then
        cp -rf grafana_config/provisioning/datasources/* grafana_data/provisioning/datasources/ 2>/dev/null || true
        echo "✓ Imported datasource provisioning files"
      fi

      # Plugins
      if [ -d "grafana_config/provisioning/plugins" ] && [ "$(ls -A grafana_config/provisioning/plugins 2>/dev/null)" ]; then
        cp -rf grafana_config/provisioning/plugins/* grafana_data/provisioning/plugins/ 2>/dev/null || true
        echo "✓ Imported plugin provisioning files"
      fi

      # Alerting
      if [ -d "grafana_config/provisioning/alerting" ] && [ "$(ls -A grafana_config/provisioning/alerting 2>/dev/null)" ]; then
        cp -rf grafana_config/provisioning/alerting/* grafana_data/provisioning/alerting/ 2>/dev/null || true
        echo "✓ Imported alerting provisioning files"
      fi
    else
      echo "× No provisioning files found to import"
    fi

    # Fix permissions
    chmod -R 777 grafana_data

    echo "Grafana configuration imported to grafana_data/"
    echo "If Grafana is running, restart it with: ./run.sh restart grafana"
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
