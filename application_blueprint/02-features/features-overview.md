# Features Overview: VirtualNet

This document outlines the core functional requirements and features for the VirtualNet application, grouped by functional area.

---

## 1. Session & Connection Management

To simulate a radio net without user accounts or persistent data, the session follows a dynamic PIN-based connection model:

- **Session Persistence & Recovery**:
  - Session state is stored in `localStorage` with a 24-hour TTL and daily 6-digit PIN validation.
  - If SUNRAY reloads or re-opens the browser, the system validates today's 6-digit instructor PIN. If valid, the net session (`A3F9`) is re-bound or automatically re-hosted seamlessly. If expired (midnight UTC transition), the stored session is cleared and SUNRAY is prompted to host a fresh net.
- **Cross-Tab Synchronization**:
  - Uses `window.addEventListener('storage', ...)` to sync session state across multiple open browser tabs. Ending or leaving a net session in one tab instantly updates all open tabs.
- **Student Closed-Session Tactical Rejection Alert**:
  - When a student re-opens the browser after SUNRAY has closed a net session, `rejoin_net` receives a rejection payload. The client pops up an interactive tactical alert modal (`"SESSION NO LONGER VALID - Net session closed by SUNRAY"`), clears local storage, and cleanly redirects to the landing page.
- **Tactical Reconnecting Badge & Status Indicator**:
  - Header badge displays `🟡 RECONNECTING TO NET (A3F9)...` during auto-rebind before transitioning to `🟢 CONNECTED (A3F9)` or showing rejection modal.
- **One-Click Copy PIN & URL Query Parameter Pre-fill**:
  - Copy button next to header PIN badge allows one-click copying of PIN and shareable URL (`https://virtualnet/?pin=A3F9`). Query parameter `?pin=A3F9` automatically pre-fills the student join form.
- **Station Impersonation Protection**:
  - Server verifies `stationId` identity on rejoin to prevent duplicate station hijacking or nickname impersonation.
- **Disconnected Station Grace Period (`OFFLINE`)**:
  - When a student closes a browser tab, SUNRAY's roster displays the station as `OFFLINE` for a 60-second grace period, preserving their assigned callsign (`R11`) if they re-open before expiration.
- **Re-Host Previous Net Action**:
  - "Load Last Net Settings" button on host form to pre-fill net name and callsign indicator from previous session.

---

## 2. Voice Communication (Virtual Radio)

Simulates the physical behavior of a half-duplex radio transceiver.

- **Push-to-Talk (PTT)**:
  - Key-down spacebar hotkey or touch-hold UI button to initiate voice transmission.
  - Audio is captured from the user's default microphone, encoded, and streamed via WebSockets/Socket.IO in real-time.
- **Mobile DSP Audio Optimizations & Hardware Resampling**:
  - Android/Chrome mobile optimizations feature streaming Int16 PCM chunk compression, WebAudio hardware resampling, and native mobile DSP audio processing (`echoCancellation`, `noiseSuppression`, `autoGainControl`).
- **Half-Duplex Enforcement (Single Speaker)**:
  - Only **one** station can transmit on a frequency at any given time.
  - If a student attempts to transmit while another station is speaking:
    - The client blocks transmission, provides visual feedback ("Channel Busy"), and plays an auditory warning tone.
- **PTT Start/End Squelch Tones**:
  - Plays short click/beep squelch tail audio when PTT is engaged and released.
- **Audio Telemetry HUD & Dual LED VU Meter**:
  - Real-time 10-segment phosphor green/amber/red LED VU meter displaying microphone RMS volume during transmission (TX) and speaker output volume during reception (RX).
- **Phosphor CRT Packet Sparkline & RX Playback Tracking**:
  - 24px CRT sparkline canvas rendering chunk byte spikes, server ACKs (`audio_ack`), and chunk playback status.
  - On receiving clients, chunks are displayed as **Yellow/Amber** upon WebSocket arrival and transition to **Phosphor Green** the moment WebAudio `AudioBufferSourceNode.onended` physically finishes playing the chunk out the speaker.
- **Mobile AudioContext Tap-to-Unmute Guard Banner**:
  - Automatically detects mobile browser WebAudio autoplay throttling (`AudioContext.state === 'suspended'`) during incoming traffic (`RECEIVING`) and presents a glowing banner (`🔊 TAP TO UNMUTE AUDIO`) with tap listeners across the PTT card to instantly restore voice output.
- **Enemy Direction Finding (DF) Alert Banner**:
  - Continuous transmissions exceeding 20 seconds trigger an immediate high-visibility Enemy Direction Finding warning banner across active clients, warning operators of potential location compromise.
- **Net Discipline Override (Break-In)**:
  - The Net Control Station (SUNRAY) can break into active student transmissions, immediately overriding their stream to reclaim the channel.

---

## 3. Real-Time Radio Log (Logsheet)

Logging is a core skill in Voice Procedure training. Each station maintains their own log.

