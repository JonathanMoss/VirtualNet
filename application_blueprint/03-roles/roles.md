# User Roles & Responsibilities: VirtualNet

This document defines the key roles in VirtualNet, their real-world responsibilities on a radio net, and their corresponding system permissions/features.

---

## 1. Sub-Station Operator (Student)

### Real-World Responsibilities
- **Reporting**: Transmits unit updates, situational reports, and messages to Control or other sub-stations.
- **Listening & Logging**: Stays alert, listens to all traffic on the frequency, and maintains an accurate log of all transmissions.
- **Net Discipline**: Requests permission from Control before transmitting, uses correct prowords, and maintains brevity.

### Admission & System Permissions
- **Anonymous Entry**: Connects by supplying a 4-character session PIN and a Nickname. No personal credentials are captured.
- **Awaiting Assignment State**: Starts in a queue where they cannot stream audio, view logs, or see the roster.
- **Standard Operator Mode**: Activated once the instructor assigns a tactical callsign (e.g. `R11`). Enabled with:
  - Push-to-Talk (PTT) half-duplex voice streaming.
  - Keyboard-navigable digital logsheet.
  - Live net roster directory.
  - Log sheets export utility.

---

## 2. Instructor / Assessor

### Real-World Responsibilities
- **Exercise Design**: Sets up the network, schedules training exercises, and inputs "injects" (events students must respond to).
- **Assessment**: Observes student voice procedures, checks the speed and accuracy of logging, and evaluates net discipline.
- **Feedback & Debriefing**: Conducts post-exercise reviews using recorded audio and log files.

### System Permissions & Features
- **Session Host**: Creates a Net Session, receiving a unique 4-character PIN from the server to give to students.
- **Admissions Manager**: Views nicknames of connected students in the Admissions Queue and manually assigns their tactical call signs.
- **Ghost Mode Oversight**: Monitors the roster, listens to all active voice communication, and reviews students' logsheets in real time.
- **Session Termination**: Can close down the net session, which automatically disconnects all connected students and redirects them to the login screen.
