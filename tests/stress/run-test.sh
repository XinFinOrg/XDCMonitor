#!/bin/bash
# XDC Monitor Stress Test Runner
# 
# Usage: ./run-test.sh [options] [test-category] [test-name]
#
# Options:
#   --mock          Run tests in mock mode (no XDC Monitor instance required)
#   --help          Show this help message
#
# Test Categories:
#   all             Run all tests (default if no category specified)
#   api             Run all API endpoint tests
#   backend         Run all backend processing tests
#   metrics         Run all metrics system tests
#   integration     Run integration tests
#
# Test Names:
#   alerts          Run alerts tests (combine with api or backend)
#   blocks          Run blocks tests (combine with api or backend)
#   consensus       Run consensus tests (combine with api or backend)
#   rpc             Run RPC tests (combine with api or backend)
#   transaction     Run transaction tests (combine with api or backend)
#
# Examples:
#   ./run-test.sh                   # Run all tests in live mode
#   ./run-test.sh --mock            # Run all tests in mock mode
#   ./run-test.sh api               # Run all API tests
#   ./run-test.sh backend blocks    # Run blocks backend tests
#   ./run-test.sh --mock api rpc    # Run RPC API tests in mock mode

# Default values
MOCK_MODE=""
TEST_CATEGORY="all"
TEST_NAME=""

# Parse options
while [[ $# -gt 0 ]]; do
  case $1 in
    --mock)
      MOCK_MODE="-e MOCK_MODE=true"
      shift
      ;;
    --help)
      grep "^#" "$0" | grep -v "!/bin/bash" | sed 's/^# \?//'
      exit 0
      ;;
    all|api|backend|metrics|integration)
      TEST_CATEGORY="$1"
      shift
      ;;
    alerts|blocks|consensus|rpc|transaction)
      TEST_NAME="$1"
      shift
      ;;
    *)
      echo "Unknown option or test name: $1"
      echo "Use --help for usage information"
      exit 1
      ;;
  esac
done

# Create organized results directory structure
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
DATE_DIR=$(date +"%m_%d_%Y")
BASE_RESULTS_DIR="results"
DAY_RESULTS_DIR="${BASE_RESULTS_DIR}/${DATE_DIR}"
OUTPUT_DIR="${DAY_RESULTS_DIR}/results_${TIMESTAMP}"

# tests/stress/results/             # Base results directory
# └── MM_DD_YYYY/                   # Date-based subdirectory (e.g., 05_01_2025)
#     └── results_YYYYMMDD_HHMMSS/  # Timestamp-based

# Create directory structure
mkdir -p "$OUTPUT_DIR"

# Print run configuration
echo "=== XDC Monitor Stress Test Runner ==="
if [ -n "$MOCK_MODE" ]; then
  echo "Mode: MOCK (no live dependencies required)"
else
  echo "Mode: LIVE (requires running XDC Monitor instance)"
fi
echo "Category: $TEST_CATEGORY"
[ -n "$TEST_NAME" ] && echo "Test: $TEST_NAME" || echo "Test: All in category"
echo "Output directory: $OUTPUT_DIR"
echo "-----------------------------------------"

# Helper function to run a test with proper output
run_test() {
  local test_file=$1
  local test_name=$(basename $test_file .js)
  
  echo -e "\n=== Running: $test_name ==="
  k6 run $MOCK_MODE $test_file --out json="$OUTPUT_DIR/${test_name}.json" --summary-export="$OUTPUT_DIR/${test_name}_summary.json"
  
  # Capture exit status
  local status=$?
  if [ $status -ne 0 ]; then
    echo "❌ Test failed: $test_name" >> "$OUTPUT_DIR/failed_tests.txt"
  else
    echo "✅ Test passed: $test_name" >> "$OUTPUT_DIR/passed_tests.txt"
  fi
  
  echo "Completed: $test_name (exit code: $status)"
  echo "-----------------------------------------"
  
  # Brief pause between tests to allow resources to settle
  sleep 2
}

# Function to run tests based on category and name
run_tests_by_category() {
  local category=$1
  local name=$2
  
  case $category in
    api)
      if [ -n "$name" ]; then
        run_test "$name/$(echo $name)-api-stress.js"
      else
        run_test "alerts/alerts-api-stress.js"
        run_test "blocks/blocks-api-stress.js"
        run_test "consensus/consensus-api-stress.js"
        run_test "rpc/rpc-api-stress.js"
        run_test "transaction/transaction-api-stress.js"
      fi
      ;;
      
    backend)
      if [ -n "$name" ]; then
        run_test "$name/$(echo $name)-backend-stress.js"
      else
        run_test "alerts/alerts-backend-stress.js" 
        run_test "blocks/blocks-backend-stress.js"
        run_test "consensus/consensus-backend-stress.js"
        run_test "rpc/rpc-backend-stress.js"
        run_test "transaction/transaction-backend-stress.js"
      fi
      ;;
      
    metrics)
      if [ "$name" == "dashboard" ]; then
        run_test "metrics/dashboard-query-stress.js"
      elif [ "$name" == "influx" ] || [ "$name" == "influxdb" ]; then
        run_test "metrics/influxdb-write-stress.js"
      else
        run_test "metrics/dashboard-query-stress.js"
        run_test "metrics/influxdb-write-stress.js"
      fi
      ;;
      
    integration)
      echo "Integration tests are currently not available."
      ;;
      
    all)
      # Run all API tests
      run_tests_by_category "api" ""
      
      # Run all backend tests
      run_tests_by_category "backend" ""
      
      # Run all metrics tests
      run_tests_by_category "metrics" ""
      
      # Run all integration tests
      run_tests_by_category "integration" ""
      ;;
  esac
}

echo "Starting tests: $(date)"
echo "-----------------------------------------"

# Run tests based on specified category and name
run_tests_by_category "$TEST_CATEGORY" "$TEST_NAME"

# Summarize results
echo "-----------------------------------------"
echo "Test Execution Summary"
echo "-----------------------------------------"
echo "Completed at: $(date)"

if [ -f "$OUTPUT_DIR/failed_tests.txt" ]; then
  echo "Failed tests:"
  cat "$OUTPUT_DIR/failed_tests.txt"
  FAILED_COUNT=$(wc -l < "$OUTPUT_DIR/failed_tests.txt")
else
  FAILED_COUNT=0
  echo "All tests passed! 🎉"
fi

if [ -f "$OUTPUT_DIR/passed_tests.txt" ]; then
  PASSED_COUNT=$(wc -l < "$OUTPUT_DIR/passed_tests.txt")
else
  PASSED_COUNT=0
fi

TOTAL_COUNT=$((FAILED_COUNT + PASSED_COUNT))

echo "Passed: $PASSED_COUNT / $TOTAL_COUNT"
echo "Results directory: $OUTPUT_DIR"
echo "-----------------------------------------"

# Return failure if any tests failed
if [ $FAILED_COUNT -gt 0 ]; then
  exit 1
fi

exit 0
