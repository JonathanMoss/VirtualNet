// Main Application Coordinator Module - VirtualNet

import { SocketManager } from './socket.js';
import { formatDTG } from './utils.js';
import { ResourcesManager } from './resources.js';
import { WebAudioEngine } from './audio.js';
import { TelemetryManager } from './telemetry.js';
import { showAlert, showConfirm, showPrompt } from './dialog.js';

import { SYSTEM_CONSTANTS } from './constants.js';
import { RosterController } from './controllers/roster_controller.js';
import { SunrayController } from './controllers/sunray_controller.js';
import { LogsheetController } from './controllers/logsheet_controller.js';
import { PTTController } from './controllers/ptt_controller.js';

// Global exception & unhandled rejection handler to catch third-party browser extension errors
window.addEventListener('error', (event) => {
  const source = event.filename || '';
  const msg = event.message || '';
  if (source.includes('cs.js') || source.includes('content_chrome') || source.includes('chrome-extension') || msg.includes('disconnected port') || msg.includes('Receiving end does not exist')) {
    console.warn('⚠️ Ignored third-party browser extension script error:', msg);
    if (typeof event.preventDefault === 'function') event.preventDefault();
    return true;
  }
});

window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason ? String(event.reason) : '';
  if (reason.includes('disconnected port') || reason.includes('Receiving end does not exist')) {
    console.warn('⚠️ Ignored third-party browser extension promise rejection:', reason);
    if (typeof event.preventDefault === 'function') event.preventDefault();
  }
});

export class VirtualNetApp {
  constructor() {
    this.socketManager = new SocketManager(this);
    this.resourcesManager = new ResourcesManager();
    this.audioEngine = new WebAudioEngine(this);
    this.telemetryManager = new TelemetryManager(this);

    // Modular Sub-Controllers
    this.rosterController = new RosterController(this);
    this.sunrayController = new SunrayController(this);
    this.logsheetController = new LogsheetController(this);
    this.pttController = new PTTController(this);

    // Global session variables
    this.netId = null;
    this.netName = null;
    this.netPin = null;
    this.netState = 'DIRECTED';
    this.myStationId = null;
    this.myCallSign = null;
    this.myNickname = null;
    this.myRole = SYSTEM_CONSTANTS.DEFAULT_ROLE;

    this.activeSpeaker = 'None';
    this.currentTransmissionId = null;
    this.isTransmitting = false;
    this._isKeying = false;
    window.app = this;
  }

  get isKeying() {
    return this._isKeying;
  }

  set isKeying(val) {
    this._isKeying = !!val;
  }

  init() {
    // 1. Setup UI forms triggers
    this.setupLandingForms();

    // 2. Setup System Clock updates (Date-Time-Group)
    setInterval(() => this.updateDTGClock(), SYSTEM_CONSTANTS.SYSTEM_CLOCK_INTERVAL_MS);
    this.updateDTGClock();

    // 3. Setup Reference Resource Sub-panels
    this.resourcesManager.initialize();

    // 4. Setup PTT UI Handlers & Mobile triggers
    this.pttController.setupPTTHandlers();

    // 4b. Setup Audio Telemetry HUD & VU Meter
    this.telemetryManager.init();

    // 5. Setup Collapsible Card Toggles
    this.rosterController.setupFoldToggle();
    this.sunrayController.setupFoldToggle();
    this.sunrayController.setupSessionEndTrigger();
    this.logsheetController.setupLogsheetTable();

    this.setupPTTMinimiseToggle();
    this.setupHeaderCollapseToggle();

    // 6. Connect Socket
    this.socketManager.connect();

    // 7. Setup Leave Net & Change Callsign buttons
    const btnLeave = document.getElementById('btn-leave-net');
    if (btnLeave) {
      btnLeave.addEventListener('click', async () => {
        const confirmed = await showConfirm("Are you sure you want to leave this Net session?", {
          title: "LEAVE NET SESSION",
          confirmText: "LEAVE NET",
          confirmClass: "btn btn-danger btn-sm text-uppercase font-weight-bold"
        });
        if (confirmed) {
          this.socketManager.leaveNet();
          this.clearSavedSession();
          this.resetToLanding();
        }
      });
    }

    const btnChangeCs = document.getElementById('btn-change-callsign');
    if (btnChangeCs) {
      btnChangeCs.addEventListener('click', async () => {
        if (!this.myStationId) return;
        const newCs = await showPrompt("Enter new Call Sign or Suffix for station:", this.myCallSign || '', {
          title: "MODIFY CALLSIGN",
          placeholder: "e.g. R11A"
        });
        if (newCs && newCs.trim() !== '') {
          this.socketManager.assignCallsign(this.myStationId, newCs.trim().toUpperCase(), this.myRole);
        }
      });
    }

    // 8. Check for saved session persistence and auto-reconnect
    const saved = this.loadSavedSession();
    if (saved && saved.pin && saved.nickname) {
      console.log("Restoring active session from storage/cookie:", saved);
      this.myNickname = saved.nickname;
      this.myRole = saved.role || SYSTEM_CONSTANTS.DEFAULT_ROLE;
      this.myStationId = saved.stationId || null;
      this.socketManager.joinNet(saved.pin, saved.nickname, saved.role, saved.stationId);
    }
  }

