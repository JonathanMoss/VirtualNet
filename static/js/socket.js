// SocketIO Client Manager Module - VirtualNet

import { showAlert } from './dialog.js';

export class SocketManager {
  constructor(app) {
    this.app = app;
    this.socket = null;
  }

  connect() {
    // Establish a Socket.IO connection using polling first, then upgrade to websocket if available.
    const url = window.location.origin;
    this.socket = io(url, {
      path: '/socket.io',
      transports: ['websocket', 'polling'],
      upgrade: true,
      secure: url.startsWith('https:'),
      pingInterval: 2000,
      pingTimeout: 5000
    });
    this.socket.binaryType = 'arraybuffer';

    // Register event listeners
    this.socket.on('connect', () => {
      console.log("Socket.IO connected to server.");
      this.triggerAutoRebind();
    });
    this.socket.on('connect_error', (err) => {
      console.error('Socket.IO connect_error:', err);
    });
    this.socket.on('connect_timeout', () => {
      console.warn('Socket.IO connection timed out');
    });
    this.socket.on('reconnect', () => {
      console.log("Socket.IO reconnected to server.");
      this.triggerAutoRebind();
    });
    this.socket.on('reconnect_error', (err) => {
      console.error('Socket.IO reconnect_error:', err);
    });
    this.socket.on('reconnect_failed', () => {
      console.error('Socket.IO reconnect failed');
    });
    this.socket.on('disconnect', (reason) => {
      console.warn('Socket.IO disconnected:', reason);
    });

    // Auto-rebind when tab regains focus/visibility
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        console.log("Tab visibility restored — checking session auto-rebind...");
        this.triggerAutoRebind();
      }
    });

    // Setup 30-second heartbeat interval to update server station.last_seen
    setInterval(() => this.sendHeartbeat(), 30000);

    this.socket.on('join_response', (data) => {
      this.app.handleJoinResponse(data);
    });

    this.socket.on('rejoin_response', (data) => {
      this.app.handleJoinResponse(data);
    });

    this.socket.on('create_response', (data) => {
      this.app.handleCreateResponse(data);
    });

    this.socket.on('callsign_assigned', (data) => {
      this.app.handleCallsignAssigned(data);
    });

    this.socket.on('roster_update', (data) => {
      this.app.handleRosterUpdate(data.stations);
    });

    this.socket.on('ptt_response', (data) => {
      this.app.handlePTTResponse(data);
    });

    this.socket.on('ptt_override', (data) => {
      this.app.handlePTTOverride(data);
    });

    this.socket.on('ptt_timeout', (data) => {
      this.app.handlePTTTimeout(data);
    });

    this.socket.on('ptt_released', (data) => {
      if (this.app.handlePTTReleased) this.app.handlePTTReleased(data);
    });

    this.socket.on('audio_chunk', (data) => {
      console.log("[SOCKET-RX] Received 'audio_chunk' event from Socket.IO", data ? (data.byteLength || data.length) : 0, "bytes");
      // Decode binary chunk and play back
      this.app.audioEngine.receiveAudioChunk(data);
    });

    this.socket.on('audio_ack', (data) => {
      if (this.app.telemetryManager && data) {
        this.app.telemetryManager.recordTxAck(data.bytes || 0);
      }
    });

    this.socket.on('sunray_tx_log', (data) => {
      this.app.handleSunrayTxLog(data);
    });

    this.socket.on('sync_response', (data) => {
      if (!data.success) {
        console.warn("Log entry failed to sync:", data.reason);
      }
    });

    this.socket.on('session_ended', () => {
      showAlert("This net session has been ended by SUNRAY.", { title: "SESSION ENDED", titleColor: "var(--color-hot-red)" });
      this.app.clearSavedSession();
      this.app.resetToLanding();
    });

    this.socket.on('kicked', (data) => {
      showAlert(data.reason || "You have been kicked from the net by SUNRAY.", { title: "KICKED FROM NET", titleColor: "var(--color-hot-red)" });
      this.app.clearSavedSession();
      this.app.resetToLanding();
    });

    this.socket.on('error', (data) => {
      showAlert(`Error: ${data.reason}`, { title: "SOCKET ERROR", titleColor: "var(--color-hot-red)" });
    });
  }

  triggerAutoRebind() {
    const saved = this.app.loadSavedSession();
    if (saved && saved.pin && saved.nickname && this.socket && this.socket.connected) {
      console.log("Emitting rejoin_net to rebind socket SID to station:", saved.stationId);
      this.socket.emit('rejoin_net', {
        pin: saved.pin,
        nickname: saved.nickname,
        role: saved.role || 'SUB_STATION',
        stationId: saved.stationId || null
      });
    }
  }

  sendHeartbeat() {
    if (this.socket && this.socket.connected) {
      this.socket.emit('heartbeat', {
        stationId: this.app.myStationId,
        pin: this.app.netPin
      });
    }
  }

  joinNet(pin, nickname, role = 'SUB_STATION', stationId = null) {
    this.socket.emit('join_net', { pin, nickname, role, stationId });
  }

  rejoinNet(pin, nickname, role = 'SUB_STATION', stationId = null) {
    this.socket.emit('rejoin_net', { pin, nickname, role, stationId });
  }

  leaveNet() {
    this.socket.emit('leave_net', {});
  }

  createNet(name, instructorPin, sunrayCallsign = "0", callsignIndicator = "") {
    this.socket.emit('create_net', {
      name,
      callsign_indicator: callsignIndicator,
      instructor_pin: instructorPin,
      sunray_callsign: sunrayCallsign
    });
  }

  assignCallsign(stationId, callSign, role) {
    this.socket.emit('assign_callsign', { stationId, callSign, role });
  }

  kickStation(stationId) {
    this.socket.emit('kick_station', { stationId });
  }

  requestPTT() {
    this.socket.emit('ptt_request', { stationId: this.app.myStationId });
  }

  releasePTT(transmissionId) {
    this.socket.emit('ptt_release', { stationId: this.app.myStationId, transmissionId });
  }

  sendAudioChunk(binaryData) {
    if (this.socket && this.socket.connected) {
      if (this.app.telemetryManager && binaryData) {
        this.app.telemetryManager.recordTxChunk(binaryData.byteLength || binaryData.length || 0);
      }
      this.socket.volatile.emit('audio_chunk', binaryData);
    }
  }

  syncLogEntry(entry) {
    this.socket.emit('sync_log_entry', {
      netId: this.app.netId,
      ownerCallSign: this.app.myCallSign,
      entry: {
        entryId: entry.id,
        dtg: entry.dtg,
        fromCallSign: entry.fromCallSign,
        toCallSign: entry.toCallSign,
        precedence: entry.precedence,
        eventText: entry.eventText,
        operatorInitials: entry.operatorInitials
      }
    });
  }

  setSignalQuality(stationId, signalQuality) {
    this.socket.emit('set_signal_quality', { stationId, signalQuality });
  }

  setNetState(netState) {
    // For instructor dashboard updating directive state
    this.socket.emit('set_net_state', { netState });
  }

  endSession() {
    this.socket.emit('end_session', { netId: this.app.netId });
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
    }
  }
}
