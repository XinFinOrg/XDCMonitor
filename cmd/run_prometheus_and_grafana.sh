#!/bin/bash
# Start just prometheus and grafana
docker-compose -f docker-compose.yml up -d prometheus grafana
echo "Prometheus and Grafana running. Run your application locally now."
