// Main Application Coordinator Module - VirtualNet

import { SocketManager } from './socket.js';
import { LogsheetManager } from './logsheet.js';
import { AideMemoireManager } from './aide_memoire.js';
import { WebAudioEngine } from './audio.js';

class VirtualNetApp {
  constructor() {
    this.socketManager = new SocketManager(this);
    this.logsheetManager = new LogsheetManager(this);
    this.aideMemoireManager = new AideMemoireManager();
    this.audioEngine = new WebAudioEngine(this);

    // Global session variables
    this.netId = null;
    this.netName = null;
    this.netPin = null;
    this.netState = 'DIRECTED'; // DIRECTED or FREE
    this.myStationId = null;
    this.myCallSign = null;
    this.myNickname = null;
    this.myRole = 'SUB_STATION'; // SUB_STATION or CONTROL / INSTRUCTOR
    
    this.activeSpeaker = 'None';
    this.currentTransmissionId = null;
    this.isTransmitting = false;

    // View toggles
    this.paperMode = false;
  }

  init() {
    // 1. Setup UI forms triggers
    this.setupLandingForms();

    // 2. Setup System Clock updates (Date-Time-Group)
    setInterval(() => this.updateDTGClock(), 1000);
    this.updateDTGClock();

    // 3. Setup Aide Memoire Sub-panels
    this.aideMemoireManager.initialize();

    // 4. Setup PTT UI Handlers & Mobile triggers
    this.setupPTTHandlers();
    
    // 5. Paper Mode toggle trigger
    document.getElementById('btn-paper-mode').addEventListener('click', () => this.togglePaperMode());

    // 6. Connect Socket
    this.socketManager.connect();

    // 7. Check for saved session persistence and auto-reconnect
    const saved = this.loadSavedSession();
    if (saved && saved.pin && saved.nickname) {
      console.log("Restoring active session from storage/cookie:", saved);
      this.myNickname = saved.nickname;
      this.myRole = saved.role || 'SUB_STATION';
      this.socketManager.joinNet(saved.pin, saved.nickname, saved.role);
    }
  }

  saveSession(pin, nickname, role, stationId) {
    try {
      const data = { pin, nickname, role, stationId, timestamp: Date.now() };
      const sessionStr = JSON.stringify(data);
      localStorage.setItem('virtualnet_session', sessionStr);
      document.cookie = `virtualnet_session=${encodeURIComponent(sessionStr)}; path=/; max-age=86400; SameSite=Lax`;
    } catch (e) {
      console.warn("Failed to save session credentials:", e);
    }
  }

  loadSavedSession() {
    try {
      let sessionStr = localStorage.getItem('virtualnet_session');
      if (!sessionStr) {
        const match = document.cookie.match(/(?:^|; )virtualnet_session=([^;]*)/);
        if (match) {
          sessionStr = decodeURIComponent(match[1]);
        }
      }
      if (!sessionStr) return null;
      const data = JSON.parse(sessionStr);
      if (Date.now() - data.timestamp > 86400 * 1000) {
        this.clearSavedSession();
        return null;
      }
      return data;
    } catch (e) {
      return null;
    }
  }

  clearSavedSession() {
    try {
      localStorage.removeItem('virtualnet_session');
      document.cookie = 'virtualnet_session=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT';
    } catch (e) {
      // Ignored
    }
  }

  setupLandingForms() {
    const viewJoin = document.getElementById('join-net-card');
    const viewCreate = document.getElementById('create-net-card');
    
    // Toggle login screen links
    document.getElementById('toggle-create-view').addEventListener('click', (e) => {
      e.preventDefault();
      viewJoin.classList.add('d-none');
      viewCreate.classList.remove('d-none');
    });

    document.getElementById('toggle-join-view').addEventListener('click', (e) => {
      e.preventDefault();
      viewCreate.classList.add('d-none');
      viewJoin.classList.remove('d-none');
    });

    // Student Join Net form submit
    document.getElementById('join-net-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const pin = document.getElementById('join-pin').value.trim();
      const nickname = document.getElementById('join-nickname').value.trim();
      
      this.myNickname = nickname;
      this.socketManager.joinNet(pin, nickname);
    });

