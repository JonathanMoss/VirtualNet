#!/bin/bash

# Root folder
ROOT_DIR="."

mkdir -p "$ROOT_DIR"
cd "$ROOT_DIR" || exit

echo "Creating folder structure..."

# 1. Product Vision
mkdir -p "01-product-vision"
touch "01-product-vision/vision.md"

# 2. Features
mkdir -p "02-features"
touch "02-features/features-overview.md"

# 3. Roles
mkdir -p "03-roles"
touch "03-roles/roles.md"

# 4. Scenarios (BDD)
mkdir -p "04-scenarios"
touch "04-scenarios/core-scenarios.feature"

# 5. Domain Model
mkdir -p "05-domain-model"
touch "05-domain-model/entities.md"
touch "05-domain-model/relationships.md"

# 6. Rules & Constraints
mkdir -p "06-rules"
touch "06-rules/business-rules.md"

# 7. State Transitions
mkdir -p "07-states"
touch "07-states/lifecycle.md"
touch "07-states/state-diagram.puml"

# 8. Non-Functional Requirements
mkdir -p "08-nfr"
touch "08-nfr/non-functional-requirements.md"

# 9. API / Integration
mkdir -p "09-api"
touch "09-api/api-spec.md"
touch "09-api/events.md"

# 10. Architecture / Technical
mkdir -p "10-architecture"
touch "10-architecture/architecture-overview.md"
touch "10-architecture/tech-stack.md"

echo "✅ Structure created in $ROOT_DIR"
