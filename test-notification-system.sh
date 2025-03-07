#!/bin/bash

# Colors for better readability
GREEN="\033[0;32m"
YELLOW="\033[1;33m"
BLUE="\033[0;34m"
RED="\033[0;31m"
NC="\033[0m" # No Color

echo -e "${BLUE}=====================================${NC}"
echo -e "${BLUE}    XDC Monitor Notification Tester   ${NC}"
echo -e "${BLUE}=====================================${NC}"

# Function to check if the application is running
check_service() {
  local service=$1
  local port=$2
  echo -e "\n${YELLOW}Checking if $service is running...${NC}"

  if curl -s "http://localhost:$port" > /dev/null; then
    echo -e "${GREEN}✓ $service is running on port $port${NC}"
    return 0
  else
    echo -e "${RED}✗ $service does not appear to be running on port $port${NC}"
    return 1
  fi
}

# Function to test direct API endpoint
test_direct_api() {
  echo -e "\n${YELLOW}Testing direct API endpoint...${NC}"

  response=$(curl -s -X GET "http://localhost:3000/api/notifications/test?title=API%20Test&message=Testing%20from%20script&severity=warning")

  if [[ $response == *"success\":true"* ]]; then
    echo -e "${GREEN}✓ API test endpoint responded successfully${NC}"
    echo -e "Response: $response"
    return 0
  else
    echo -e "${RED}✗ API test endpoint failed${NC}"
    echo -e "Response: $response"
    return 1
  fi
}

# Function to test Grafana webhook
test_grafana_webhook() {
  echo -e "\n${YELLOW}Testing Grafana webhook simulation...${NC}"

  response=$(curl -s -X POST http://localhost:3000/api/notifications/telegram \
    -H "Content-Type: application/json" \
    -d '{
      "status": "firing",
      "labels": {
        "alertname": "Webhook Test Alert",
        "severity": "critical",
        "instance": "test-instance"
      },
      "annotations": {
        "summary": "Webhook Test Notification",
        "description": "This is a test message simulating Grafana calling the webhook."
      }
    }')

  if [[ $response == *"success\":true"* ]]; then
    echo -e "${GREEN}✓ Grafana webhook simulation was successful${NC}"
    echo -e "Response: $response"
    return 0
  else
    echo -e "${RED}✗ Grafana webhook simulation failed${NC}"
    echo -e "Response: $response"
    return 1
  fi
}

# Function to check environment variables
check_env_vars() {
  echo -e "\n${YELLOW}Checking environment variables...${NC}"

  # Load environment variables
  if [ -f .env ]; then
    source .env
  fi

  # Check if Telegram variables are set
  if [ -n "$TELEGRAM_BOT_TOKEN" ] && [ -n "$TELEGRAM_CHAT_ID" ]; then
    echo -e "${GREEN}✓ Telegram environment variables are set${NC}"
    return 0
  else
    echo -e "${RED}✗ Telegram environment variables are not set${NC}"
    echo -e "Please check your .env file and ensure TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID are set"
    return 1
  fi
}

# Main test sequence
echo -e "\n${BLUE}Starting tests...${NC}"

# Check environment variables first
check_env_vars
env_status=$?

# Check if services are running
check_service "NestJS Backend" 3000
backend_status=$?

check_service "Grafana" 3001
grafana_status=$?

# If backend is running, test the endpoints
if [ $backend_status -eq 0 ]; then
  test_direct_api
  api_status=$?

  test_grafana_webhook
  webhook_status=$?
else
  echo -e "${RED}Skipping API tests as backend is not running${NC}"
  api_status=2
  webhook_status=2
fi

# Summary
echo -e "\n${BLUE}=====================================${NC}"
echo -e "${BLUE}            Test Summary              ${NC}"
echo -e "${BLUE}=====================================${NC}"

if [ $env_status -eq 0 ]; then
  echo -e "${GREEN}✓ Environment variables:${NC} Properly configured"
else
  echo -e "${RED}✗ Environment variables:${NC} Not properly configured"
fi

if [ $backend_status -eq 0 ]; then
  echo -e "${GREEN}✓ NestJS Backend:${NC} Running"
else
  echo -e "${RED}✗ NestJS Backend:${NC} Not running"
fi

if [ $grafana_status -eq 0 ]; then
  echo -e "${GREEN}✓ Grafana:${NC} Running"
else
  echo -e "${RED}✗ Grafana:${NC} Not running"
fi

if [ $api_status -eq 0 ]; then
  echo -e "${GREEN}✓ Direct API test:${NC} Successful"
elif [ $api_status -eq 2 ]; then
  echo -e "${YELLOW}! Direct API test:${NC} Skipped"
else
  echo -e "${RED}✗ Direct API test:${NC} Failed"
fi

if [ $webhook_status -eq 0 ]; then
  echo -e "${GREEN}✓ Webhook simulation:${NC} Successful"
elif [ $webhook_status -eq 2 ]; then
  echo -e "${YELLOW}! Webhook simulation:${NC} Skipped"
else
  echo -e "${RED}✗ Webhook simulation:${NC} Failed"
fi

echo -e "\n${BLUE}Next steps:${NC}"
echo -e "1. Check your Telegram for test messages"
echo -e "2. If no messages received, check logs with: docker-compose logs -f xdc-monitor"
echo -e "3. To test the Grafana alerts, go to Grafana > Alerting > Alert rules > Manual Test Alert"

exit 0
