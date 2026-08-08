## VirtualNet - Sunray (Instructor) User Guide

Welcome to the **Sunray Portal Guide**. As Net Control Station (NCS) / Sunray, you oversee tactical radio net exercises, manage student callsign assignments and enforce net discipline.

Note: VirtualNet.uk does not require any PII, nor does it save/store or process any voice messages.

---

### Daily Net Access PIN Sheet

> **IMPORTANT INSTRUCTOR NOTICE:**
> Authorised access to VirtualNet.uk is safeguarded by use of a **Daily Instructor 6-Digit PIN**.
> A list of valid pin numbers for each day is available on request from the application owner: 
>
> Contact **`joth.moss@googlemail.com`**.

---

### 1. Hosting a Net Session

1. On the VirtualNet landing page, click **SUNRAY Portal**.
2. Enter the **Net Session Name** (e.g., `Exercise Grey Fox`).
3. Enter the **Daily Instructor 6-Digit PIN**
4. Click **CREATE NET SESSION**.
5. Once created, your Sunray Control Console will initialize, giving you full control over the net roster and active session.
6. The 4-character Exercise Pin is displayed at the top of the screen, you need to issue this to students wishing to join your net.

---

### 2. Callsign Assignment & Student Queue

When students connect using your exercise PIN, they enter a waiting queue in `AWAITING CALLSIGN ASSIGNMENT` status.

### Assigning Callsigns:
- Look at the **Sunray Control Panel** on your dashboard.
- Locate student nicknames listed under **Waiting Stations**.
- Enter the designated callsign for each student (e.g., `R11`, `R12`, `H10`).
- Click **ASSIGN**.
- The student's dashboard will instantly unlock, allowing them to transmit audio.

---

### 3. Net Roster & Live Status Monitoring

The **Net Roster** panel provides real-time visibility across all connected stations:

- **IDLE** (Green): Station is listening on the net channel.
- **TRANSMITTING** (Red): Station is currently keying PTT and streaming microphone audio to the net.
- **RECEIVING** (Amber): Station is receiving an active transmission from another operator.
- **OFFLINE** (Gray): Station has disconnected or timed out.
- **Signal Indicator**: Displays simulated signal strength and audio quality metrics.

---

### 4. Sunray Priority Break-In (Override)

As Sunray / Net Control, your station has **highest net priority**:

- If a student is transmitting and you need to intervene, correct procedure, or broadcast an urgent order, **press and hold PTT**.
- VirtualNet's **Break-In System** immediately overrides the current transmission, cuts off the student stream, and broadcasts your audio to all connected net members.
- The student UIs will immediately display **`RECEIVING: CONTROL`** (or your Sunray callsign).

---

## 5. Transmission Activity Log (Sunray Only)

The **Transmission Activity Log** automatically records all station transmissions:
- Displays **DTG**, **Call Sign**, **Duration** ($s$), and **Status** (`COMPLETED`, `DF ALERT`, `OVERRIDDEN`) in real-time for Sunray evaluation.

---

## 6. Ending a Net Session

When training completes:
- Click **END NET SESSION** on your Sunray Control Console.
- Confirm session termination.
- All connected student sockets will be disconnected cleanly, resetting client dashboards back to the join landing page.

---

## Summary for Sunray / Net Control

| Action | Sunray Control Method |
| :--- | :--- |
| **Get Daily PINs** | Email application owner at `joth.moss@googlemail.com` |
| **Unlock Student Radio** | Enter callsign (`R11`) and click **Assign Callsign** |
| **Interrupt Student Speech** | Press PTT to execute Sunray Break-In Override |
| **Review Transmissions** | View **Transmission Activity Log** in Sunray Control Panel |
| **Close Training Net** | Click **End Net Session** |
