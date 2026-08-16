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

### Modular Jinja2 Card Component View Layer (`static/templates/cards/`)
- Renders the responsive dashboard layout through componentized Jinja2 card templates (`header_card.html`, `join_net_card.html`, `create_net_card.html`, `transceiver_card.html`, `roster_card.html`, `sunray_card.html`, `df_alert_banner.html`, `resources_card.html`).
- **DOM Contract Integrity**: `tests/test_dom_contract.py` guarantees element ID contracts (`#btn-join-net`, `#join-pin`, etc.) are strictly maintained.

### Web Audio Engine & Mobile DSP Processing (`static/js/audio.js`)
- **Mic Capture & DSP**: Calls `navigator.mediaDevices.getUserMedia` with mobile DSP constraints (`echoCancellation`, `noiseSuppression`, `autoGainControl`) and Int16 PCM audio chunk compression with WebAudio hardware resampling.
- **Playback**: Feeds incoming WebSocket audio buffers into dynamic player nodes in the browser's `AudioContext`.

### Real-Time Audio Telemetry HUD (`static/js/telemetry.js`)
- **Dual LED VU Meter**: Uses WebAudio `AnalyserNode` connected to mic input (TX) and speaker output (RX) to drive a 10-segment phosphor green/amber/red LED VU meter.
- **Phosphor CRT Sparkline Canvas**: Renders real-time chunk spikes, server ACKs (`audio_ack`), and chunk playback status. On receiving clients, chunks are displayed as **Yellow/Amber** upon arrival and turn **Phosphor Green** when WebAudio `AudioBufferSourceNode.onended` physically finishes playing the chunk out the speaker.
- **Mobile AudioContext Guard**: Detects suspended/interrupted WebAudio states during incoming traffic and renders a glowing banner (`🔊 TAP TO UNMUTE AUDIO`) with tap listeners to unlock mobile audio output.

### SessionStorage Cache
- Persists active net session credentials (PIN, station ID, callsign, role) to support automatic socket re-binding upon page refresh or tab focus.

---

## 4. Multi-Environment Deployment Architecture

VirtualNet supports multi-environment container orchestration via Docker Compose:

```
                  ┌────────────────────────────────────────────────────────┐
                  │                 INTERNET / CLIENTS                     │
                  └───────────────────────────┬────────────────────────────┘
                                              │ HTTPS / WSS
                                              ▼
                  ┌────────────────────────────────────────────────────────┐
                  │                NGINX PROXY CONTAINER                   │
                  │             (nginxproxy/nginx-proxy)                   │
                  └─────────────┬──────────────────────────┬───────────────┘
                                │                          │
          Auto TLS Renewal      │                          │ Reverse Proxy
         ┌──────────────────────┴┐                         │ (Port 5000)
         │ ACME COMPANION        │                         ▼
         │ (nginxproxy/          │               ┌───────────────────┐
         │  acme-companion)      │               │ FLASK WEB-APP     │
         └───────────────────────┘               │ (gunicorn/eventlet│
                                                 └─────────┬─────────┘
                                                           │
                                                           ▼
                                                 ┌───────────────────┐
                                                 │ REDIS 7 BROKER    │
                                                 └───────────────────┘
```

- **Staging / Pre-Prod (`docker-compose.preprod.yml`)**: Nginx reverse proxy routing to Flask backend.
- **Production (`docker-compose.prod.yml`)**: Fully automated reverse proxy setup with `acme-companion` monitoring container state for zero-touch SSL certificate provisioning and renewal.