- **Interactive Log Table**:
  - Columns:
    - **Time (DTG)**: Auto-filled with current Date-Time-Group (e.g., `311032Z JUL 26`), fully editable.
    - **From**: Call sign of the transmitting station.
    - **To**: Call sign of the receiving station.
    - **Precedence**: Precedence selector (Routine, Priority, Immediate, Flash).
    - **Text / Event**: Detailed contents of the message or event.
    - **Initials**: Operator initials for accountability.
- **Quick-Log Shortcuts & Keyboard Navigation**:
  - Strict tab-index mapping (<kbd>Tab</kbd> cell traversal, <kbd>Enter</kbd> on Initials cell appends row and syncs entry).
  - <kbd>Ctrl+N</kbd> hotkey appends a new entry row instantly.
- **Log Export**:
  - Export radio logs as local JSON or text files for submission to instructors.

---

## 4. Reference Resources & Tools

The workspace Reference Resources panel contains five tabbed reference tools and image inspection capabilities:

- **1. SHORTHAND Tab**:
  - Quick reference guide for standard military logging shorthand symbols (`0`/`CS 0`, `R`, `P`, `I`, `F`, `C`, `S`, `Z`, `x`, `RPT`, `OK`/`D`/`U`).
- **2. BATCO Tab (Interactive SVG BATCO Slider)**:
  - Digital replication of the BATCO cipher sheet featuring an interactive SVG slider (`static/js/svg_batco_slider.js`).
  - Features smooth vertical drag alignment across desktop mouse and mobile touch pointers, row step buttons (Step Up / Step Down) for precise alignment, and viewport drag isolation.
- **3. VOCAB Tab (Standard Vocabulary Cards)**:
  - Digital reference cards 001–012 (OPS 1–3, FIRE SP, ATK, ENGRS, COMMS, AVN, LOG 1–3, SPEC OPS) with search/filter capabilities.
- **4. SLATES Tab (Tactical Slate Cards AC-71936)**:
  - High-resolution slate card templates: CFF (Call for Fire), CONTACT Report, MEDEVAC 9-Line, MISTAT (Casualty Report), and SITREP (Situation Report).
- **5. LOGGING Tab**:
  - Standardized military radio logsheet format and entry guidelines.
- **Image Pan/Zoom Controls Bar**:
  - All reference card tabs feature an integrated control bar (`Zoom In +`, `Zoom Out -`, `Reset Zoom Reset`) with drag-pan capabilities for close inspection on desktop and mobile screens.

---

## 5. Custom Tactical CRT Dialog & Modal System

All browser native popups (`alert`, `confirm`, `prompt`) are replaced with a custom-rendered, accessible Tactical CRT night-ops modal system (`static/js/dialog.js`):

- **System Alert (`showAlert`)**: Renders notification modals with custom tactical headers, icons, and an "ACKNOWLEDGE" button.
- **Confirmation Modal (`showConfirm`)**: Renders action confirmations (e.g., Leave Net, End Session, Kick Station) with "CONFIRM" and "CANCEL" buttons, returning a Promise resolving to `true`/`false`.
- **Input Prompt Modal (`showPrompt`)**: Renders prompt dialogs with styled input fields (e.g., change callsign/suffix), returning entered values or `null`.
- **Keyboard & Interceptor Support**: Supports <kbd>Enter</kbd> (confirm/submit), <kbd>Escape</kbd> (cancel/dismiss), focus trapping, dark backdrop blur (`backdrop-filter: blur(4px)`), and window dialog interception.

---

## 6. Instructor & Net Control Dashboard

- **Roster & Admissions Queue**:
  - Visual waiting queue with flashing header badge (`slow-flash-header`).
  - Controls to assign and edit callsigns/roles for active sub-stations.
- **Discipline Override & Mute/Kick**:
  - SUNRAY channel break-in override button.
  - One-click station mute or kick trigger with custom confirm dialogs.
- **Session End**:
  - SUNRAY master control to close net session and purge ephemeral session state.

---

## 7. Modular Jinja2 Card Templates & UI Testing

- **Modular Jinja2 Card Component Architecture**:
  - Application views are refactored into modular Jinja2 component templates located in `static/templates/cards/`: `header_card.html`, `join_net_card.html`, `create_net_card.html`, `transceiver_card.html`, `roster_card.html`, `sunray_card.html`, `df_alert_banner.html`, `resources_card.html`.
- **Automated DOM Contract Verification**:
  - `tests/test_dom_contract.py` guarantees that all Jinja2 component templates strictly maintain necessary DOM element IDs, classes, and attributes consumed by JavaScript modules and CSS selectors.
- **Playwright Headless E2E Browser Testing**:
  - `tests/test_e2e_browser.py` provides end-to-end browser user journey validation using Playwright to test station login, callsign assignment, transceiver UI interactions, and session teardown.

---

## 8. Review & Debriefing

- **Server-Side Log & Audio Sync**:
  - Timestamps all voice transmissions and socket logs for exercise review and student feedback.

