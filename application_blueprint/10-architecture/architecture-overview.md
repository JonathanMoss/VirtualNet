# Architecture Overview: VirtualNet

This document describes the high-level architecture, module design, and communication flow of the VirtualNet client/server application.

---

## 1. High-Level Block Diagram

```
           ┌──────────────────────────────────────────────┐
           │             PYTHON FLASK SERVER              │
           │                                              │
           │  ┌───────────────┐      ┌─────────────────┐  │
  ┌───────►│  │ SocketIO      │      │ Pydantic        │  │
  │        │  │ Event Router  │      │ Validation      │  │
  │        │  └───────┬───────┘      └────────┬────────┘  │
  │        │          │                       │           │
  │        │          ▼                       ▼           │
  │        │  ┌───────────────┐      ┌─────────────────┐  │
  │        │  │ Service Layer │      │ SQLAlchemy      │  │
  │        │  │ (app/services)│      │ DB Engine       │  │
  │        │  └───────┬───────┘      └────────┬────────┘  │
  │        └──────────┼───────────────────────┼───────────┘
  │ SocketIO          │ Binary Audio          │ JSON Logs
  │ (WS / HTTP)       │ Over Sockets          │
  │                   │ (Zero-DB Fast Path)   │
  │                   ▼                       ▼
  │        ┌───────────────────┐              │
  │        │   REDIS 7 PUB/SUB │              │
  │        │   MESSAGE BROKER  │              │
  │        └──────────┬────────┘              │
  │                   │                       │
  ▼                   ▼                       ▼
┌────────────────────────────────────────────────────────┐
│               BOOTSTRAP / VANILLA JS CLIENT            │
│                                                        │
│   ┌─────────────────┐            ┌─────────────────┐   │
│   │ SocketIO.js     │            │ Bootstrap 5 UI  │   │
│   │ Connection      │            │ (Roster, Logs,  │   │
│   └────────┬────────┘            │  PTT States)    │   │
│            ▼                     └────────┬────────┘   │
│   ┌─────────────────┐                     │            │
│   │ Web Audio Engine│            ┌────────▼────────┐   │
│   │ (Mic Capture)   │◄───────────┤ LocalStorage    │   │
│   └─────────────────┘            │ Cache           │   │
│                                  └─────────────────┘   │
└────────────────────────────────────────────────────────┘
```

---

## 2. Server Architecture Modules (Python/Flask & Redis)

The server runs as a Flask web application utilizing a thin WebSocket event router, a modular Service Layer (`app/services/`), and Redis for multi-worker Pub/Sub distribution.

### SocketIO Event Router (`sockets.py`)
- Listens for WebSocket-based connection events using `Flask-SocketIO`.
- Dispatches incoming requests (`join_net`, `ptt_request`, `sync_log_entry`, etc.) directly to single-responsibility modules in the Service Layer.

### Service Layer (`app/services/`)
Separates domain logic from WebSocket routing and request parsing:
- **`pin_service.py`**: Manages daily instructor 6-digit PIN validation.
- **`station_service.py`**: Manages station registrations, active socket registry (`StationSocketRegistry`), roster assembly, and 30-second disconnect grace periods.
- **`transmission_service.py`**: Manages PTT lock acquisition, NCS CONTROL break-in override, transmission state transitions, and zero-DB audio routing fast paths.
- **`log_service.py`**: Handles radio log sheet entry synchronization and enforces log entry finality/immutability constraints.
- **`session_service.py`**: Handles net session creation, unique 4-character PIN generation, and session termination with ephemeral data purging.

### Pydantic Data Validation Layer (`schemas.py`)
- Enforces runtime typing and validation schemas on all JSON communication payloads.
- Converts raw incoming dictionary payloads into validated Python models (e.g., `NetSessionCreate`, `LogEntryCreate`).
- Raises automatic serialization errors for invalid or malformed data packets.

### Zero-DB Audio Router (`transmission_service.py`)
- Receives binary WebSocket packets containing compressed microphone chunks from the active speaker.
- Uses an in-memory/Redis $O(1)$ fast-path table (`transmitting_sids`) to verify transmission permission without executing database queries during live streaming.
- Re-broadcasts binary audio buffers directly to room subscribers with sub-15ms latency.

### SQLAlchemy Database Engine (`database.py` & `models.py`)
- Manages the SQLite database schema mapping (`models.py`).
- Persists user roster history, log entries, and session details between runs.

---

## 3. Client Architecture Modules (Vanilla JS & Bootstrap)

The client runs as an interactive web page loaded in standard modern web browsers.

### SocketIO.js Client
- Establishes and maintains the persistent WebSocket link to the Flask server.
- Automatically handles ping/pong keepalives, transport upgrades, and reconnects.

### Bootstrap 5 UI / View Layer
- Renders the responsive dashboard layout:
  - **PTT Display**: Status card indicating station states (`Idle` [gray], `Transmitting` [red], `Receiving` [yellow]).
  - **Interactive Log sheet**: HTML table styled with Bootstrap classes. Enabled with custom tab-index navigation and event listeners to ensure fast, mouse-free input.
  - **Roster Panel**: Visual status badge for each online user.

### Web Audio Engine
- **Mic Capture**: Calls `navigator.mediaDevices.getUserMedia` to receive microphone streams, captures audio frames via an `AudioWorklet` or Script Node, and sends raw data through SocketIO.
- **Playback**: Feeds incoming WebSocket audio buffers into dynamic player nodes in the browser's `AudioContext`.

### LocalStorage Cache
- Automatically saves unsubmitted or draft log sheets locally in the browser to prevent data loss in case of page reload or disconnection.
