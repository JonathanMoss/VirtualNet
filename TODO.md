# VirtualNet — TODO List (Tasks for Tomorrow)

## 📋 Resolved (Verified & Pushed to Remote)
- [x] **Socket.IO `handleCreateResponse` Fix**: Resolved missing handler exception on session creation.
- [x] **Fold / Expand UI Controls Fix**: Restored fold/expand toggles and icon indicators across Roster, Sunray panel, PTT card, and Header details.
- [x] **Awaiting Callsign Assignment Queue Fix**: Restored student entry rendering in assignment queue when panel is minimized.
- [x] **PTT Keying & Spacebar Page Scroll Prevention**: Fixed spacebar <kbd>Space</kbd> keying so it no longer scrolls the page (`e.preventDefault()`).
- [x] **Sunray Controller `handleSunrayTxLog` Fix**: Resolved missing method error on Sunray TX log updates.
- [x] **Playwright Headless E2E Test Suite Container**: Created standalone `docker-compose.e2e.yml` and 15 Playwright E2E test cases in `tests/test_e2e_full_suite.py` aligned 100% with `application_blueprint/` specifications (including Channel Busy blocking, SUNRAY Break-In Override, and Student Leave Net Session).
- [x] **Change Callsign Functionality & Header UI Button**: Added mid-session callsign modification trigger (`.btn-change-callsign`) and automatic indicator formatting (`app/sockets.py`).
- [x] **Expired Session Cleanup & State Reset**: Implemented complete UI label and state teardown (`resetToLanding`) and `sessionStorage` wipe when sessions expire or close.
- [x] **Session Persistence & Tab Refresh Auto-Rejoin**: Persisted assigned callsign in `sessionStorage` and restored net state automatically across page reloads and socket rebinds.
- [x] **Instructor PIN Management Audit & In-Memory Caching**: Optimized `pin_service.py` with in-memory caching and filesystem mtime checks.
- [x] **Gunicorn Worker Migration Audit**: Evaluated Eventlet worker compatibility and documented Gunicorn v26 migration pathway.
- [x] **Full 56-Test Suite Verification**: Verified all 56 unit, contract, DOM, route, socket, load, and E2E browser tests pass cleanly in container stack.

---

## 🎯 Next Tasks & Manual Verification

### Live Microphone & Real Audio Quality Testing
- [ ] **Physical Microphone Test**: Conduct manual voice tests across multiple physical devices (Desktop, Mobile/Tablet) to verify clear PCM audio playback.
- [ ] **Audio Quality & VU Level Tuning**: Validate WebAudio DSP noise suppression, echo cancellation, and RMS VU meter visual accuracy during live transmissions.
- [ ] **Network Latency & Jitter Resilience**: Test audio chunk streaming stability under simulated packet delay/jitter.

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
