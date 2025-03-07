#!/bin/bash

# Test the notification endpoint with a sample Grafana alert payload
curl -X POST http://localhost:3000/api/notifications/telegram \
  -H "Content-Type: application/json" \
  -d '{
    "status": "firing",
    "labels": {
      "alertname": "Test Alert",
      "severity": "critical",
      "instance": "test-instance"
    },
    "annotations": {
      "summary": "Test Notification",
      "description": "This is a test message to verify Telegram notifications are working correctly."
    }
  }'

echo -e "\nTest notification sent. Check your Telegram for a message."
