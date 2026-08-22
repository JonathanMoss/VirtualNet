# Tech Stack Specification: VirtualNet

VirtualNet is built as a containerized web application using a Python Flask backend, Redis message broker, WebSocket communication, and a lightweight Bootstrap frontend.

---

## 1. Core Technologies

### Frontend (Client)
- **UI Framework**: **Bootstrap 5** & **Jinja2 Card Templates** (Modular component card templates in `static/templates/cards/`).
- **Logic**: **Vanilla JavaScript (ES6+)** (Zero framework overhead, handling real-time DOM updates, WebSocket connection lifecycle, and Web Audio API stream capturing/playback).
- **Static Analysis & Testing**: **ESLint** (`eslint static/js`) and **Node.js Test Runner** (`node --test tests/js/*.test.js`).
- **Audio Capture & Playback**: **Web Audio API & Client-Side DSP Engine**
  - Capture microphone streams using `getUserMedia` with mobile DSP processing (`echoCancellation`, `noiseSuppression`, `autoGainControl`), 16-bit Int16 PCM chunk compression, and WebAudio hardware resampling.
  - Play back incoming streams using `AudioContext` with hardware-accelerated DSP nodes: dual Biquad filters for tactical VHF/UHF radio bandpass (300 Hz – 3400 Hz), `WaveShaperNode` non-linear clipping distortion, static noise generator, and squelch tail effects.


### Backend (Server)
- **Framework**: **Python Flask** (Serves the frontend static files and handles API routing).
- **Real-Time Communication**: **Flask-SocketIO (WebSocket)**
  - Coordinates all bi-directional, real-time message events (PTT request/release, roster updates, logs syncing).
- **Message Queue & Pub/Sub Broker**: **Redis (7-alpine)**
  - Inter-process message queue for Flask-SocketIO pub/sub room broadcasting across multiple worker instances.
  - Fast in-memory state caching for zero-database audio packet routing (< 1ms lookup).
- **Data Validation & Modeling**: **Pydantic (v2)**
  - Validates and enforces schemas for all incoming/outgoing messages, logs, stations, and session configurations.
- **Server Database**: **SQLite** via SQLAlchemy (Lightweight, embedded SQL database to store session configurations, roster logs, and audit records).

---

## 2. CI/CD & Quality Assurance (Unified 5-Stage Runner)

To ensure code quality and prevent regressions, every push and pull request executes `run_checks.sh` running five distinct quality gates:

- **1. Python Static Analysis**: **pylint** runs on all Python source files (`pylint --fail-under=10.0 app tests`).
- **2. Unit & Integration Testing**: **pytest** executes unit/integration tests with a mandatory 90% coverage target (`pytest --cov=app --cov-fail-under=90`).
- **3. BDD Scenario Verification**: **behave** runs Cucumber-style Gherkin feature scenarios (`behave tests/features`).
- **4. JavaScript Linting**: **ESLint** runs static analysis on JavaScript modules (`npm run lint:js`).
- **5. JavaScript Unit Testing**: **Node.js** runs JS unit tests (`npm run test:js`).
- **DOM & E2E Testing**:
  - **DOM Contract Tests**: `tests/test_dom_contract.py` ensures Jinja2 card templates render required DOM IDs and attributes.
  - **Playwright Headless E2E Browser Tests**: `tests/test_e2e_browser.py` verifies full end-to-end browser journeys.

---

## 3. Deployment & Multi-Environment Containerization

- **Containerization**: The application is containerized using Docker (`Dockerfile`) with Python 3.11-slim and Node.js toolchains.
- **Multi-Environment Compose Setup**:
  - `docker-compose.yml`: Development composition mounting live source volumes.
  - `docker-compose.test.yml`: Testing environment composition.
  - `docker-compose.preprod.yml`: Pre-production staging configuration with Nginx reverse proxy.
  - `docker-compose.prod.yml`: Production configuration targeting `virtualnet.uk` (`https://virtualnet.uk`) deploying `nginxproxy/nginx-proxy` and `nginxproxy/acme-companion` for zero-downtime automated Let's Encrypt TLS certificate generation and renewal.

---

## 4. Production Security Hardening & Container Probes

- **Domain-Restricted CORS (`CORS_ALLOWED_ORIGINS`)**:
  - Socket.IO origin validation enforces domain restrictions via `CORS_ALLOWED_ORIGINS=https://virtualnet.uk,https://www.virtualnet.uk`.
- **HTTP Security Headers**:
  - All HTTP responses carry `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Permissions-Policy: microphone=(self)`, `Referrer-Policy: strict-origin-when-cross-origin`, and `HSTS` in production HTTPS.
- **Session Cookie Security**:
  - Configures `SESSION_COOKIE_HTTPONLY=True`, `SESSION_COOKIE_SAMESITE='Lax'`, and `SESSION_COOKIE_SECURE=True` in production.
- **Container Health Check Probe (`/healthz`)**:
  - GET `/healthz` HTTP endpoint returns `200 OK {"status": "ok", "database": "connected"}` for Kubernetes/Docker liveness and readiness container health probes.

