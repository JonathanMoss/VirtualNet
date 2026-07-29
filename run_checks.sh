#!/bin/bash
set -e

echo "=========================================="
echo "  1/3: Running Pylint on all Python files"
echo "=========================================="
pylint --fail-under=10.0 app tests

echo "=========================================="
echo "  2/3: Running Pytest with 90% Coverage"
echo "=========================================="
pytest --maxfail=1 --disable-warnings --cov=app --cov-fail-under=90

echo "=========================================="
echo "  3/3: Running Behave BDD Feature Suite"
echo "=========================================="
behave tests/features

echo "=========================================="
echo "  ✅ All Checks Passed Successfully!"
echo "=========================================="
