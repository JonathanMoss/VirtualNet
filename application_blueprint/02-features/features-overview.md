# Features Overview: VirtualNet

This document outlines the core functional requirements and features for the VirtualNet application, grouped by functional area.

---

## 1. Session & Connection Management

To simulate a radio net without user accounts or persistent data, the session follows a dynamic PIN-based connection model:

- **Create a Net (Instructor Role)**:
  - An instructor hosts a new session.
  - The server generates a **unique 4-character PIN** (alphanumeric, e.g., `A3F9`).
  - The instructor is presented with the PIN to distribute to students.
- **Join a Net (Student Role)**:
  - Students access the application landing page.
  - To join, students enter the **4-character PIN** and a **Nickname** (no password or account needed).
  - No personal information is collected or stored.
- **Awaiting Assignment Queue**:
  - Upon entering a valid PIN, the student is placed in an "Awaiting Callsign" state.
  - The student's UI is locked, displaying a loading indicator: `"Awaiting Callsign Assignment..."`. They cannot listen or transmit yet.
- **Call Sign Assignment**:
  - The Instructor Dashboard displays a list of newly joined students and their nicknames.
  - The instructor manually assigns a tactical call sign (e.g. `R11`) to each nickname.
  - Once assigned, the student's client unlocks, transitioning them into the active net.
- **Session Termination**:
  - The instructor can click "End Net Session".
  - The server closes all WebSocket connections, deletes the temporary session data, and redirects all connected students back to the "Join Net" landing page.

---

## 2. Voice Communication (Virtual Radio)

Simulates the physical behavior of a half-duplex radio transceiver.

- **Push-to-Talk (PTT)**:
  - A keyboard hotkey (e.g., Spacebar, Left Ctrl) or a UI button to initiate transmission.
  - Audio is captured from the user's default microphone and streamed in real-time.
- **Half-Duplex Enforcement (Single Speaker)**:
  - Only **one** station can transmit at any given time.
  - If a student attempts to transmit while another station is speaking:
    - The client blocks transmission and provides visual feedback (e.g., "Channel Busy") and an auditory warning tone.
- **PTT Start/End Tones**:
  - Plays a short "click/beep" sound when PTT is pressed and released, replicating real radio squelch tails and transmission start/stop cues.
- **Audio Quality Simulation**:
  - The client or server can apply audio DSP effects (such as bandpass filtering, white noise mix, and static hiss) based on the current station signal quality setting.

---

## 3. Real-Time Radio Log (Logsheet)

Logging is a core skill in Voice Procedure training. Each station needs to maintain their own log.

- **Interactive Log Table**:
  - Columns:
    - **Time (DTG)**: Automatically filled with the current system time when a new row is created, but remains editable.
    - **From**: Call sign of the station transmitting the message.
    - **To**: Call sign of the station receiving the message.
    - **Precedence**: Dropdown menu (Routine, Priority, Immediate, Flash).
    - **Text / Event**: Detailed contents of the message or event.
    - **Initials**: Operator initials for accountability.
- **Quick-Log Shortcuts**:
  - Hotkeys to quickly create a new log entry, pre-populating fields like Time or the sender's Call Sign based on the current active speaker.
- **Log Export**:
  - Ability to save the radio log as a local file (e.g., JSON, CSV, or formatted PDF) for submission to the instructor.
- **Optional Screen Logsheet (Paper Mode)**:
  - Students can toggle the digital logsheet on/off. When hidden ("Paper Mode"), the interface encourages students to write on physical paper logs for realism, clean up screen space, and focus on voice channels.

---

## 4. Aide Memoire & Code Tools

To assist students in formatting voice reports, taking logs, and encrypting coordinates/messages, the client includes a side-sliding reveal panel:

- **Logging Shorthand Symbols Card**:
  - Quick reference guide for standard military logging shorthand (e.g., standard symbols for call signs, precedence, and contact reports).
- **Interactive BATCO Sheet & Slider**:
  - A digital replication of the paper BATCO sheet.
  - Includes a movable horizontal cursor (slider) that students can slide up/down to align code lines, facilitating the encryption and decryption of grids, times, and quantities.
- **Standard Vocabulary Cards (Cards 001-012)**:
  - Digital index of standard vocabulary cards (OPS 1-3, FIRE SP, ATK, ENGRS, COMMS, AVN, LOG 1-3, SPEC OPS).
  - Used alongside the BATCO sheet for number-to-text substitution.
- **Callsign Allocation Summary**:
  - A quick-view directory that summaries the mapping of callsigns to operator nicknames for the active net, helping students keep track of who is who.
- **Tactical Slate Cards (AC-71936)**:
  - Foldable/tabbed templates matching standard army/NATO slate formats (SITREP, MIST casualty card, MEDEVAC 9-Line, Call for Fire CFF, QAOS attack, JAMREP, EQUIPRECREQ, EOINCREP, BOMBREP).

---

## 5. Instructor & Net Control Dashboard

- **Roster & Admissions**:
  - Lists all connected nicknames, their assigned call signs, and their current voice transmission state.
  - Text inputs next to pending joiners to type and assign their call signs.
- **Dynamic Signal Quality Simulation**:
  - Instructors can alter the audio link quality for individual student stations using a dropdown menu (OK, DIFFICULT, UNWORKABLE).
- **Net Discipline Override (Break-In)**:
  - The Net Control Station (or Instructor) can override a sub-station's transmission in an emergency, cutting off their audio stream to reclaim the channel.
- **Mute / Kick Station**:
  - Control can temporarily mute or disconnect a student station if they exhibit bad net discipline or experience hardware issues.
- **Exercise Management**:
  - Control can send simple global text broadcasts (e.g., "STANDBY FOR DRILL ALPHA", "NET SUSPENDED") that appear in a bulletin box on all clients.
- **Session End**:
  - A primary button to close down the net session, automatically disconnecting all students.

---

## 6. Review & Debriefing

- **Server-Side Audio Logging (Instructor Tool)**:
  - The server can optionally record all transmissions in sequence with timestamps.
  - Allows the instructor to play back the net dialogue to show students where procedure errors were made.
- **Log Comparison**:
  - An instructor utility to compare a student's log against the actual server audio recording or the Control station's master log to check for missing entries, incorrect call signs, or misheard message text.
