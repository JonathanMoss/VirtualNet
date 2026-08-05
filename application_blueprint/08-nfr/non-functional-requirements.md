# Non-Functional Requirements: VirtualNet

This document defines the quality attributes, constraints, performance goals, and platform support requirements for the VirtualNet application.

---

## 1. Performance & Latency

- **Voice Latency**:
  - The mouth-to-ear latency (time from microphone capture at the sender to speaker output at the receiver) must be **less than 200 milliseconds** under normal network conditions. High latency breaks Voice Procedure flow (operators talking over each other).
- **Voice Latency**:
  - The mouth-to-ear latency (time from microphone capture at the sender to speaker output at the receiver) must be **less than 200 milliseconds** under normal network conditions. High latency breaks Voice Procedure flow (operators talking over each other).
- **Audio Compression & Mobile DSP**:
  - Voice streaming uses 16-bit Int16 PCM chunk compression and WebAudio hardware resampling to minimize bandwidth (< 32kbps per stream).
  - Mobile Android/Chrome capture integrates hardware DSP processing (`echoCancellation`, `noiseSuppression`, `autoGainControl`) for noise-free transmission in field environments.
- **Resource Footprint**:
  - The client application must run smoothly on low-spec school computers (e.g., dual-core processors, 4GB RAM).
  - CPU usage during streaming must remain under 10% on standard laptops.

---

## 2. Usability & Accessibility

- **Keyboard-Driven Logging**:
  - **Critical Rule**: The radio log interface must be fully navigable and editable using only the keyboard.
  - Operators must be able to:
    - Add a new row via hotkey (e.g., `Ctrl + N` or `Enter`).
    - Navigate cells using `Tab` and `Shift + Tab`.
    - Edit fields directly without double-clicking.
  - This ensures students can keep their eyes on the screen and hands on the keyboard while listening to the radio.
- **Visual & Auditory Cues**:
  - UI colors must clearly distinguish states (Red = Transmitting, Yellow = Channel Busy/Receiving, Green/Gray = Idle).
  - Sound effects (beeps/clicks) for PTT press and release must be crisp, distinctive, and have adjustable volume.

---

## 3. Reliability & Resilience

- **Auto-Reconnection**:
  - If a client experiences a temporary network drop (up to 30 seconds), the client must automatically attempt to reconnect to the server without losing current local log sheets.
- **Data Persistence**:
  - The student's local radio log sheet must auto-save locally (to a cache or temp file) after every character or cell change to prevent loss of work in case of a crash or power failure.

---

## 4. Security & Role Integrity

- **Role Validation**:
  - Standard clients must not be able to forge or execute "NCS Override" messages. The server must validate that any override request comes from a connection verified as the Net Control Station.
- **Channel Partitioning**:
  - The server must isolate nets. Different classes using VirtualNet on the same local network must utilize different ports or Net Passwords to prevent audio bleed-through.

---

## 5. Deployment & Multi-Environment Containerization (Docker)

- **Docker Containerization**:
  - Both the Flask backend and static assets are containerized using a slim Python 3.11 environment (`Dockerfile`) with Node.js support for asset checks.
- **Multi-Environment Compose Configurations**:
  - `docker-compose.yml`: Standard development environment mounting local source directories.
  - `docker-compose.test.yml`: Isolated automated testing container configuration.
  - `docker-compose.preprod.yml`: Staging setup with Nginx reverse proxy.
  - `docker-compose.prod.yml`: Production deployment utilizing `nginxproxy/nginx-proxy` and `nginxproxy/acme-companion` for automated Let's Encrypt SSL/TLS certificate management and renewal.

---

## 6. CI/CD Pipeline & Quality Assurance (5-Stage Runner)

To enforce quality gates, every pull request and push to main must execute the unified check script (`run_checks.sh`) executing five distinct validation stages:

1. **Python Linting (pylint)**: Enforces Python code style (`pylint --fail-under=10.0 app tests`).
2. **Unit & Integration Testing (pytest)**: Executes backend Python test suites with a strict 90% code coverage requirement (`pytest --cov=app --cov-fail-under=90`).
3. **Behavior-Driven Development (behave)**: Runs Gherkin feature tests (`behave tests/features`) verifying scenario behavior.
4. **JavaScript Static Analysis (ESLint)**: Lints client-side JS code (`npm run lint:js`).
5. **JavaScript Unit Testing (Node.js)**: Runs frontend unit test suites (`npm run test:js`).

- **DOM Contract & E2E Verification**:
  - **DOM Contract Testing (`tests/test_dom_contract.py`)**: Validates that Jinja2 component templates maintain required DOM IDs and hook attributes for JS module bindings.
  - **Playwright Headless E2E Browser Testing (`tests/test_e2e_browser.py`)**: Runs headless Chromium browser user journeys validating login, callsign assignment, PTT audio streaming UI, and net teardown.


