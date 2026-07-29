# Tech Stack Specification: VirtualNet

VirtualNet is built as a containerized web application using a Python Flask backend, Redis message broker, WebSocket communication, and a lightweight Bootstrap frontend.

---

## 1. Core Technologies

### Frontend (Client)
- **UI Framework**: **Bootstrap 5** (CSS framework for clean, responsive, military-themed interface design).
- **Logic**: **Vanilla JavaScript (ES6+)** (Zero framework overhead, handling real-time DOM updates, WebSocket connection lifecycle, and Web Audio API stream capturing/playback).
- **Audio Capture & Playback**: **Web Audio API & Client-Side DSP Engine**
  - Capture microphone streams using `getUserMedia` and send raw PCM or Opus packet chunks.
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

## 2. CI/CD & Quality Assurance

To ensure code quality and prevent regressions, every git push must trigger a CI runner executing the following steps:

- **Linting**: **pylint** runs on all Python source files. Any syntax or stylistic violations must be resolved.
- **Unit Testing**: **pytest** executes unit, integration, and real-time audio latency benchmarking tests.
- **Coverage**: Code coverage is tracked during pytest runs. The build **must fail** if coverage drops below **90%** (`pytest-cov`).
- **BDD Testing**: **behave** runs the Gherkin feature files (`.feature`) to verify system behavior against end-to-end user scenarios.

---

## 3. Deployment & Containerization

- **Containerization**: The entire application is containerized using **Docker**.
- **Compose**: A `docker-compose.yml` file defines services for local development and staging:
  - `redis`: Redis 7 Alpine message broker and state cache.
  - `web-app`: Flask application serving HTTP and SocketIO.
  - SQLite database is persisted using a Docker volume mount.
