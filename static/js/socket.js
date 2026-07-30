// SocketIO Client Manager Module - VirtualNet

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
      transports: ['polling', 'websocket'],
      upgrade: true,
      secure: url.startsWith('https:'),
      pingInterval: 2000,
      pingTimeout: 5000
    });
    this.socket.binaryType = 'arraybuffer';

    // Register event listeners
    this.socket.on('connect', () => {
      console.log("Socket.IO connected to server.");
    });
    this.socket.on('connect_error', (err) => {
      console.error('Socket.IO connect_error:', err);
    });
    this.socket.on('connect_timeout', () => {
      console.warn('Socket.IO connection timed out');
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
      console.log("🌐 [SOCKET-RX] Received 'audio_chunk' event from Socket.IO", data ? (data.byteLength || data.length) : 0, "bytes");
      // Decode binary chunk and play back
      this.app.audioEngine.receiveAudioChunk(data);
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

  joinNet(pin, nickname, role = 'SUB_STATION', stationId = null) {
    this.socket.emit('join_net', { pin, nickname, role, stationId });
  }

  leaveNet() {
    this.socket.emit('leave_net', {});
  }

  createNet(name, callsignIndicator, instructorPin) {
    this.socket.emit('create_net', { name, callsign_indicator: callsignIndicator, instructor_pin: instructorPin });
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
