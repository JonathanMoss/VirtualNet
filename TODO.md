Implementation Plan: Fix Audio Buffer Overlap Choking & Suspended AudioContext Rejoin Degradation
Problem Statement & Diagnosis
When a student closes the browser tab and re-opens it to auto-rejoin an active session, attempting to transmit or receive audio results in garbled sound quality and buffer choking.

Root Cause Analysis
Is this a session issue? No. The backend session state, SQLite database, and Socket.IO SID re-registration are working correctly. The issue is in the WebAudio Engine scheduling math and browser AudioContext lifecycle upon rejoin:

Jitter Threshold Mathematical Flaw (static/js/audio.js):

Each audio chunk transmitted is 4096 PCM samples (~85.3ms duration at 48kHz).
Receiving 2 consecutive audio chunks creates a natural 170.6ms buffer queue (0.0853s * 2 = 0.1706s).
In receiveAudioChunk(), the previous jitter check reset nextStartTime if (nextStartTime - currentTime) > 0.12 (120ms).
Because 170.6ms is greater than 120ms, every 3rd audio chunk was being forcibly reset to currentTime + 0.03, causing 33% to 50% of all audio chunks to collide and play simultaneously over previous chunks, producing loud garbled distortion and audio choking.
Suspended AudioContext State on Browser Re-open (static/js/audio.js & static/js/app.js):

When a browser tab is re-opened, browser autoplay policies place AudioContext in 'suspended' state where audioContext.currentTime is frozen at 0.
Audio chunks received while AudioContext is suspended were being scheduled at currentTime = 0. When the user later interacted with the UI, AudioContext.resume() completed, causing all accumulated chunks to explode simultaneously.
User Review Required
IMPORTANT

The jitter buffer threshold will be adjusted to 400ms (0.40s), which accommodates normal 1 to 3 chunk network buffering (85ms–255ms) without triggering false resets, while still protecting against extreme network lag.
Audio chunks received while AudioContext.state !== 'running' will be dropped immediately to prevent stale buffer bursts upon re-joining.
Proposed Changes
Frontend Audio Engine (static/js/audio.js)
[MODIFY] 
audio.js
Update receiveAudioChunk():
Check if (this.audioContext.state !== 'running'): Drop incoming chunk and reset this.nextStartTime = 0.
Update jitter threshold check from 0.12 to 0.40 seconds:
javascript

if (!this.nextStartTime || this.nextStartTime < currentTime || (this.nextStartTime - currentTime) > 0.40) {
  this.nextStartTime = currentTime + 0.03;
}
Update startRecording():
Await this.audioContext.resume() prior to initializing media capture sources to ensure ScriptProcessor/AudioWorklet nodes execute on a running context.
Application Controller (static/js/app.js)
[MODIFY] 
app.js
In joinNetSuccess() (called on both fresh joins and auto-rejoins), call this.audioEngine.stopAllRxSources() to clear any leftover playback state.
Ensure global unlock gesture listeners (click, pointerdown, keydown, touchstart) resume AudioContext on any interaction after re-opening the browser.
Automated Tests (tests/js/audio_buffer.test.js)
[MODIFY] 
audio_buffer.test.js
Add unit tests verifying:
Audio chunk scheduling with 170ms 2-chunk buffer does not trigger false resets.
Audio chunks are dropped when AudioContext state is suspended.
Verification Plan
Automated Tests
Containerized Quality Gates (Includes Node.js Unit & Telemetry Tests, Pylint, ESLint, Behave BDD, Security Audits):
bash

docker compose -f docker-compose.test.yml up --build --exit-code-from test
Pytest Suite:
bash

pytest --ignore=tests/test_e2e_browser.py --cov=app --cov-fail-under=90
Playwright E2E Suite:
bash

./run_e2e.sh
Manual Verification
Test student flow: Join net -> Close browser tab -> Re-open browser tab -> Auto-rejoin session -> Press PTT and transmit/receive audio to verify clean voice quality without choking or distortion.