    // Instructor Create Net form submit
    document.getElementById('create-net-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const name = document.getElementById('create-name').value.trim();
      const ci = document.getElementById('create-ci').value.trim();
      const instructorPin = document.getElementById('create-instructor-pin').value.trim();
      
      this.socketManager.createNet(name, ci, instructorPin);
    });

    // Host Success dashboard transition click
    document.getElementById('btn-go-instructor').addEventListener('click', () => {
      const pin = document.getElementById('generated-pin').textContent;
      this.myNickname = "Instructor";
      this.socketManager.joinNet(pin, "Instructor", "CONTROL");
    });
  }


  setupPTTHandlers() {
    const pttBtn = document.getElementById('ptt-btn');
    const supportReason = WebAudioEngine.getMediaCaptureSupportReason();
    const supportWarning = document.getElementById('audio-support-warning');
    const mediaCaptureSupported = !supportReason;

    if (supportReason) {
      pttBtn.disabled = true;
      const instruction = document.getElementById('ptt-instruction');
      instruction.textContent = 'Audio unavailable for this session.';
      instruction.style.color = 'var(--color-tactical-amber)';
      supportWarning.textContent = supportReason;
      supportWarning.classList.remove('d-none');
    }

    // Trigger audio initialization on click or user gesture
    const startAudioContext = async () => {
      if (!this.audioEngine.audioContext) {
        await this.audioEngine.init();
      }
      if (this.audioEngine.audioContext && this.audioEngine.audioContext.state === 'suspended') {
        await this.audioEngine.audioContext.resume();
      }
    };

    // Global user-gesture handler to eagerly unlock/resume Web Audio context on first user click/touch
    window.addEventListener('click', startAudioContext, { once: true });
    window.addEventListener('keydown', startAudioContext, { once: true });
    window.addEventListener('touchstart', startAudioContext, { once: true });

    // Keyboard Spacebar PTT events
    document.addEventListener('keydown', (e) => {
      if (e.code === 'Space' && !mediaCaptureSupported) return;
      if (e.code === 'Space' && !this.isTransmitting && !this.isEditingInput(e.target)) {
        e.preventDefault();
        startAudioContext().then(() => this.triggerPTTOff());
      }
    });

    document.addEventListener('keyup', (e) => {
      if (e.code === 'Space' && this.isTransmitting) {
        e.preventDefault();
        this.triggerPTTOn();
      }
    });

    // UI Hold-to-Talk Mouse & Touch PTT events
    pttBtn.addEventListener('mousedown', async (e) => {
      if (e.button !== 0 || !mediaCaptureSupported) return;
      await startAudioContext();
      this.triggerPTTOff();
    });

    const handleMouseRelease = (e) => {
      if (e && e.button !== undefined && e.button !== 0) return;
      if (!mediaCaptureSupported) return;
      if (this.isTransmitting || this.isKeying) {
        this.triggerPTTOn();
      }
    };

    pttBtn.addEventListener('mouseup', handleMouseRelease);
    pttBtn.addEventListener('mouseleave', handleMouseRelease);
    window.addEventListener('mouseup', handleMouseRelease);

    // Mobile touch controls (prevents zooming/scrolling on hot key)
    pttBtn.addEventListener('touchstart', async (e) => {
      e.preventDefault();
      if (!mediaCaptureSupported) return;
      await startAudioContext();
      this.triggerPTTOff();
    });

    pttBtn.addEventListener('touchend', (e) => {
      e.preventDefault();
      if (!mediaCaptureSupported) return;
      if (this.isTransmitting || this.isKeying) {
        this.triggerPTTOn();
      }
    });

    pttBtn.addEventListener('touchcancel', (e) => {
      e.preventDefault();
      if (!mediaCaptureSupported) return;
      if (this.isTransmitting || this.isKeying) {
        this.triggerPTTOn();
      }
    });
  }

  isEditingInput(target) {
    const tag = target.tagName.toLowerCase();
    return tag === 'input' || tag === 'select' || tag === 'textarea';
  }

  triggerPTTOff() {
    if (this.isTransmitting || this.isKeying) return;
    this.isKeying = true;
    this.socketManager.requestPTT();
  }

  triggerPTTOn() {
    if (!this.isTransmitting && !this.isKeying) return;
    if (this.isTransmitting) {
      this.isTransmitting = false;
      this.audioEngine.stopRecording();
      this.socketManager.releasePTT(this.currentTransmissionId);
      this.audioEngine.playPTTEndSquelchTail();
    }
    this.isKeying = false;
    this.updatePTTCardState('IDLE');
  }

  setAudioUnavailable(reason) {
    const pttBtn = document.getElementById('ptt-btn');
    const instruction = document.getElementById('ptt-instruction');
    const supportWarning = document.getElementById('audio-support-warning');

    pttBtn.disabled = true;
    instruction.textContent = 'Audio unavailable for this session.';
    instruction.style.color = 'var(--color-tactical-amber)';
    supportWarning.textContent = reason;
    supportWarning.classList.remove('d-none');
  }

  handleCreateResponse(data) {
    if (data.success) {
      document.getElementById('generated-pin').textContent = data.pin;
      document.getElementById('create-success-box').classList.remove('d-none');
    } else {
      alert(`Failed to create net session: ${data.reason}`);
    }
  }

  handleJoinResponse(data) {
    if (data.success) {
      this.myStationId = data.stationId;
      this.myRole = data.role;
      
      const currentPin = (document.getElementById('join-pin').value.trim() || document.getElementById('generated-pin').textContent.trim() || this.netPin || '').toUpperCase();
      this.netPin = currentPin;

      if (currentPin) {
        this.saveSession(currentPin, this.myNickname, this.myRole, this.myStationId);
        const headerPinBadge = document.getElementById('header-net-pin');
        if (headerPinBadge) {
          headerPinBadge.textContent = `PIN: ${currentPin}`;
        }
      }

      // Shift landing screens
      document.getElementById('landing-section').classList.add('d-none');
      document.getElementById('dashboard-section').classList.remove('d-none');

      // Update basic details
      document.getElementById('overlay-nickname').textContent = this.myNickname;

      if (this.myRole === 'CONTROL' || this.myRole === 'INSTRUCTOR') {
        // Unlock full dashboard directly (Instructor lacks Callsign lock)
        document.getElementById('callsign-lock-overlay').classList.add('d-none');
        document.getElementById('header-callsign').textContent = `Callsign: CONTROL`;
        if (WebAudioEngine.isMediaCaptureSupported()) {
          document.getElementById('ptt-btn').disabled = false;
        }
        
        // Show Instructor Dashboard controls
        document.getElementById('instructor-section').classList.remove('d-none');
        
        // Populate Instructor Details
        document.getElementById('instructor-pin-badge').textContent = `PIN: ${currentPin || 'HOST'}`;

        
        // Setup Instructor Session controls
        document.getElementById('btn-end-session').addEventListener('click', () => {
          if (confirm("Are you sure you want to end this Net Session? All students will be kicked.")) {
            this.socketManager.endSession();
          }
        });

        document.getElementById('btn-trigger-radio-check').addEventListener('click', () => {
          this.socketManager.startRadioCheck();
        });
      } else {
        // Initial student join. UI locked awaiting callsign
        document.getElementById('callsign-lock-overlay').classList.remove('d-none');
      }
    } else {
      alert(`Join Failed: ${data.reason}`);
    }
  }

  handleCallsignAssigned(data) {
    if (data.success) {
      this.myCallSign = data.assignedCallSign;
      this.myRole = data.role;
      this.netId = data.netSession.netId;
      this.netName = data.netSession.netName;
      this.netState = data.netSession.netState;

      // Unlock dashboard
      document.getElementById('callsign-lock-overlay').classList.add('d-none');
      document.getElementById('header-net-name').textContent = `Net: ${this.netName}`;
      document.getElementById('header-net-name').classList.remove('d-none');
      document.getElementById('header-callsign').textContent = `Callsign: ${this.myCallSign}`;
      if (WebAudioEngine.isMediaCaptureSupported()) {
        document.getElementById('ptt-btn').disabled = false;
        // Pre-warm microphone stream in background so PTT keydown capture is instantaneous
        this.audioEngine.ensureMicStream().catch(err => {
          console.warn("Background microphone pre-warm warning:", err);
        });
      }

      // Initialize logs management
      this.logsheetManager.initialize();
    }
  }

  handlePTTResponse(data) {
    if (data.allowed) {
      if (!this.isKeying && !this.isTransmitting) {
        // User already released mouse/key before server response arrived
        this.socketManager.releasePTT(data.transmissionId);
        this.isKeying = false;
        return;
      }

      this.isTransmitting = true;
      this.currentTransmissionId = data.transmissionId;
      
      // Step 1: Immediately show KEYING state (Amber)
      this.updatePTTCardState('KEYING');
      
      // Step 2: Start recording (mic is pre-warmed, 0ms lag)
      this.audioEngine.startRecording(data.transmissionId).catch((e) => {
        console.error('PTT start recording failed:', e);
        this.setAudioUnavailable(e.message || 'Unable to access microphone.');
        this.triggerPTTOn(); // revert if mic permissions fail
        this.updatePTTCardState('IDLE');
        return;
      });

      // Step 3: Enforce 300ms PTT Pre-Delay transition to TRANSMITTING - SPEAK NOW (Red)
      setTimeout(() => {
        if (this.isTransmitting) {
          this.updatePTTCardState('TRANSMITTING');
          this.audioEngine.playPTTStartChirp();
        }
      }, 300);
    } else {
      // Access denied (Channel busy)
      this.isKeying = false;
      this.audioEngine.playPTTEndSquelchTail(); // Play block buzz/crackle sound
      this.updatePTTCardState('BLOCKED', data.reason);
      setTimeout(() => this.updatePTTCardState('IDLE'), 2000);
    }
  }

  handlePTTOverride(data) {
    // Current transmission was terminated forcibly by NCS Control override
    this.isTransmitting = false;
    this.audioEngine.stopRecording();
    
    // Play static overridden alert noise
    this.audioEngine.playPTTEndSquelchTail();
    this.updatePTTCardState('OVERRIDDEN');
    
    setTimeout(() => {
      this.updatePTTCardState('IDLE');
    }, 2000);
  }

  handleRosterUpdate(stations) {
    const list = document.getElementById('roster-list');
    list.innerHTML = '';

    const instructorRoster = document.getElementById('instructor-roster-tbody');
    const admissionsQueue = document.getElementById('admissions-tbody');
    
    if (instructorRoster) instructorRoster.innerHTML = '';
    if (admissionsQueue) admissionsQueue.innerHTML = '';

    let activeSpeakerFound = false;
    let pendingQueueCount = 0;

    stations.forEach(s => {
      // 1. Build Student view roster panel
      // Only connected stations with assigned call signs are visible to standard students
      if (s.status === 'CONNECTED' && s.callSign) {
        const item = document.createElement('div');
        item.className = 'list-group-item d-flex align-items-center justify-content-between py-2';
        
        let statusBadge = `<span class="badge border border-secondary text-secondary small">IDLE</span>`;
        if (s.transmissionStatus === 'TRANSMITTING') {
          item.classList.add('active-speaking');
          statusBadge = `<span class="badge bg-danger text-white small">TALKING</span>`;
          
          this.activeSpeaker = s.callSign;
          document.getElementById('active-speaker').textContent = `${s.callSign} (${s.nickname})`;
          this.updatePTTCardState('RECEIVING', s.callSign);
          activeSpeakerFound = true;
        }

        const roleIcon = s.role === 'CONTROL' ? '⭐ ' : '';
        item.innerHTML = `
          <div>
            <b>${roleIcon}${s.callSign}</b> <span class="text-muted">(${s.nickname})</span>
          </div>
          ${statusBadge}
        `;
        list.appendChild(item);
      }

      // 2. Build Instructor queues
      if (this.myRole === 'CONTROL' || this.myRole === 'INSTRUCTOR') {
        if (s.status === 'AWAITING_ASSIGNMENT') {
          pendingQueueCount++;
          const tr = document.createElement('tr');
          tr.innerHTML = `
            <td>${s.nickname}</td>
            <td>
              <select class="form-select form-select-sm select-assign-role">
                <option value="SUB_STATION">SUB_STATION</option>
                <option value="CONTROL">CONTROL</option>
              </select>
            </td>
            <td>
              <input type="text" class="form-control form-control-sm text-uppercase input-assign-cs" placeholder="e.g. 11" style="width: 80px;">
            </td>
            <td>
              <button class="btn btn-sm btn-tactical btn-assign-student" data-id="${s.stationId}">ASSIGN</button>
            </td>
          `;
          
          // Add assignment trigger click listener
          tr.querySelector('.btn-assign-student').addEventListener('click', (e) => {
            const sid = e.target.getAttribute('data-id');
            const cs = tr.querySelector('.input-assign-cs').value.trim();
            const role = tr.querySelector('.select-assign-role').value;
            if (cs) {
              this.socketManager.assignCallsign(sid, cs, role);
            } else {
              alert("Please enter a numeric/alphanumeric Callsign suffix.");
            }
          });

          admissionsQueue.appendChild(tr);
        } else if (s.status === 'CONNECTED' || s.status === 'MUTED') {
          // Connected active dashboard roster
          const tr = document.createElement('tr');
          tr.innerHTML = `
            <td><b>${s.callSign || 'PENDING'}</b></td>
            <td>${s.nickname}</td>
            <td>${s.role}</td>
            <td>
              <span class="badge ${s.transmissionStatus === 'TRANSMITTING' ? 'bg-danger' : 'bg-secondary'}">
                ${s.transmissionStatus === 'TRANSMITTING' ? 'TALKING' : s.status}
              </span>
            </td>
            <td>
              <button class="btn btn-sm btn-outline-danger btn-kick-student" data-id="${s.stationId}">KICK</button>
            </td>
          `;

          instructorRoster.appendChild(tr);
        }
      }

    });

    if (pendingQueueCount === 0 && admissionsQueue) {
      admissionsQueue.innerHTML = '<tr><td colspan="4" class="text-center text-muted py-3">No students waiting in queue.</td></tr>';
    }

    if (!activeSpeakerFound) {
      this.activeSpeaker = 'None';
      document.getElementById('active-speaker').textContent = 'None';
      
      // If we were receiving, reset to idle
      const container = document.getElementById('ptt-container');
      if (container.classList.contains('ptt-card-receiving')) {
        this.updatePTTCardState('IDLE');
      }
    }

    // Update Allocation summary reference modal rows
    this.updateAllocationModal(stations);
  }

  updatePTTCardState(state, infoText = '') {
    const container = document.getElementById('ptt-container');
    const stateText = document.getElementById('ptt-state-text');
    const instruction = document.getElementById('ptt-instruction');
    const pttBtn = document.getElementById('ptt-btn');
    
    // Reset all status border color overrides
    container.className = "card mb-3 shadow-sm position-relative";
    
    if (state === 'IDLE') {
      container.classList.add('ptt-card-idle');
      stateText.textContent = "RADIO SYSTEM IDLE";
      stateText.style.color = "var(--color-phosphor-green)";
      instruction.textContent = "Hold SPACEBAR or push circular dial to speak";
      pttBtn.classList.remove('active', 'btn-danger');
      this.audioEngine.clearPlaybackQueue();
      
    } else if (state === 'KEYING') {
      container.classList.add('ptt-card-transmitting');
      stateText.innerHTML = `<span class="badge bg-warning text-dark me-2">KEYING</span>STANDBY...`;
      stateText.style.color = "var(--color-tactical-amber)";
      instruction.textContent = "Keying channel... Wait 1 second before speaking";
      pttBtn.classList.add('active');

    } else if (state === 'TRANSMITTING') {
      container.classList.add('ptt-card-transmitting');
      stateText.innerHTML = `<span class="pulse-indicator"></span>TRANSMITTING — SPEAK NOW`;
      stateText.style.color = "var(--color-hot-red)";
      instruction.textContent = "Microphone active... Speak now. Release key when finished speaking";
      pttBtn.classList.add('active');
      
    } else if (state === 'RECEIVING') {
      container.classList.add('ptt-card-receiving');
      stateText.textContent = `RECEIVING: ${infoText.toUpperCase()}`;
      stateText.style.color = "var(--color-tactical-amber)";
      instruction.textContent = "Frequency locked... Voice transmission disabled";
      pttBtn.classList.remove('active');
      
    } else if (state === 'OVERRIDDEN') {
      container.classList.add('ptt-card-overridden');
      stateText.textContent = "PTT OVERRIDDEN BY CONTROL";
      stateText.style.color = "#ffffff";
      instruction.textContent = "Channel locked. Control station break-in active.";
      pttBtn.classList.remove('active');
      
    } else if (state === 'BLOCKED') {
      container.classList.add('ptt-card-idle');
      stateText.textContent = "TRANSMISSION BLOCKED";
      stateText.style.color = "var(--color-tactical-amber)";
      instruction.textContent = infoText || "Channel busy... wait for frequency to clear";
    }
  }



  handleRadioCheckStatus(data) {
    const badge = document.getElementById('check-status-badge');
    const responder = document.getElementById('check-active-responder');
    const timer = document.getElementById('check-timer');
    
    if (data.inProgress) {
      badge.textContent = "ACTIVE";
      badge.className = "badge bg-danger";
      responder.textContent = data.activeCallSign;
      timer.textContent = `${data.timerRemainingSeconds}s`;

      // Visual cues for students (if it's my turn to answer)
      if (this.myCallSign === data.activeCallSign) {
        // Show a flashing prompt or modify state details
        document.getElementById('ptt-instruction').textContent = "⚠️ YOUR TURN TO ANSWER Collective Check! Hold PTT.";
        document.getElementById('ptt-instruction').style.color = "var(--color-tactical-amber)";
      } else {
        document.getElementById('ptt-instruction').style.color = "var(--color-muted-gray)";
      }
    } else {
      badge.textContent = "IDLE";
      badge.className = "badge bg-secondary";
      responder.textContent = "None";
      timer.textContent = "-";
      document.getElementById('ptt-instruction').style.color = "var(--color-muted-gray)";
    }
  }

  updateAllocationModal(stations) {
    const tbody = document.getElementById('allocation-table-tbody');
    tbody.innerHTML = '';

    const sorted = [...stations].sort((a,b) => (a.callSign || '').localeCompare(b.callSign || ''));
    sorted.forEach(s => {
      if (s.status === 'CONNECTED' && s.callSign) {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td><b>${s.callSign}</b></td>
          <td>${s.nickname}</td>
          <td>${s.role}</td>
          <td><span class="text-success">${s.status}</span></td>
        `;
        tbody.appendChild(tr);
      }
    });

    if (tbody.innerHTML === '') {
      tbody.innerHTML = '<tr><td colspan="4" class="text-center text-muted">No active allocations.</td></tr>';
    }
  }

  togglePaperMode() {
    this.paperMode = !this.paperMode;
    const logWrapper = document.getElementById('logsheet-wrapper');
    const paperOverlay = document.getElementById('paper-mode-overlay');
    const btn = document.getElementById('btn-paper-mode');
    
    if (this.paperMode) {
      logWrapper.classList.add('d-none');
      paperOverlay.classList.remove('d-none');
      btn.textContent = "📝 SCREEN LOG: OFF (PAPER)";
      btn.classList.replace('btn-outline-tactical', 'btn-outline-warning');
    } else {
      logWrapper.classList.remove('d-none');
      paperOverlay.classList.add('d-none');
      btn.textContent = "📝 SCREEN LOG: ON";
      btn.classList.replace('btn-outline-warning', 'btn-outline-tactical');
    }
  }

  updateDTGClock() {
    const d = new Date();
    const day = String(d.getUTCDate()).padStart(2, '0');
    const hr = String(d.getUTCHours()).padStart(2, '0');
    const min = String(d.getUTCMinutes()).padStart(2, '0');
    
    const months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
    const mon = months[d.getUTCMonth()];
    const yr = String(d.getUTCFullYear()).substring(2);
    
    document.getElementById('system-clock').textContent = `${day}${hr}${min}Z ${mon} ${yr}`;
  }

  resetToLanding() {
    this.clearSavedSession();
    this.netId = null;
    this.myStationId = null;
    this.myCallSign = null;
    this.netPin = null;
    
    document.getElementById('dashboard-section').classList.add('d-none');
    document.getElementById('landing-section').classList.remove('d-none');
    document.getElementById('join-pin').value = '';
    document.getElementById('create-success-box').classList.add('d-none');
    const headerPinBadge = document.getElementById('header-net-pin');
    if (headerPinBadge) {
      headerPinBadge.textContent = 'PIN: ----';
    }
  }

}

// Instantiate and initialize the app
document.addEventListener('DOMContentLoaded', () => {
  const app = new VirtualNetApp();
  window.virtualNetApp = app; // globally bind for console debug
  app.init();
});
