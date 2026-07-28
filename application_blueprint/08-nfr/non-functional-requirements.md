# Non-Functional Requirements: VirtualNet

This document defines the quality attributes, constraints, performance goals, and platform support requirements for the VirtualNet application.

---

## 1. Performance & Latency

- **Voice Latency**:
  - The mouth-to-ear latency (time from microphone capture at the sender to speaker output at the receiver) must be **less than 200 milliseconds** under normal network conditions. High latency breaks Voice Procedure flow (operators talking over each other).
- **Audio Compression & Bandwidth**:
  - The application must use an efficient audio compression codec (e.g., Opus or Speex) to minimize bandwidth.
  - Recommended audio bandwidth per stream should not exceed **32kbps**, allowing the server to handle 20+ active stations easily on basic school Wi-Fi or local area networks.
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

## 5. Deployment & Containerization (Docker)

- **Docker Containerization**:
  - Both the Flask backend and the static client files must be built, configured, and run within a **Docker container**.
  - Standard multi-stage builds must be used in the `Dockerfile` to keep production images compact.
  - A `docker-compose.yml` file must be provided to run the web application and mount persistent storage for SQLite.

---

## 6. CI/CD Pipeline & Quality Assurance

To enforce quality gates, every push to the remote Git repository must execute a CI pipeline (e.g., GitHub Actions or GitLab CI) with the following stages:

- **Static Analysis (pylint)**:
  - Runs `pylint` on all Python files. Coding style must match guidelines and contain no critical syntax or lint errors.
- **Behavior-Driven Development (behave)**:
  - Runs Cucumber-style functional tests via `behave` to verify all `.feature` scenarios (e.g. channel lock blocks, overrides, roster syncs) on the running application codebase.
- **Unit and Integration Tests (pytest)**:
  - Runs `pytest` on all Python files.
- **Code Coverage Target (>= 90%)**:
  - Code coverage must be checked during the pytest execution using `pytest-cov`.
  - **Constraint**: The pipeline build must fail if pytest test coverage is below **90%**.

