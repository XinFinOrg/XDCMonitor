#!/bin/bash

echo "Migrating Grafana configuration to separate version-controlled directory..."

# Create new directory structure
mkdir -p grafana_config/provisioning/dashboards
mkdir -p grafana_config/provisioning/datasources
mkdir -p grafana_config/provisioning/alerting
mkdir -p grafana_config/provisioning/plugins

# Copy provisioning files
echo "Copying provisioning configurations..."
cp -r grafana_data/provisioning/dashboards/* grafana_config/provisioning/dashboards/ 2>/dev/null || echo "No dashboard configs to copy"
cp -r grafana_data/provisioning/datasources/* grafana_config/provisioning/datasources/ 2>/dev/null || echo "No datasource configs to copy"
cp -r grafana_data/provisioning/alerting/* grafana_config/provisioning/alerting/ 2>/dev/null || echo "No alerting configs to copy"
cp -r grafana_data/provisioning/plugins/* grafana_config/provisioning/plugins/ 2>/dev/null || echo "No plugin configs to copy"

echo "Migration complete!"
echo "Changes to docker-compose.yml have been made to use the new directory structure."
echo ""
echo "What to commit to git:"
echo "- grafana_config/ directory - contains your dashboards and configurations"
echo "- docker-compose.yml - updated to use the new structure"
echo "- .gitignore - updated to exclude runtime data"
echo ""
echo "To apply these changes:"
echo "1. Stop your containers: docker-compose down"
echo "2. Start with new configuration: docker-compose up -d"
