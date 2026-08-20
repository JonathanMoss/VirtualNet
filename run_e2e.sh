#!/bin/bash
# run_e2e.sh — Run containerized E2E test suite, log output to data/, and tear down all containers on completion.

set -e

mkdir -p data

LOG_FILE="data/e2e_results.log"
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

echo "==========================================" | tee -a "$LOG_FILE"
echo "  VirtualNet E2E Test Suite Run: $TIMESTAMP" | tee -a "$LOG_FILE"
echo "==========================================" | tee -a "$LOG_FILE"

# Cleanup handler to guarantee teardown of ALL containers & fix data/ permissions on exit
cleanup() {
    EXIT_CODE=$?
    echo "==========================================" | tee -a "$LOG_FILE"
    echo "  Tearing down all E2E Docker containers..." | tee -a "$LOG_FILE"
    echo "==========================================" | tee -a "$LOG_FILE"
    docker compose -f docker-compose.e2e.yml down --remove-orphans -v 2>&1 | tee -a "$LOG_FILE" || true
    docker run --rm -v "$(pwd)/data:/app/data" alpine chmod -R 777 /app/data 2>/dev/null || true
    echo "  ✅ Container teardown complete." | tee -a "$LOG_FILE"
    echo "  📄 Full test logs saved to:" | tee -a "$LOG_FILE"
    echo "     - $LOG_FILE" | tee -a "$LOG_FILE"
    echo "     - data/e2e_test_report.log" | tee -a "$LOG_FILE"
    exit $EXIT_CODE
}
trap cleanup EXIT

# Build and run E2E container suite
docker compose -f docker-compose.e2e.yml up --build --exit-code-from e2e-test 2>&1 | tee -a "$LOG_FILE"
