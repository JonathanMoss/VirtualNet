#!/bin/bash
set -e

echo "=========================================="
echo "  1/5: Running Pylint on all Python files"
echo "=========================================="
pylint --fail-under=10.0 app tests

echo "=========================================="
echo "  2/5: Running Pytest with 90% Coverage"
echo "=========================================="
pytest --ignore=tests/test_e2e_browser.py --maxfail=1 --disable-warnings --cov=app --cov-fail-under=90

echo "=========================================="
echo "  3/5: Running Behave BDD Feature Suite"
echo "=========================================="
behave tests/features

echo "=========================================="
echo "  4/5: Running ESLint on JavaScript files"
echo "=========================================="
npm run lint:js

echo "=========================================="
echo "  5/5: Running Node JS Unit Tests"
echo "=========================================="
npm run test:js

echo "=========================================="
echo "  ✅ All Checks Passed Successfully!"
echo "=========================================="
