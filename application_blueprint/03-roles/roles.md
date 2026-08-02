# User Roles & Responsibilities: VirtualNet

This document defines the key roles in VirtualNet, their real-world responsibilities on a radio net, and their corresponding system permissions/features.

---

## 1. Sub-Station Operator (Student)

### Real-World Responsibilities
- **Reporting**: Transmits unit updates, situational reports, and messages to Control or other sub-stations.
- **Listening & Net Discipline**: Stays alert, listens to all traffic on the frequency, requests permission from Control before transmitting, uses correct prowords, and maintains brevity.

### Admission & System Permissions
- **Anonymous Entry**: Connects by supplying a 4-character session PIN and a Nickname. No personal credentials are captured.
- **Awaiting Assignment State**: Starts in a queue where they cannot stream audio or see the net roster.
- **Standard Operator Mode**: Activated once the instructor assigns a tactical callsign (e.g. `R11`). Enabled with:
  - Push-to-Talk (PTT) half-duplex voice streaming.
  - Live net roster directory.
  - Interactive Aide Memoire reference cards (BATCO slider, Slates, Vocab, Shorthand).

---

## 2. Instructor / Assessor (SUNRAY)

### Real-World Responsibilities
- **Exercise Design**: Sets up the network, manages session parameters, and dispatches training scenario injects (events students must respond to).
- **Assessment**: Observes student voice procedures, verifies net discipline, and evaluates student responses to injects.
- **Feedback & Debriefing**: Conducts post-exercise reviews using real-time net telemetry and transmission logs.

### System Permissions & Features
- **Session Host**: Creates a Net Session, receiving a unique 4-character PIN from the server to distribute to students.
- **Admissions Manager**: Views nicknames of connected students in the Admissions Queue and assigns tactical call signs.
- **Live Net Control & Scenario Injects**: Monitors net status, dispatches scenario injects, controls net operational mode (FREE vs. DIRECTED), and breaks into student transmissions when needed.
- **Session Termination**: Can close down the net session, which automatically disconnects all connected students and redirects them to the landing page.
