// Main Application Coordinator Module - VirtualNet

import { SocketManager } from './socket.js';
import { formatDTG } from './utils.js';
import { ResourcesManager } from './resources.js';
import { WebAudioEngine } from './audio.js';
import { TelemetryManager } from './telemetry.js';
import { showAlert, showConfirm } from './dialog.js';

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
    this.isKeying = false;
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

    // 7. Setup Leave Net button
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

  saveSession(pin, nickname, role, stationId) {
    try {
      const data = { pin, nickname, role, stationId, timestamp: Date.now() };
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
    const card = document.getElementById('ptt-container');
    const toggleBtn = document.getElementById('btn-toggle-ptt-panel');
    const header = document.getElementById('ptt-card-header');

    if (card && toggleBtn && header) {
      const togglePTT = () => {
        card.classList.toggle('collapsed');
        const isCollapsed = card.classList.contains('collapsed');
        try {
          localStorage.setItem('virtualnet_ptt_collapsed', isCollapsed ? 'true' : 'false');
        } catch (e) {
          // Ignored
        }
        toggleBtn.textContent = isCollapsed ? '[+]' : '[-]';
      };

      header.addEventListener('click', (e) => {
        if (e.target !== toggleBtn) togglePTT();
      });
      toggleBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        togglePTT();
      });

      try {
        if (localStorage.getItem('virtualnet_ptt_collapsed') === 'true') {
          card.classList.add('collapsed');
          toggleBtn.textContent = '[+]';
        }
      } catch (e) {
        // Ignored
      }
    }
  }

  setupHeaderCollapseToggle() {
    const headerBar = document.getElementById('app-header-bar');
    const toggleBtn = document.getElementById('btn-toggle-header-details');
    if (headerBar && toggleBtn) {
      toggleBtn.addEventListener('click', () => {
        headerBar.classList.toggle('collapsed');
        toggleBtn.textContent = headerBar.classList.contains('collapsed') ? '▲' : '▼';
      });
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
    this.socketManager.requestPTT();
  }

  stopTransmission() {
    if (!this.isTransmitting && !this.isKeying) return;
    this.isTransmitting = false;
    this.isKeying = false;
    this.audioEngine.stopRecording();
    this.socketManager.releasePTT();
    this.audioEngine.playPTTEndSquelchTail();
    this.updatePTTCardState('IDLE');
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

  handleRosterUpdate(stations) {
    this.rosterController.renderRoster(stations);
    this.sunrayController.renderInstructorRoster(stations);
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

    document.getElementById('dashboard-section').classList.add('d-none');
    document.getElementById('landing-section').classList.remove('d-none');
    const joinPin = document.getElementById('join-pin');
    if (joinPin) joinPin.value = '';

    const headerPinBadge = document.getElementById('header-net-pin');
    if (headerPinBadge) {
      headerPinBadge.textContent = 'PIN: ----';
    }
  }
}

// Instantiate and initialize the app
document.addEventListener('DOMContentLoaded', () => {
  const app = new VirtualNetApp();
  window.virtualNetApp = app;
  app.init();
});
