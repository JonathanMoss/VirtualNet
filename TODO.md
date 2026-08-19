# VirtualNet — TODO List (Tasks for Tomorrow)

## 📋 Resolved Tonight (Verified & Pushed to Remote)
- [x] **Socket.IO `handleCreateResponse` Fix**: Resolved missing handler exception on session creation.
- [x] **Fold / Expand UI Controls Fix**: Restored fold/expand toggles and icon indicators across Roster, Sunray panel, PTT card, and Header details.
- [x] **Awaiting Callsign Assignment Queue Fix**: Restored student entry rendering in assignment queue when panel is minimized.
- [x] **PTT Keying & Spacebar Page Scroll Prevention**: Fixed spacebar <kbd>Space</kbd> keying so it no longer scrolls the page (`e.preventDefault()`).
- [x] **Sunray Controller `handleSunrayTxLog` Fix**: Resolved missing method error on Sunray TX log updates.
- [x] **Playwright Headless E2E Test Suite Container**: Created standalone `docker-compose.e2e.yml` and `tests/test_e2e_full_suite.py` covering all 6 core workflows and regressions.

---

## 🎯 High-Priority Tasks & Testing for Tomorrow

### 1. Callsign Management & UI Issues
- [ ] **Change Callsign Functionality**: Investigate and fix "Change Callsign" feature not updating or re-assigning callsigns mid-session.

### 2. Live Microphone & Real Audio Quality Testing
- [ ] **Physical Microphone Test**: Conduct manual voice tests across multiple physical devices (Desktop, Mobile/Tablet) to verify clear PCM audio playback.
- [ ] **Audio Quality & VU Level Tuning**: Validate WebAudio DSP noise suppression, echo cancellation, and RMS VU meter visual accuracy during live transmissions.
- [ ] **Network Latency & Jitter Resilience**: Test audio chunk streaming stability under simulated packet delay/jitter.

### 3. Session Management & Reconnection Improvements
- [ ] **Expired Session Cleanup**: If session no longer exists on server, client must wipe previous callsign and clear local session state (`sessionStorage`).
- [ ] **Improve Session Management**: Enhance session state synchronization, auto-rejoin upon page refresh (`sessionStorage`), and active Net state recovery.
- [ ] **Tab Refresh & Rejoin Test**: Verify seamless session persistence when refreshing active Net sessions or reopening closed browser tabs.
- [ ] **Socket Reconnection Recovery**: Test client auto-reconnect, room re-subscription, and state synchronization following temporary server or Wi-Fi dropouts.

### 3. Architecture & Infrastructure Maintenance
- [ ] **Gunicorn Worker Migration**: Evaluate replacing deprecated Eventlet worker (`geventlet`) with Gevent or Gthread in `Dockerfile` ahead of Gunicorn v26 release.
- [ ] **Instructor PIN Management Audit**: Review pin persistence and security in `app/instructor_pins.json`.

---

## 🚀 Commands Quick Reference
```bash
# Run application stack locally for manual browser testing
docker compose up -d

# Run automated Playwright E2E suite
docker compose -f docker-compose.e2e.yml run --rm e2e-test

# Run unit tests & static analysis battery
docker compose -f docker-compose.test.yml run --rm test
```