  saveSession(pin, nickname, role, stationId, callSign = null) {
    try {
      const data = { pin, nickname, role, stationId, callSign, timestamp: Date.now() };
      sessionStorage.setItem(SYSTEM_CONSTANTS.SESSION_STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
      console.warn("Failed to save session credentials:", e);
    }
  }

  loadSavedSession() {
    try {
      const sessionStr = sessionStorage.getItem(SYSTEM_CONSTANTS.SESSION_STORAGE_KEY);
      if (!sessionStr) return null;
      const data = JSON.parse(sessionStr);
      if (Date.now() - data.timestamp > SYSTEM_CONSTANTS.SESSION_MAX_AGE_MS) {
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
      sessionStorage.removeItem('virtualnet_session');
    } catch (e) {
      // Ignored
    }
  }

  setupLandingForms() {
    const viewJoin = document.getElementById('join-net-card');
    const viewCreate = document.getElementById('create-net-card');
    const toggleCreate = document.getElementById('toggle-create-view');
    const toggleJoin = document.getElementById('toggle-join-view');

    if (toggleCreate) {
      const handleToggleCreate = (e) => {
        if (e) {
          e.preventDefault();
          if (e.stopPropagation) e.stopPropagation();
        }
        if (viewJoin) viewJoin.classList.add('d-none');
        if (viewCreate) viewCreate.classList.remove('d-none');
        const createForm = document.getElementById('create-net-form');
        if (createForm) createForm.classList.remove('d-none');
      };
      toggleCreate.addEventListener('click', handleToggleCreate);
      toggleCreate.addEventListener('pointerdown', handleToggleCreate);
    }

    if (toggleJoin) {
      const handleToggleJoin = (e) => {
        if (e) {
          e.preventDefault();
          if (e.stopPropagation) e.stopPropagation();
        }
        if (viewCreate) viewCreate.classList.add('d-none');
        if (viewJoin) viewJoin.classList.remove('d-none');
      };
      toggleJoin.addEventListener('click', handleToggleJoin);
      toggleJoin.addEventListener('pointerdown', handleToggleJoin);
    }

    const submitJoin = async () => {
      const pin = document.getElementById('join-pin').value.trim();
      const nickname = document.getElementById('join-nickname').value.trim();
      if (!pin || !nickname) {
        await showAlert("Please enter both Net PIN and Nickname.", { title: "INPUT REQUIRED" });
        return;
      }
      this.myNickname = nickname;
      this.socketManager.joinNet(pin, nickname);
    };

    const btnJoin = document.getElementById('btn-join-net');
    if (btnJoin) {
      btnJoin.addEventListener('click', (e) => {
        e.preventDefault();
        submitJoin();
      });
    }

    ['join-pin', 'join-nickname'].forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            submitJoin();
          }
        });
      }
    });

    const submitCreate = async () => {
      const name = document.getElementById('create-name').value.trim();
      const instructorPin = document.getElementById('create-instructor-pin').value.trim();
      const sunrayCallsign = (document.getElementById('create-sunray-callsign')?.value || "0").trim();
      if (!name || !instructorPin) {
        await showAlert("Please fill in all Net Session fields.", { title: "INPUT REQUIRED" });
        return;
      }
      this.socketManager.createNet(name, instructorPin, sunrayCallsign);
    };

    const btnCreate = document.getElementById('btn-create-net');
    if (btnCreate) {
      btnCreate.addEventListener('click', (e) => {
        e.preventDefault();
        submitCreate();
      });
    }

    ['create-name', 'create-instructor-pin', 'create-sunray-callsign'].forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            submitCreate();
          }
        });
      }
    });
  }

  setupPTTMinimiseToggle() {
    const container = document.getElementById('ptt-container');
    const header = document.getElementById('ptt-card-header');
    const toggleBtn = document.getElementById('btn-toggle-ptt-panel');
    const toggleIcon = toggleBtn ? toggleBtn.querySelector('.toggle-icon-ptt') : null;

    if (container && header) {
      const toggleMinimise = () => {
        container.classList.toggle('minimised');
        const isMinimised = container.classList.contains('minimised');
        if (toggleIcon) {
          toggleIcon.textContent = isMinimised ? '▼ EXPAND' : '▲ MINIMISE';
        }
        try {
          localStorage.setItem('virtualnet_ptt_minimised', isMinimised ? 'true' : 'false');
        } catch (e) {
          // Ignored
        }
      };

      if (toggleBtn) {
        toggleBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          toggleMinimise();
        });
      }

      header.addEventListener('click', (e) => {
        if (e.target !== toggleBtn) toggleMinimise();
      });

      try {
        if (localStorage.getItem('virtualnet_ptt_minimised') === 'true') {
          toggleMinimise();
        }
      } catch (e) {
        // Ignored
      }
    }
  }

  setupHeaderCollapseToggle() {
    const body = document.getElementById('header-collapse-body');
    const toggleBtn = document.getElementById('btn-toggle-header-details');
    const expandBtn = document.getElementById('btn-expand-header-details');

    if (body) {
      const toggleHeader = () => {
        body.classList.toggle('d-none');
        const isCollapsed = body.classList.contains('d-none');
        if (toggleBtn) {
          const toggleIcon = toggleBtn.querySelector('.toggle-icon-header');
          if (toggleIcon) toggleIcon.textContent = isCollapsed ? '▼ SHOW INFO' : '▲ HIDE INFO';
        }
        if (expandBtn) {
          if (isCollapsed) {
            expandBtn.classList.remove('d-none');
          } else {
            expandBtn.classList.add('d-none');
          }
        }
        try {
          localStorage.setItem('virtualnet_header_collapsed', isCollapsed ? 'true' : 'false');
        } catch (e) {
          // Ignored
        }
      };

      if (toggleBtn) {
        toggleBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          toggleHeader();
        });
      }

      if (expandBtn) {
        expandBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          toggleHeader();
        });
      }

      try {
        if (localStorage.getItem('virtualnet_header_collapsed') === 'true') {
          toggleHeader();
        }
      } catch (e) {
        // Ignored
      }
    }
  }

  setupPTTHandlers() {
    this.pttController.setupPTTHandlers();
  }

  updatePTTCardState(state, infoText = '') {
    this.pttController.updatePTTCardState(state, infoText);
  }

  startTransmission() {
    if (this.isTransmitting) return;
    this.isKeying = true;
    this.socketManager.requestPTT();
  }

  stopTransmission() {
    if (!this.isTransmitting && !this.isKeying) return;
    const txId = this.currentTransmissionId;
    this.isTransmitting = false;
    this.isKeying = false;
    this.audioEngine.stopRecording();
    this.socketManager.releasePTT(txId);
    this.audioEngine.playPTTEndSquelchTail();
    this.updatePTTCardState('IDLE');
  }

  setAudioUnavailable(reason) {
    const pttBtn = document.getElementById('ptt-btn');
    const instruction = document.getElementById('ptt-instruction');
    const supportWarning = document.getElementById('audio-support-warning');

    if (pttBtn) pttBtn.disabled = true;
    if (instruction) {
      instruction.textContent = 'Audio unavailable for this session.';
      instruction.style.color = 'var(--color-tactical-amber)';
    }
    if (supportWarning) {
      supportWarning.textContent = reason;
      supportWarning.classList.remove('d-none');
    }
  }

  handleCreateResponse(data) {
    if (data.success) {
      this.myStationId = data.stationId;
      this.myNickname = "SUNRAY";
      this.myRole = data.role || "SUNRAY";
      this.myCallSign = data.callSign || data.sunrayCallsign || "0";
      this.netId = data.netId;
      this.netName = data.netName;
      this.netPin = data.pin;

      this.saveSession(data.pin, "SUNRAY", this.myRole, data.stationId, this.myCallSign);

      document.getElementById('landing-section').classList.add('d-none');
      document.getElementById('dashboard-section').classList.remove('d-none');
      const instSec = document.getElementById('instructor-section');
      if (instSec) instSec.classList.remove('d-none');
      const lockOverlay = document.getElementById('callsign-lock-overlay');
      if (lockOverlay) lockOverlay.classList.add('d-none');

      const headerPin = document.getElementById('header-net-pin');
      if (headerPin) headerPin.textContent = `PIN: ${data.pin}`;

      const headerName = document.getElementById('header-net-name');
      if (headerName) {
        headerName.textContent = `Net: ${data.netName}`;
        headerName.classList.remove('d-none');
      }

      const headerCallsign = document.getElementById('header-callsign');
      if (headerCallsign) headerCallsign.textContent = `Callsign: ${this.myCallSign}`;

      const btnChangeCs = document.getElementById('btn-change-callsign');
      if (btnChangeCs) btnChangeCs.classList.remove('d-none');

      if (WebAudioEngine.isMediaCaptureSupported()) {
        const pttBtn = document.getElementById('ptt-btn');
        if (pttBtn) pttBtn.disabled = false;
      }
    } else {
      showAlert(`Failed to create net session: ${data.reason}`, { title: "CREATE NET FAILED", titleColor: "var(--color-hot-red)" });
    }
  }

  handleJoinResponse(data) {
    if (data.success) {
      this.myStationId = data.stationId;
      this.myRole = data.role;
      this.myCallSign = data.callSign;
      this.netId = data.netId;
      this.netName = data.netName;
      this.netPin = data.pin;
      this.saveSession(data.pin, this.myNickname, this.myRole, this.myStationId, this.myCallSign);

      const headerPinBadge = document.getElementById('header-net-pin');
      if (headerPinBadge) {
        headerPinBadge.textContent = `PIN: ${data.pin}`;
      }

      const headerName = document.getElementById('header-net-name');
      if (headerName) {
        headerName.textContent = `Net: ${data.netName}`;
        headerName.classList.remove('d-none');
      }

      document.getElementById('landing-section').classList.add('d-none');
      document.getElementById('dashboard-section').classList.remove('d-none');

      const overlayNick = document.getElementById('overlay-nickname');
      if (overlayNick) overlayNick.textContent = this.myNickname;

      const lockOverlay = document.getElementById('callsign-lock-overlay');

      if (this.myRole === 'SUNRAY' || this.myRole === 'CONTROL' || this.myRole === 'INSTRUCTOR') {
        if (lockOverlay) lockOverlay.classList.add('d-none');
        const headerCs = document.getElementById('header-callsign');
        if (headerCs) headerCs.textContent = `Callsign: ${this.myCallSign || '0'}`;
        const btnChangeCs = document.getElementById('btn-change-callsign');
        if (btnChangeCs) btnChangeCs.classList.remove('d-none');

        if (WebAudioEngine.isMediaCaptureSupported()) {
          const pttBtn = document.getElementById('ptt-btn');
          if (pttBtn) pttBtn.disabled = false;
        }

        const instSec = document.getElementById('instructor-section');
        if (instSec) instSec.classList.remove('d-none');
        this.loadSunrayTransmissionHistory(data.pin);

      } else if (data.status === 'CONNECTED' && data.callSign) {
        if (lockOverlay) lockOverlay.classList.add('d-none');
        const headerCs = document.getElementById('header-callsign');
        if (headerCs) headerCs.textContent = `Callsign: ${this.myCallSign}`;
        const btnChangeCs = document.getElementById('btn-change-callsign');
        if (btnChangeCs) btnChangeCs.classList.remove('d-none');
        if (WebAudioEngine.isMediaCaptureSupported()) {
          const pttBtn = document.getElementById('ptt-btn');
          if (pttBtn) pttBtn.disabled = false;
          this.audioEngine.ensureMicStream().catch(err => {
            console.warn("Background microphone pre-warm warning:", err);
          });
        }
      } else {
        if (lockOverlay) lockOverlay.classList.remove('d-none');
      }
    } else {
      console.warn("Join/Rejoin failed:", data.reason);
      this.clearSavedSession();
      this.resetToLanding();
      const reasonMsg = data.reason || "This net session has been closed or timed out.";
      showAlert(`SESSION NO LONGER EXISTS: ${reasonMsg}`, { title: "SESSION NO LONGER EXISTS", titleColor: "var(--color-hot-red)" });
    }
  }

  handleCallsignAssigned(data) {
    if (data.success) {
      this.myCallSign = data.assignedCallSign;
      this.myRole = data.role;
      this.netId = data.netSession.netId;
      this.netName = data.netSession.netName;
      this.netState = data.netSession.netState;

      if (this.netPin) {
        this.saveSession(this.netPin, this.myNickname, this.myRole, this.myStationId, this.myCallSign);
      }

      const lockOverlay = document.getElementById('callsign-lock-overlay');
      if (lockOverlay) lockOverlay.classList.add('d-none');

      const headerName = document.getElementById('header-net-name');
      if (headerName) {
        headerName.textContent = `Net: ${this.netName}`;
        headerName.classList.remove('d-none');
      }

      const headerCs = document.getElementById('header-callsign');
      if (headerCs) headerCs.textContent = `Callsign: ${this.myCallSign}`;

      const btnChangeCs = document.getElementById('btn-change-callsign');
      if (btnChangeCs) btnChangeCs.classList.remove('d-none');

      if (document.activeElement && typeof document.activeElement.blur === 'function') {
        document.activeElement.blur();
      }

      if (WebAudioEngine.isMediaCaptureSupported()) {
        const pttBtn = document.getElementById('ptt-btn');
        if (pttBtn) pttBtn.disabled = false;
        this.audioEngine.ensureMicStream().catch(err => {
          console.warn("Background microphone pre-warm warning:", err);
        });
      }
    }
  }

  handlePTTResponse(data) {
    if (data.allowed) {
      if (!this.isKeying && !this.isTransmitting) {
        this.socketManager.releasePTT(data.transmissionId);
        this.isKeying = false;
        return;
      }

      this.isTransmitting = true;
      this.currentTransmissionId = data.transmissionId;
      this.updatePTTCardState('KEYING');

      this.audioEngine.startRecording(data.transmissionId).catch((e) => {
        console.error('PTT start recording failed:', e);
        this.setAudioUnavailable(e.message || 'Unable to access microphone.');
        this.stopTransmission();
        this.updatePTTCardState('IDLE');
        return;
      });

      setTimeout(() => {
        if (this.isTransmitting) {
          this.updatePTTCardState('TRANSMITTING');
          this.audioEngine.playPTTStartChirp();
        }
      }, 300);
    } else {
      this.isKeying = false;
      this.audioEngine.playPTTEndSquelchTail();
      this.updatePTTCardState('BLOCKED', data.reason);
      setTimeout(() => this.updatePTTCardState('IDLE'), SYSTEM_CONSTANTS.UI_RESET_DELAY_MS);
    }
  }

  handlePTTGranted(data) {
    this.isKeying = false;
    this.isTransmitting = true;
    this.currentTransmissionId = data.transmissionId;
    this.updatePTTCardState('TRANSMITTING');
    this.audioEngine.playPTTStartChirp();
    this.audioEngine.startRecording(data.transmissionId);
  }

  handlePTTDenied(data) {
    this.isKeying = false;
    this.isTransmitting = false;
    this.audioEngine.playPTTEndSquelchTail();
    this.updatePTTCardState('BLOCKED', data.reason);
    setTimeout(() => this.updatePTTCardState('IDLE'), 2000);
  }

  handlePTTOverride() {
    this.isTransmitting = false;
    this.audioEngine.stopRecording();
    this.audioEngine.playPTTEndSquelchTail();
    this.updatePTTCardState('OVERRIDDEN');
    setTimeout(() => this.updatePTTCardState('IDLE'), 2000);
  }

  handlePTTTimeout() {
    this.isTransmitting = false;
    this.audioEngine.stopRecording();
    this.audioEngine.playPTTEndSquelchTail();
    this.pttController.showDFAlertBanner();
    this.updatePTTCardState('OVERRIDDEN');
    setTimeout(() => this.updatePTTCardState('IDLE'), 2000);
  }

  handlePTTReleased() {
    if (!this.isTransmitting && !this.isKeying) {
      if (this.pttController && this.pttController.state === 'RECEIVING') {
        this.updatePTTCardState('IDLE');
      }
    }
  }

  handleRosterUpdate(stations) {
    this.rosterController.renderRoster(stations);
    this.sunrayController.renderInstructorRoster(stations);

    if (stations && Array.isArray(stations)) {
      const myStation = stations.find(s => s.id === this.myStationId || s.stationId === this.myStationId);
      if (myStation && (myStation.callSign || myStation.call_sign)) {
        const newCs = myStation.callSign || myStation.call_sign;
        if (newCs && newCs !== 'AWAITING') {
          this.myCallSign = newCs;
          const headerCs = document.getElementById('header-callsign');
          if (headerCs) headerCs.textContent = `Callsign: ${this.myCallSign}`;
          const btnChangeCs = document.getElementById('btn-change-callsign');
          if (btnChangeCs) btnChangeCs.classList.remove('d-none');
        }
      }

      const activeSpeaker = stations.find(s => (s.transmission_status === 'TRANSMITTING' || s.transmissionStatus === 'TRANSMITTING' || s.status === 'TALKING') && s.id !== this.myStationId);
      if (activeSpeaker) {
        this.updatePTTCardState('RECEIVING', activeSpeaker.call_sign || activeSpeaker.callSign || 'STATION');
      } else if (!this.isTransmitting && !this.isKeying) {
        if (this.pttController && this.pttController.state === 'RECEIVING') {
          this.updatePTTCardState('IDLE');
        }
      }
    }
  }

  handleAdmissionsQueueUpdate(queue) {
    this.sunrayController.renderAdmissionsQueue(queue);
  }

  updateDTGClock() {
    const el = document.getElementById('system-clock');
    if (el) el.textContent = formatDTG(new Date());
  }

  async loadSunrayTransmissionHistory(pin) {
    this.sunrayController.loadSunrayTransmissionHistory(pin);
  }

  handleSunrayTxLog(data) {
    this.sunrayController.handleSunrayTxLog(data);
  }

  resetToLanding() {
    this.clearSavedSession();
    this.netId = null;
    this.myStationId = null;
    this.myCallSign = null;
    this.netPin = null;

    const dashSec = document.getElementById('dashboard-section');
    if (dashSec) dashSec.classList.add('d-none');

    const landSec = document.getElementById('landing-section');
    if (landSec) landSec.classList.remove('d-none');

    const instSec = document.getElementById('instructor-section');
    if (instSec) instSec.classList.add('d-none');

    const lockOverlay = document.getElementById('callsign-lock-overlay');
    if (lockOverlay) lockOverlay.classList.add('d-none');

    const joinPin = document.getElementById('join-pin');
    if (joinPin) joinPin.value = '';

    const headerPinBadge = document.getElementById('header-net-pin');
    if (headerPinBadge) headerPinBadge.textContent = 'PIN: ----';

    const headerCallsign = document.getElementById('header-callsign');
    if (headerCallsign) headerCallsign.textContent = 'Callsign: AWAITING';

    const btnChangeCs = document.getElementById('btn-change-callsign');
    if (btnChangeCs) btnChangeCs.classList.add('d-none');

    const headerName = document.getElementById('header-net-name');
    if (headerName) headerName.textContent = 'Net: -';

    const pttBtn = document.getElementById('ptt-btn');
    if (pttBtn) pttBtn.disabled = true;

    if (this.pttController) {
      this.updatePTTCardState('IDLE');
    }
  }
}

function bootApp() {
  if (!window.virtualNetApp) {
    const app = new VirtualNetApp();
    window.virtualNetApp = app;
    app.init();
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootApp);
} else {
  bootApp();
}
