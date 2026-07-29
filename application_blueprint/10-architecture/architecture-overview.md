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
  │        │  │ Event Manager │      │ Model Layer     │  │
  │        │  └───────┬───────┘      └────────┬────────┘  │
  │        │          │                       │           │
  │        │          ▼                       ▼           │
  │        │  ┌───────────────┐      ┌─────────────────┐  │
  │        │  │ Zero-DB Audio │      │ SQLAlchemy      │  │
  │        │  │ Fast Router   │      │ DB Engine       │  │
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

The server runs as a Flask web application, utilizing event handlers for real-time traffic and Redis for multi-worker Pub/Sub distribution.

### SocketIO Event Manager & Redis Adapter
- Listens for WebSocket-based connection events using `Flask-SocketIO`.
- Connects to `Redis 7` as a message queue to enable horizontally scalable Pub/Sub room broadcasting.
- Dispatches incoming requests (e.g., `join_net`, `ptt_request`, `sync_log_entry`) to relevant controllers.

### Pydantic Data Validation Layer
- Enforces runtime typing and validation schemas on all JSON communication payloads.
- Converts raw incoming dictionary payloads into validated Python models (e.g., `StationModel`, `LogEntryModel`).
- Raises automatic serialization errors for invalid or malformed data packets.

### Zero-DB Audio Router
- Receives binary WebSocket packets containing compressed microphone chunks from the active speaker.
- Uses an in-memory/Redis $O(1)$ fast-path table (`transmitting_sids`) to verify transmission permission without executing database queries during live streaming.
- Re-broadcasts binary audio buffers directly to room subscribers with sub-15ms latency.

### SQLAlchemy Database Engine
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
