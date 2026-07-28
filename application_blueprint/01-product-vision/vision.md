# Product Vision: VirtualNet

VirtualNet is a Client/Server application designed to provide students and instructors with a simulated environment to practice Communication and Information Systems (CIS) and Voice Procedure (VP) rules on a virtual military radio net.

## Problem Statement

Standard radio training for students in military, emergency response, and search & rescue programs requires practicing realistic radio net procedures, including message logging and structured Voice Procedure (VP). However:
1. **Radio Availability**: Physical military radio equipment is expensive, scarce, and requires special licenses or maintenance.
2. **Logging & Monitoring**: Instructors find it difficult to monitor multiple simultaneous conversations, track who is logging messages correctly, and review student performance after exercises.
3. **Location Constraints**: Practice is typically confined to physical classrooms or areas within radio signal range.

## Core Value Proposition

VirtualNet bridges this gap by simulating a multi-station radio net over a standard IP network (local or internet). It allows students to:
- Practice voice transmission using standard VP protocols and prowords (e.g., "Over," "Out," "Roger," "Say Again").
- Learn the role of Net Control Station (NCS) and Sub-stations in a structured net.
- Practice real-time radio logging of incoming and outgoing traffic.
- Train remotely or in classroom settings using standard PCs/laptops without the need for physical radio hardware.

---

## Operational Concept

The virtual environment mimics a single radio frequency network (often called a **Radio Net**):

1. **Net Control Station (Control)**
   - The primary station responsible for managing and directing the net.
   - Monitors all traffic on the net.
   - Directs sub-stations, controls who has the floor to transmit, and coordinates exercises.

2. **Sub-stations**
   - General participant stations on the net.
   - Must follow procedure to request permission to transmit to Control or other sub-stations.
   - Maintain their own local radio logs of all voice traffic.

3. **Voice Transmissions**
   - Half-duplex communication model (simulating a Push-to-Talk radio where only one station can transmit on a frequency at a time).
   - Real-time audio stream to all active participants in the net.

4. **Message Logging**
   - A digital radio log interface where students record communication events, call signs, and transmission metadata (time, sender, receiver, precedence, message body).

---

## High-Level Objectives

- **VP Mastery**: Enable students to internalize standardized voice protocols through repeat practice in a realistic, low-friction simulation.
- **Net Discipline**: Teach students the flow of radio net operations (opening the net, call signs, routing messages, net discipline, and closing the net).
- **Log Accuracy**: Develop the habits of accurate real-time logging alongside active listening.
- **Instructor Oversight**: Provide instructors with a centralized tool to oversee, review, and evaluate student performance during and after exercises.
