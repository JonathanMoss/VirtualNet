# 👑 VirtualNet - Sunray (Instructor) User Guide

Welcome to the **Sunray Portal Guide**. As Net Control Station (NCS) / Sunray, you oversee tactical radio net exercises, manage student callsign assignments, enforce net discipline, and monitor logsheet accuracy.

---

## 📌 Daily Net Access PIN Sheet

> **IMPORTANT INSTRUCTOR NOTICE:**
> The **Daily Instructor 6-Digit PIN sheet** containing official net access codes for training sessions is provided directly by the application owner:
> **📩 Application Owner:** `joth.moss@googlemail.com`
>
> Contact **`joth.moss@googlemail.com`** if you require new daily PIN allocations.

---

## 1. 🚀 Hosting a Net Session

1. On the VirtualNet landing page, click **SUNRAY Portal**.
2. Enter the **Net Session Name** (e.g., `Exercise Grey Fox`).
3. Enter the **Daily Instructor 6-Digit PIN**
4. Click **CREATE NET SESSION**.
5. Once created, your Sunray Control Console will initialize, giving you full control over the net roster and active session.

---

## 2. 📋 Callsign Assignment & Student Queue Management

When students connect using your exercise PIN, they enter a waiting queue in `AWAITING CALLSIGN ASSIGNMENT` status.

### Assigning Callsigns:
- Look at the **Sunray Control Panel** on your dashboard.
- Locate student nicknames listed under **Waiting Stations**.
- Enter the designated tactical callsign for each student (e.g., `R11`, `R12`, `H10`).
- Click **ASSIGN**.
- The student's dashboard will instantly unlock, allowing them to transmit audio.

---

## 3. 📡 Net Roster & Live Status Monitoring

The **Net Roster** panel provides real-time visibility across all connected stations:

- **IDLE** (Green): Station is listening on the net channel.
- **TRANSMITTING** (Red): Station is currently keying PTT and streaming microphone audio to the net.
- **RECEIVING** (Amber): Station is receiving an active transmission from another operator.
- **OFFLINE** (Gray): Station has disconnected or timed out.
- **Signal Indicator**: Displays simulated signal strength and audio quality metrics.

---

## 4. ⚡ Sunray Priority Break-In (Override)

As Sunray / Net Control, your station has **highest net priority**:

- If a student is transmitting and you need to intervene, correct procedure, or broadcast an urgent order, **press and hold PTT**.
- VirtualNet's **Break-In System** immediately overrides the current transmission, cuts off the student stream, and broadcasts your audio to all connected net members.
- The student UIs will immediately display **`RECEIVING: CONTROL`** (or your Sunray callsign).

---

## 5. 🔍 Student Logsheet Review & Real-Time Inspection

Maintaining accurate radio logs is a core exercise objective.

- Sunray can inspect all student log entries in real time.
- Review submitted **DTG**, **From/To Callsigns**, **Precedence** (`ROUTINE`, `PRIORITY`, `IMMEDIATE`, `FLASH`), and **Event Text**.
- Instructors can export or review session logs via the API endpoints (`/api/session/<PIN>/logs`) for post-exercise debriefs and assessment scoring.

---

## 6. 🚪 Ending a Net Session

When training completes:
- Click **END NET SESSION** on your Sunray Control Console.
- Confirm session termination.
- All connected student sockets will be disconnected cleanly, resetting client dashboards back to the join landing page.

---

## 🛠️ Summary for Sunray / Net Control

| Action | Sunray Control Method |
| :--- | :--- |
| **Get Daily PINs** | Email application owner at `joth.moss@googlemail.com` |
| **Unlock Student Radio** | Enter callsign (`R11`) and click **Assign Callsign** |
| **Interrupt Student Speech** | Press PTT to execute Sunray Break-In Override |
| **Check Student Accuracy** | Inspect live net log entries & roster status |
| **Close Training Net** | Click **End Net Session** |
