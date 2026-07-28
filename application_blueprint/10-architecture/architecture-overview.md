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
  │        │  │ Audio Router  │      │ SQLAlchemy      │  │
  │        │  │ (WebSocket)   │      │ DB Engine       │  │
  │        │  └───────┬───────┘      └────────┬────────┘  │
  │        └──────────┼───────────────────────┼───────────┘
  │ SocketIO          │ Binary Audio          │ JSON Logs
  │ (WS / HTTP)       │ Over Sockets          │
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

## 2. Server Architecture Modules (Python/Flask)

The server runs as a Flask web application, utilizing event handlers for real-time traffic.

### SocketIO Event Manager
- Listens for WebSocket-based connection events using `Flask-SocketIO`.
- Dispatches incoming requests (e.g., `join_net`, `ptt_request`, `sync_log_entry`) to relevant controllers.
- Manages client namespaces and group broadcasting.

### Pydantic Data Validation Layer
- Enforces runtime typing and validation schemas on all JSON communication payloads.
- Converts raw incoming dictionary payloads into validated Python models (e.g., `StationModel`, `LogEntryModel`).
- Raises automatic serialization errors for invalid or malformed data packets.

### Audio Router
- Receives binary WebSocket packets containing compressed microphone chunks from the active speaker.
- Re-broadcasts the raw binary buffers directly to all other clients connected in the session.
- Handles audio stream state logging.

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

