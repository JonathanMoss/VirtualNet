# VirtualNet 📟

VirtualNet is a Client/Server web application designed to provide military, emergency response, and search & rescue students and instructors with a simulated environment to practice Communication and Information Systems (CIS) and Voice Procedure (VP) rules without physical radio equipment.

---

## 📋 Table of Contents

- [Overview](#overview)
- [Tech Stack](#tech-stack)
- [Environments & Docker Setup](#environments--docker-setup)
- [Development Pipelines & Quality Gates](#development-pipelines--quality-gates)
- [Git Hooks Configuration](#git-hooks-configuration)
- [Developer Workflows & Commands](#developer-workflows--commands)
- [Application Blueprint Documentation](#application-blueprint-documentation)

---

## 🎯 Overview

VirtualNet simulates a multi-station VHF/UHF tactical radio net over standard IP networks (local Wi-Fi or Internet):
- **Half-Duplex Transceiver**: Single speaker per frequency with PTT keying, start chirps, squelch tails, and Enemy Direction Finding (DF) alerts for > 20s transmissions.
- **SUNRAY Net Control Dashboard**: Admission queue, dynamic callsign assignment, break-in discipline override, station muting/kicking, and 60-minute inactivity timeouts.
- **Connection Resilience**: 30-second client heartbeat pings and automatic socket re-binding (`rejoin_net`) on reconnection or tab focus to prevent background tab disconnection errors ("TRANSMISSION BLOCKED").
- **Aide Memoire Drawer**: Side-sliding panel with military logging shorthand, interactive SVG BATCO cipher slider, vocabulary cards (OPS, FIRE SP, LOG, etc.), tactical report slates (CFF, CONTACT, MEDEVAC, SITREP), and log guidelines.
- **Tactical CRT Design System**: Accessible night-ops theme with custom CRT alert/confirm/prompt modals.

---

## 🛠️ Tech Stack

- **Backend**: Python 3.11+, Flask 3.0, Flask-SocketIO 5.3, Pydantic v2, SQLAlchemy 2.0, Eventlet / Gunicorn.
- **Database & Cache**: SQLite embedded database, Redis 7 (Pub/Sub message broker & fast-path audio packet routing).
- **Frontend**: Vanilla JavaScript (ES6+), Bootstrap 5, Modular Jinja2 card component templates (`static/templates/cards/`).
- **Audio Engine**: Web Audio API with Int16 PCM chunk compression, hardware resampling, and mobile DSP audio processing (`echoCancellation`, `noiseSuppression`, `autoGainControl`).
- **Testing & Quality Assurance**: Pytest, Pytest-Cov (>= 90% coverage threshold), Behave (BDD Gherkin feature runner), Pylint (>= 10.0/10 rating), ESLint, Node.js Test Runner, and Playwright Headless E2E Browser Testing.

---

## 🐳 Environments & Docker Setup

VirtualNet supports multi-environment container orchestration using Docker Compose configurations:

| Environment | Compose File | Description | Ports / Proxy |
| :--- | :--- | :--- | :--- |
| **Development** | `docker-compose.yml` | Local development environment with mounted source volumes (`./app`, `./static`, `./data`). | App: `5002` -> `5000`<br>Nginx: `80`, `443` |
| **Testing** | `docker-compose.test.yml` | Isolated test container runner executing `./run_checks.sh` with a dedicated Redis instance. | Internal container network |
| **Pre-Production** | `docker-compose.preprod.yml` | Staging environment with Nginx reverse proxy. | `80`, `443` |
| **Production** | `docker-compose.prod.yml` | Multi-container production deployment with `nginxproxy/nginx-proxy` and `nginxproxy/acme-companion` for zero-touch Let's Encrypt SSL/TLS auto-renewal. | `80`, `443` (TLS) |

### Docker Commands

```bash
# 1. Start local development environment
docker compose up -d

# 2. View development container logs
docker compose logs -f web-app

# 3. Stop local development environment
docker compose down

# 4. Run full test battery in isolated container
docker compose -f docker-compose.test.yml run --rm test

# 5. Launch pre-production / staging environment
docker compose -f docker-compose.preprod.yml up -d

# 6. Launch production environment with TLS auto-renewal
docker compose -f docker-compose.prod.yml up -d
```

---

## 🧪 Development Pipelines & Quality Gates

All contributions must pass a 5-stage quality pipeline defined in [`run_checks.sh`](file:///home/jmoss2/VirtualNet/run_checks.sh):

```
┌────────────────────────────────────────────────────────────────────────┐
## 5-Stage Check Runner (run_checks.sh)                                  │
├────────────────────────────────────────────────────────────────────────┤
│ Stage 1: Pylint Python Static Analysis    (--fail-under=10.0)          │
│ Stage 2: Pytest Unit & Integration Tests  (--cov-fail-under=90)        │
│ Stage 3: Behave BDD Feature Suite         (behave tests/features)      │
│ Stage 4: ESLint JavaScript Analysis       (npm run lint:js)            │
│ Stage 5: Node.js JavaScript Unit Tests    (npm run test:js)            │
└────────────────────────────────────────────────────────────────────────┘
```

### Additional Test Suites
- **DOM Contract Tests** (`tests/test_dom_contract.py`): Parses Jinja2 card templates to guarantee required element IDs (`#btn-join-net`, `#join-pin`, etc.) are maintained for JS/CSS hooks.
- **Playwright E2E Browser Tests** (`tests/test_e2e_browser.py`): Executes headless Chromium user journeys testing station join, callsign assignment, PTT audio streaming, tab reconnection, and session teardown.

---

## ⚓ Git Hooks Configuration

VirtualNet uses a custom Git hooks directory located in `.githooks/` to ensure no code is committed without passing all quality gates.

### Pre-Commit Hook (`.githooks/pre-commit`)
Whenever `git commit` is executed, the pre-commit hook automatically runs the full 5-stage test battery in an isolated Docker container:

```bash
#!/bin/bash
set -e

echo "🔍 Running pre-commit test battery in Docker container..."
docker compose -f docker-compose.test.yml run --rm test
```

### Enabling Git Hooks
If setting up a fresh clone of the repository, enable the custom Git hooks directory:

```bash
git config core.hooksPath .githooks
```

---

## 💻 Developer Workflows & Commands

### Initial Setup

```bash
# 1. Clone repository
git clone https://github.com/JonathanMoss/VirtualNet.git
cd VirtualNet

# 2. Copy environment file template
cp .env.example .env

# 3. Configure Git hooks
git config core.hooksPath .githooks

# 4. Install local dependencies (for local linting/editor support)
pip install -r requirements.txt
npm install
```

### Running Tests Locally

```bash
# Execute the full 5-stage check pipeline locally
./run_checks.sh

# Run pytest unit tests directly
pytest --ignore=tests/test_e2e_browser.py --cov=app --cov-fail-under=90

# Run Behave BDD feature tests
behave tests/features

# Run Playwright E2E browser tests
pytest tests/test_e2e_browser.py

# Run JavaScript linting
npm run lint:js

# Run JavaScript unit tests
npm run test:js
```

---

## 📚 Application Blueprint Documentation

Detailed architectural and functional specifications are maintained in the [`application_blueprint/`](file:///home/jmoss2/VirtualNet/application_blueprint) directory:

- [`01-product-vision/vision.md`](file:///home/jmoss2/VirtualNet/application_blueprint/01-product-vision/vision.md): Product vision & operational concept.
- [`02-features/features-overview.md`](file:///home/jmoss2/VirtualNet/application_blueprint/02-features/features-overview.md): Core functional requirements and features overview.
- [`02-features/ui-layout-spec.md`](file:///home/jmoss2/VirtualNet/application_blueprint/02-features/ui-layout-spec.md): Bootstrap 5 grid hierarchy and Jinja2 card component templates.
- [`03-roles/roles.md`](file:///home/jmoss2/VirtualNet/application_blueprint/03-roles/roles.md): User roles, responsibilities, and permissions.
- [`04-scenarios/core-scenarios.feature`](file:///home/jmoss2/VirtualNet/application_blueprint/04-scenarios/core-scenarios.feature): Gherkin feature scenarios.
- [`05-domain-model/entities.md`](file:///home/jmoss2/VirtualNet/application_blueprint/05-domain-model/entities.md): Database schemas and Pydantic validation models.
- [`05-domain-model/relationships.md`](file:///home/jmoss2/VirtualNet/application_blueprint/05-domain-model/relationships.md): Entity relationship diagram and rules.
- [`06-rules/business-rules.md`](file:///home/jmoss2/VirtualNet/application_blueprint/06-rules/business-rules.md): Business rules, callsign structure, and prowords.
- [`07-states/lifecycle.md`](file:///home/jmoss2/VirtualNet/application_blueprint/07-states/lifecycle.md): Net Session, Station, and Transmission lifecycles.
- [`08-nfr/non-functional-requirements.md`](file:///home/jmoss2/VirtualNet/application_blueprint/08-nfr/non-functional-requirements.md): NFRs, performance, security, and quality gates.
- [`09-api/api-spec.md`](file:///home/jmoss2/VirtualNet/application_blueprint/09-api/api-spec.md): WebSocket API protocol and event payloads.
- [`09-api/events.md`](file:///home/jmoss2/VirtualNet/application_blueprint/09-api/events.md): System pub/sub domain events specification.
- [`10-architecture/architecture-overview.md`](file:///home/jmoss2/VirtualNet/application_blueprint/10-architecture/architecture-overview.md): High-level system architecture and module design.
- [`10-architecture/tech-stack.md`](file:///home/jmoss2/VirtualNet/application_blueprint/10-architecture/tech-stack.md): Core technology stack specification.
