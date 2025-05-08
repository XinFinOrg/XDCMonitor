#!/bin/bash

# Usage information
function show_usage {
  echo "XDC Monitor Control Script"
  echo "-------------------------"
  echo "Usage: ./run.sh [command]"
  echo ""
  echo "Commands:"
  echo "  up                Start the complete stack (app + influxdb + grafana) with latest code"
  echo "  down              Stop the complete stack"
  echo "  logs              View logs from all services"
  echo "  rebuild           Rebuild and restart the application container"
  echo "  clean             Stop and remove all containers, volumes and networks"
  echo "  restart [name]    Restart a specific container (e.g., grafana, influxdb, xdc-monitor)"
  echo "  start [name]      Start a specific container (e.g., grafana, influxdb, xdc-monitor)"
  echo "  stop [name]       Stop a specific container (e.g., grafana, influxdb, xdc-monitor)"
  echo "  xdc-monitor-logs  View logs from the app service only"
  echo "  grafana-logs      View logs from the grafana service only"
  echo "  influxdb-logs     View logs from the influxdb service only"
  echo "  clear-influxdb    Clear all influxdb metrics data"
  echo "  fix-permissions   Fix permissions for data directories"
  echo "  grafana-export    Export Grafana configs to version-controlled directory"
  echo "  grafana-import    Import Grafana configs from version-controlled directory"
  echo "  setup-healthcheck  Set up UptimeRobot monitoring for VPS downtime detection"
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

    # Start all services - influxdb first to ensure it's ready when xdc-monitor starts
    echo "Starting InfluxDB..."
    docker-compose up -d influxdb

    echo "Waiting for InfluxDB to initialize (10 seconds)..."
    sleep 10

    echo "Ensuring clean state for xdc-monitor..."
    docker-compose stop xdc-monitor 2>/dev/null || true
    docker-compose rm -f xdc-monitor 2>/dev/null || true

    echo "Starting xdc-monitor with mounted code volume..."
    docker-compose up -d xdc-monitor

    echo "Starting Grafana..."
    docker-compose up -d grafana

    echo ""
    echo "XDC Monitor is now running!"
    echo "- Monitoring API: http://localhost:3000"
    echo "- Grafana Dashboard: http://localhost:3001 "
    echo "- InfluxDB: http://localhost:8086"
    echo ""
    echo "Use './run.sh logs' to view logs"
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

  influxdb-logs)
    echo "Showing logs from the influxdb service. Press Ctrl+C to exit."
    docker-compose logs -f influxdb
    ;;

  rebuild)
    echo "Rebuilding and restarting the application..."

    # Stop the services
    docker-compose down

    # Build the TypeScript code
    yarn build

    # Start with the same sequence as 'up' command for better reliability
    echo "Starting InfluxDB..."
    docker-compose up -d influxdb

    echo "Waiting for InfluxDB to initialize (10 seconds)..."
    sleep 10

    echo "Ensuring clean state for xdc-monitor..."
    docker-compose stop xdc-monitor 2>/dev/null || true
    docker-compose rm -f xdc-monitor 2>/dev/null || true

    echo "Building and starting xdc-monitor..."
    docker-compose up -d --build xdc-monitor

    echo "Starting Grafana..."
    docker-compose up -d grafana

    echo "Application rebuilt and restarted."
    ;;

  clean)
    echo "Stopping and removing all containers, volumes and networks..."
    # Stop and remove all containers
    docker-compose down --volumes --remove-orphans

    # Remove specific containers that might cause issues
    docker rm -f influxdb 2>/dev/null || true
    docker rm -f grafana 2>/dev/null || true
    docker rm -f xdc-monitor 2>/dev/null || true

    # Prune containers, volumes and networks
    echo "Removing orphaned containers..."
    docker container prune -f

    echo "System cleaned successfully."
    ;;

  clear-influxdb)
    echo "Clearing InfluxDB metrics data..."
    # Stop relevant containers first
    docker-compose stop influxdb 2>/dev/null || true
    docker rm -f influxdb 2>/dev/null || true

    read -p "Clear metrics data? (y/n) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
      # Remove the local influxdb_data directory instead of the volume
      echo "Removing influxdb_data directory..."
      rm -rf ./influxdb_data/* 2>/dev/null || true
      echo "InfluxDB data cleared."
    fi

    echo "Restarting InfluxDB..."
    # Fix permissions before starting
    ./run.sh fix-permissions

    echo "Starting InfluxDB with initial setup..."
    docker-compose up -d influxdb

    echo "Waiting for InfluxDB to initialize (10 seconds)..."
    sleep 10

    echo "InfluxDB has been reset and restarted."
    echo "The bucket '${INFLUXDB_BUCKET}' should be automatically recreated."
    ;;

  fix-permissions)
    echo "Fixing permissions for data directories..."

    # Create directories if they don't exist
    mkdir -p grafana_data
    mkdir -p influxdb_data
    mkdir -p dist
    mkdir -p logs

    # Fix permissions for data directories
    chmod -R 777 grafana_data
    chmod -R 777 influxdb_data
    chmod -R 777 dist
    chmod -R 777 logs

    echo "Permissions fixed."
    ;;

  start)
    if [ -z "$2" ]; then
      echo "Error: Missing container name"
      echo "Usage: ./run.sh start [container-name]"
      echo "Available containers: xdc-monitor, influxdb, grafana"
      exit 1
    fi

    container_name="$2"
    echo "Starting $container_name container..."

    # Special handling for services that need proper initialization
    case "$container_name" in
      influxdb)
        # Ensure directories and permissions
        ./run.sh fix-permissions

        echo "Starting InfluxDB..."
        if docker-compose up -d influxdb; then
          echo "Waiting for InfluxDB to initialize (10 seconds)..."
          sleep 10
          echo "InfluxDB started successfully."
        else
          echo "Error: Failed to start InfluxDB container."
          exit 1
        fi
        ;;

      grafana)
        # Ensure directories and permissions
        ./run.sh fix-permissions

        echo "Starting Grafana..."
        if docker-compose up -d grafana; then
          echo "Grafana started successfully."
          echo "Dashboard available at: http://localhost:3001"
        else
          echo "Error: Failed to start Grafana container."
          exit 1
        fi
        ;;

      xdc-monitor)
        # Check if InfluxDB is running
        if ! docker ps | grep -q influxdb; then
          echo "Warning: InfluxDB is not running. Starting InfluxDB first..."
          ./run.sh start influxdb
        fi

        echo "Starting XDC Monitor..."
        if docker-compose up -d xdc-monitor; then
          echo "XDC Monitor started successfully."
          echo "API available at: http://localhost:3000"
        else
          echo "Error: Failed to start XDC Monitor container."
          exit 1
        fi
        ;;

      *)
        echo "Starting generic container: $container_name..."
        if docker-compose up -d "$container_name"; then
          echo "$container_name started successfully."
        else
          echo "Error: Failed to start $container_name container. Does the service exist?"
          exit 1
        fi
        ;;
    esac
    ;;

  stop)
    if [ -z "$2" ]; then
      echo "Error: Missing container name"
      echo "Usage: ./run.sh stop [container-name]"
      echo "Available containers: xdc-monitor, influxdb, grafana"
      exit 1
    fi

    container_name="$2"
    echo "Stopping $container_name container..."

    # Stop the specific container
    if docker-compose stop "$container_name"; then
      echo "$container_name container stopped successfully."
    else
      echo "Error: Failed to stop $container_name container. Does the service exist?"
      exit 1
    fi
    ;;

  restart)
    if [ -z "$2" ]; then
      echo "Error: Missing container name"
      echo "Usage: ./run.sh restart [container-name]"
      echo "Available containers: xdc-monitor, influxdb, grafana"
      exit 1
    fi

    container_name="$2"
    echo "Restarting $container_name container..."

    # Special handling for grafana to ensure datasources are properly configured
    if [ "$container_name" = "grafana" ]; then
      if docker-compose stop grafana && \
         (docker rm -f grafana 2>/dev/null || true) && \
         docker-compose up -d grafana; then
        echo "$container_name container restarted successfully."
      else
        echo "Error: Failed to restart $container_name container."
        exit 1
      fi
    # Special handling for influxdb to ensure proper initialization
    elif [ "$container_name" = "influxdb" ]; then
      if docker-compose stop influxdb && \
         (docker rm -f influxdb 2>/dev/null || true) && \
         docker-compose up -d influxdb; then
        echo "$container_name container restarted successfully."
      else
        echo "Error: Failed to restart $container_name container."
        exit 1
      fi
    else
      if docker-compose restart "$container_name"; then
        echo "$container_name container restarted successfully."
      else
        echo "Error: Failed to restart $container_name container. Does the service exist?"
        exit 1
      fi
    fi
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

      # Datasources - with token placeholders
      if [ -d "grafana_data/provisioning/datasources" ]; then
        mkdir -p grafana_config/provisioning/datasources
        for file in grafana_data/provisioning/datasources/*.yaml; do
          if [ -f "$file" ]; then
            # Copy file first as a base
            cp -f "$file" "grafana_config/provisioning/datasources/$(basename "$file")"

            # Get the InfluxDB token from .env
            if [ -f ".env" ]; then
              # Extract token without quotes
              INFLUXDB_TOKEN=$(grep "^INFLUXDB_TOKEN=" .env | sed 's/^INFLUXDB_TOKEN=//')
              if [ ! -z "$INFLUXDB_TOKEN" ]; then
                # Use a more robust perl replace instead of sed
                perl -i -pe 's|"'"$INFLUXDB_TOKEN"'"|__INFLUXDB_TOKEN__|g' "grafana_config/provisioning/datasources/$(basename "$file")"
                echo "✓ Exported datasource: $(basename "$file") with token placeholder"
              else
                echo "✓ Exported datasource: $(basename "$file")"
              fi
            else
              echo "✓ Exported datasource: $(basename "$file")"
            fi
          fi
        done
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
          # Remove destination if it's a directory
          if [ -d "grafana_data/config/$filename" ]; then
            rm -rf "grafana_data/config/$filename"
          fi
          cp -f "$file" "grafana_data/config/$filename" 2>/dev/null || true
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

      # Datasources - with token substitution
      if [ -d "grafana_config/provisioning/datasources" ] && [ "$(ls -A grafana_config/provisioning/datasources 2>/dev/null)" ]; then
        mkdir -p grafana_data/provisioning/datasources
        for file in grafana_config/provisioning/datasources/*.yaml; do
          if [ -f "$file" ]; then
            filename=$(basename "$file")
            # Remove destination if it's a directory
            if [ -d "grafana_data/provisioning/datasources/$filename" ]; then
              rm -rf "grafana_data/provisioning/datasources/$filename"
            fi
            # Copy file first as a base
            cp -f "$file" "grafana_data/provisioning/datasources/$filename"

            # Get the InfluxDB token from .env
            if [ -f ".env" ]; then
              # Extract token without quotes or extra spaces
              INFLUXDB_TOKEN=$(grep "^INFLUXDB_TOKEN=" .env | sed 's/^INFLUXDB_TOKEN=//' | tr -d '"' | tr -d ' ')
              if [ ! -z "$INFLUXDB_TOKEN" ]; then
                # Use perl for more robust replacement that handles special characters like =
                perl -i -pe 's|__INFLUXDB_TOKEN__|"'"$INFLUXDB_TOKEN"'"|g' "grafana_data/provisioning/datasources/$filename"
                echo "✓ Imported datasource: $filename with token from .env"
              else
                echo "⚠️ Imported datasource: $filename - no token found in .env"
              fi
            else
              echo "⚠️ Imported datasource: $filename - .env file not found"
            fi
          fi
        done
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

  setup-healthcheck)
    echo "Setting up UptimeRobot monitoring for VPS downtime detection..."
    
    # Get server IP and port
    SERVER_IP=$(hostname -I | awk '{print $1}')
    API_PORT=3000
    
    # Extract Telegram bot token and chat ID from environment file
    if [ -f ".env" ]; then
      TELEGRAM_BOT_TOKEN=$(grep "^TELEGRAM_BOT_TOKEN=" .env | sed 's/^TELEGRAM_BOT_TOKEN=//' | tr -d '"' | tr -d " ")
      TELEGRAM_CHAT_ID=$(grep "^TELEGRAM_CHAT_ID=" .env | sed 's/^TELEGRAM_CHAT_ID=//' | tr -d '"' | tr -d " ")
      
      if [ -z "$TELEGRAM_BOT_TOKEN" ] || [ -z "$TELEGRAM_CHAT_ID" ]; then
        echo "⚠️ Warning: Could not find Telegram bot token or chat ID in .env file."
        echo "Please make sure TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID are set in your .env file."
      else
        echo "✅ Found Telegram configuration in .env file."
      fi
    else
      echo "⚠️ Warning: .env file not found. Cannot extract Telegram configuration."
    fi
    
    echo ""
    echo "📋 UptimeRobot Setup Instructions:"
    echo "-----------------------------"
    echo "1. Create an account at https://uptimerobot.com/ if you don't have one"
    echo "2. Add a new HTTP(s) monitor with these settings:"
    echo "   - Friendly Name: XDC Monitor VPS"
    echo "   - URL to monitor: http://$SERVER_IP:$API_PORT"
    echo "   - Monitoring Interval: 5 minutes (recommended)"
    echo ""
    echo "3. Set up Telegram notifications:"
    echo "   - Go to 'Alert Contacts' → 'Add Alert Contact'"
    echo "   - Select 'Telegram'"
    if [ ! -z "$TELEGRAM_BOT_TOKEN" ] && [ ! -z "$TELEGRAM_CHAT_ID" ]; then
      echo "   - Bot Token: $TELEGRAM_BOT_TOKEN"
      echo "   - Chat ID: $TELEGRAM_CHAT_ID"
    else
      echo "   - Enter your Telegram bot token and chat ID"
    fi
    echo "   - Test the integration"
    echo ""
    echo "4. Configure your monitor to use this alert contact"
    echo ""
    echo "⚠️ Important: This monitoring setup must be performed on UptimeRobot's website."
    echo "   The script only provides the necessary configuration information."
    echo "   UptimeRobot will monitor your VPS from external servers and send"
    echo "   Telegram alerts when your VPS becomes unreachable."
    ;;

  help|--help|-h)
    show_usage
    ;;

  *)
    if [ -z "$1" ]; then
      show_usage
      exit 0
    else
      echo "Unknown command: $1"
      show_usage
      exit 1
    fi
    ;;
esac
