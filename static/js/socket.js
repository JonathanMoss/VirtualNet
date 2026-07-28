// SocketIO Client Manager Module - VirtualNet

export class SocketManager {
  constructor(app) {
    this.app = app;
    this.socket = null;
  }

  connect() {
    // Establish connection to host domain using native websocket transport for lower latency.
    this.socket = io({ transports: ['websocket'] });
    this.socket.binaryType = 'arraybuffer';

    // Register event listeners
    this.socket.on('connect', () => {
      console.log("WebSocket connected to server.");
    });

    this.socket.on('join_response', (data) => {
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

    this.socket.on('audio_chunk', (data) => {
      // Decode binary chunk and play back
      this.app.audioEngine.receiveAudioChunk(data);
    });

    this.socket.on('radio_check_status', (data) => {
      this.app.handleRadioCheckStatus(data);
    });

    this.socket.on('sync_response', (data) => {
      if (!data.success) {
        console.warn("Log entry failed to sync:", data.reason);
      }
    });

    this.socket.on('session_ended', (data) => {
      alert("This net session has been ended by the Instructor.");
      this.app.resetToLanding();
    });

    this.socket.on('error', (data) => {
      alert(`Error: ${data.reason}`);
    });
  }

  joinNet(pin, nickname, role = 'SUB_STATION') {
    this.socket.emit('join_net', { pin, nickname, role });
  }

  createNet(name, callsignIndicator) {
    this.socket.emit('create_net', { name, callsign_indicator: callsignIndicator });
  }

  assignCallsign(stationId, callSign, role) {
    this.socket.emit('assign_callsign', { stationId, callSign, role });
  }

  requestPTT() {
    this.socket.emit('ptt_request', { stationId: this.app.myStationId });
  }

  releasePTT(transmissionId) {
    this.socket.emit('ptt_release', { stationId: this.app.myStationId, transmissionId });
  }

  sendAudioChunk(binaryData) {
    if (this.socket && this.socket.connected) {
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

  startRadioCheck() {
    this.socket.emit('start_radio_check', {});
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
