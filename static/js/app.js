// Main Application Coordinator Module - VirtualNet

import { SocketManager } from './socket.js';
import { formatDTG } from './utils.js';
import { AideMemoireManager } from './aide_memoire.js';
import { WebAudioEngine } from './audio.js';
import { showAlert, showConfirm, showPrompt } from './dialog.js';

// Global exception & unhandled rejection handler to catch third-party browser extension errors (e.g. content_chrome.js / cs.js disconnected port errors)
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

class VirtualNetApp {
  constructor() {
    this.socketManager = new SocketManager(this);
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
    
    // 5. Setup NET Roster sidebar fold/unfold trigger
    this.setupRosterFoldToggle();
    this.setupSunrayFoldToggle();
    this.setupPTTMinimiseToggle();

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
      this.myRole = saved.role || 'SUB_STATION';
      this.myStationId = saved.stationId || null;
      this.socketManager.joinNet(saved.pin, saved.nickname, saved.role, saved.stationId);
    }
  }

  saveSession(pin, nickname, role, stationId) {
    try {
      const data = { pin, nickname, role, stationId, timestamp: Date.now() };
      const sessionStr = JSON.stringify(data);
      sessionStorage.setItem('virtualnet_session', sessionStr);
    } catch (e) {
      console.warn("Failed to save session credentials:", e);
    }
  }

  loadSavedSession() {
    try {
      const sessionStr = sessionStorage.getItem('virtualnet_session');
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

    // Toggle login screen links
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

    // Student Join Net trigger
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

    // SUNRAY Create Net trigger
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

    // Host Success dashboard transition click & pointerdown
    const btnGoInst = document.getElementById('btn-go-instructor');
    if (btnGoInst) {
      const handleInstructorTransition = (e) => {
        if (e) {
          e.preventDefault();
          if (e.stopPropagation) e.stopPropagation();
          if (e.stopImmediatePropagation) e.stopImmediatePropagation();
        }
        try {
          const pin = document.getElementById('generated-pin').textContent.trim();
          this.myNickname = "SUNRAY";
          this.myRole = "SUNRAY";
          this.netPin = pin;
          this.socketManager.joinNet(pin, "SUNRAY", "SUNRAY");
        } catch (err) {
          console.warn("SUNRAY dashboard transition error:", err);
        }
      };

      btnGoInst.addEventListener('pointerdown', handleInstructorTransition);
      btnGoInst.addEventListener('click', handleInstructorTransition);
    }
  }

  setupRosterFoldToggle() {
    const sidebar = document.getElementById('net-roster-sidebar');
    const toggleBtn = document.getElementById('btn-toggle-roster');
    const header = document.getElementById('roster-card-header');

    if (sidebar && toggleBtn && header) {
      const toggleRoster = () => {
        sidebar.classList.toggle('collapsed');
        const isCollapsed = sidebar.classList.contains('collapsed');
        try {
          localStorage.setItem('virtualnet_roster_collapsed', isCollapsed ? 'true' : 'false');
        } catch (e) {
          // Ignored
        }
      };

      toggleBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleRoster();
      });

      header.addEventListener('click', () => {
        if (sidebar.classList.contains('collapsed')) {
          toggleRoster();
        }
      });

      // Restore collapsed preference or default to collapsed on small mobile screens (<768px)
      try {
        const pref = localStorage.getItem('virtualnet_roster_collapsed');
        if (pref === 'true' || (pref === null && window.innerWidth < 768)) {
          sidebar.classList.add('collapsed');
        }
      } catch (e) {
        if (window.innerWidth < 768) {
          sidebar.classList.add('collapsed');
        }
      }
    }
  }

  setupSunrayFoldToggle() {
    const header = document.getElementById('sunray-card-header');
    const toggleBtn = document.getElementById('btn-toggle-sunray-panel');
    const body = document.getElementById('sunray-collapse-body');

    if (header && body) {
      const toggleSunray = () => {
        header.classList.toggle('collapsed');
        body.classList.toggle('d-none');
      };

      if (toggleBtn) {
        toggleBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          toggleSunray();
        });
      }

      header.addEventListener('click', () => {
        toggleSunray();
      });
    }
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

      header.addEventListener('click', () => {
        toggleMinimise();
      });

      // Restore saved preference
      try {
        if (localStorage.getItem('virtualnet_ptt_minimised') === 'true') {
          container.classList.add('minimised');
          if (toggleIcon) toggleIcon.textContent = '▼ EXPAND';
        }
      } catch (e) {
        // Ignored
      }
    }
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
      this.myStationId = data.stationId;
      this.myNickname = "SUNRAY";
      this.myRole = data.role || "SUNRAY";
      this.myCallSign = data.callSign || data.sunrayCallsign || "0";
      this.netId = data.netId;
      this.netName = data.netName;
      this.netPin = data.pin;

      // Save session cookie
      this.saveSession(data.pin, "SUNRAY", this.myRole, data.stationId);

      // Transition to Dashboard directly
      document.getElementById('generated-pin').textContent = data.pin;
      document.getElementById('landing-section').classList.add('d-none');
      document.getElementById('dashboard-section').classList.remove('d-none');
      document.getElementById('instructor-section').classList.remove('d-none');
      document.getElementById('callsign-lock-overlay').classList.add('d-none');

      document.getElementById('header-net-pin').textContent = `PIN: ${data.pin}`;
      document.getElementById('header-net-name').textContent = `Net: ${data.netName}`;
      document.getElementById('header-net-name').classList.remove('d-none');
      document.getElementById('header-callsign').textContent = `Callsign: ${this.myCallSign}`;
      const pinBadgeCreate = document.getElementById('instructor-pin-badge');
      if (pinBadgeCreate) {
        pinBadgeCreate.textContent = `PIN: ${data.pin}`;
      }

      if (WebAudioEngine.isMediaCaptureSupported()) {
        document.getElementById('ptt-btn').disabled = false;
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

      this.saveSession(data.pin, this.myNickname, this.myRole, this.myStationId);
      
      const headerPinBadge = document.getElementById('header-net-pin');
      if (headerPinBadge) {
        headerPinBadge.textContent = `PIN: ${data.pin}`;
      }

      const headerName = document.getElementById('header-net-name');
      if (headerName) {
        headerName.textContent = `Net: ${data.netName}`;
        headerName.classList.remove('d-none');
      }

      // Shift landing screens
      document.getElementById('landing-section').classList.add('d-none');
      document.getElementById('dashboard-section').classList.remove('d-none');

      // Update basic details
      document.getElementById('overlay-nickname').textContent = this.myNickname;

      if (this.myRole === 'SUNRAY' || this.myRole === 'CONTROL' || this.myRole === 'INSTRUCTOR') {
        // Unlock full dashboard directly (SUNRAY lacks Callsign lock)
        document.getElementById('callsign-lock-overlay').classList.add('d-none');
        document.getElementById('header-callsign').textContent = `Callsign: ${this.myCallSign || '0'}`;
        if (WebAudioEngine.isMediaCaptureSupported()) {
          document.getElementById('ptt-btn').disabled = false;
        }
        
        // Show SUNRAY Dashboard controls
        document.getElementById('instructor-section').classList.remove('d-none');
        const pinBadgeJoin = document.getElementById('instructor-pin-badge');
        if (pinBadgeJoin) {
          pinBadgeJoin.textContent = `PIN: ${data.pin}`;
        }
        
        // Setup Instructor Session controls
        const endBtn = document.getElementById('btn-end-session');
        if (endBtn && !endBtn.dataset.bound) {
          endBtn.dataset.bound = "true";
          endBtn.addEventListener('click', async () => {
            const confirmed = await showConfirm("Are you sure you want to end this Net Session? All students will be kicked.", {
              title: "END NET SESSION",
              confirmText: "END SESSION",
              confirmClass: "btn btn-danger btn-sm text-uppercase font-weight-bold"
            });
            if (confirmed) {
              this.socketManager.endSession();
            }
          });
        }


      } else if (data.status === 'CONNECTED' && data.callSign) {
        // Student re-joining with assigned callsign!
        document.getElementById('callsign-lock-overlay').classList.add('d-none');
        document.getElementById('header-callsign').textContent = `Callsign: ${this.myCallSign}`;
        if (WebAudioEngine.isMediaCaptureSupported()) {
          document.getElementById('ptt-btn').disabled = false;
          this.audioEngine.ensureMicStream().catch(err => {
            console.warn("Background microphone pre-warm warning:", err);
          });
        }
      } else {
        // Initial student join. UI locked awaiting callsign
        document.getElementById('callsign-lock-overlay').classList.remove('d-none');
      }
    } else {
      console.warn("Join/Rejoin failed:", data.reason);
      this.clearSavedSession();
      if (document.getElementById('dashboard-section').classList.contains('d-none')) {
        showAlert(`Join Failed: ${data.reason}`, { title: "JOIN FAILED", titleColor: "var(--color-hot-red)" });
      } else {
        showAlert(`Session Ended: ${data.reason}`, { title: "SESSION ENDED", titleColor: "var(--color-hot-red)" });
        this.resetToLanding();
      }
    }
  }

  handleCallsignAssigned(data) {
    if (data.success) {
      this.myCallSign = data.assignedCallSign;
      this.myRole = data.role;
      this.netId = data.netSession.netId;
      this.netName = data.netSession.netName;
      this.netState = data.netSession.netState;

      // Update local session storage / cookie credentials when callsign changes (Issue #26)
      if (this.netPin) {
        this.saveSession(this.netPin, this.myNickname, this.myRole, this.myStationId);
      }

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

  handlePTTTimeout(data) {
    // 20-second max transmission limit exceeded
    this.isTransmitting = false;
    this.audioEngine.stopRecording();
    this.audioEngine.playPTTEndSquelchTail();

    const banner = document.getElementById('df-alert-banner');
    if (banner) {
      banner.classList.remove('d-none');
      setTimeout(() => banner.classList.add('d-none'), 5000);
    }

    this.updatePTTCardState('OVERRIDDEN');
    setTimeout(() => this.updatePTTCardState('IDLE'), 2000);
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

    const isSunrayView = (this.myRole === 'SUNRAY' || this.myRole === 'CONTROL' || this.myRole === 'INSTRUCTOR');

    // Sync current station callsign from active roster
    const me = stations.find(s => s.stationId === this.myStationId);
    if (me && me.callSign) {
      this.myCallSign = me.callSign;
      const headerCallsign = document.getElementById('header-callsign');
      if (headerCallsign) {
        headerCallsign.textContent = `Callsign: ${this.myCallSign}`;
      }
    }

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
          const speakerEl = document.getElementById('active-speaker');
          const speakerBox = document.getElementById('active-speaker-box');
          if (speakerEl) speakerEl.textContent = isSunrayView ? `${s.callSign} (${s.nickname})` : s.callSign;
          if (speakerBox) speakerBox.classList.remove('d-none');
          this.updatePTTCardState('RECEIVING', s.callSign);
          activeSpeakerFound = true;
        }

        const roleIcon = (s.role === 'SUNRAY' || s.role === 'CONTROL') ? '⭐ ' : '';
        const nameHtml = isSunrayView
          ? `<b>${roleIcon}${s.callSign}</b> <span class="text-muted">(${s.nickname})</span>`
          : `<b>${roleIcon}${s.callSign}</b>`;

        item.innerHTML = `
          <div>
            ${nameHtml}
          </div>
          ${statusBadge}
        `;
        list.appendChild(item);
      }

      // 2. Build SUNRAY queues
      if (isSunrayView) {
        if (s.status === 'AWAITING_ASSIGNMENT') {
          pendingQueueCount++;
          const tr = document.createElement('tr');
          tr.innerHTML = `
            <td>${s.nickname}</td>
            <td>
              <select class="form-select form-select-sm select-assign-role">
                <option value="SUB_STATION">SUB_STATION</option>
                <option value="SUNRAY">SUNRAY</option>
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
              showAlert("Please enter a numeric/alphanumeric Callsign suffix.", { title: "INVALID CALLSIGN" });
            }
          });

          admissionsQueue.appendChild(tr);
        } else if (s.status === 'CONNECTED' || s.status === 'MUTED' || s.status === 'UNWORKABLE') {
          // Connected or Temp Inactive (Unworkable) active dashboard roster
          const tr = document.createElement('tr');
          let statusBadgeClass = 'bg-secondary';
          let statusText = s.status;

          if (s.transmissionStatus === 'TRANSMITTING') {
            statusBadgeClass = 'bg-danger';
            statusText = 'TALKING';
          } else if (s.status === 'UNWORKABLE') {
            statusBadgeClass = 'bg-warning text-dark';
            statusText = `UNWORKABLE (${s.lastActiveAgo || 'Inactive'})`;
          } else if (s.status === 'CONNECTED') {
            statusBadgeClass = 'bg-success';
            statusText = `ACTIVE (${s.lastActiveAgo || 'Active'})`;
          }

          tr.innerHTML = `
            <td><b>${s.callSign || 'PENDING'}</b></td>
            <td>${s.nickname}</td>
            <td>${s.role}</td>
            <td>
              <span class="badge ${statusBadgeClass}">
                ${statusText}
              </span>
            </td>
            <td>
              <button class="btn btn-sm btn-outline-warning btn-change-callsign me-1" data-id="${s.stationId}">CALLSIGN</button>
              <button class="btn btn-sm btn-outline-danger btn-kick-student" data-id="${s.stationId}">KICK</button>
            </td>
          `;

          // Add listener for changing callsign (Issue #26)
          const changeBtn = tr.querySelector('.btn-change-callsign');
          if (changeBtn) {
            changeBtn.addEventListener('click', async () => {
              const currentCS = s.callSign || '';
              const newCS = await showPrompt(`Enter new callsign/suffix for station '${s.nickname}':`, currentCS, {
                title: "CHANGE CALLSIGN",
                confirmText: "ASSIGN"
              });
              if (newCS !== null && newCS.trim() !== '') {
                this.socketManager.assignCallsign(s.stationId, newCS.trim(), s.role);
              }
            });
          }

          // Add listener for kicking student (Issue #26)
          const kickBtn = tr.querySelector('.btn-kick-student');
          if (kickBtn) {
            kickBtn.addEventListener('click', async () => {
              const confirmed = await showConfirm(`Are you sure you want to kick station '${s.callSign || s.nickname}' from the net session?`, {
                title: "KICK STATION",
                confirmText: "KICK STATION",
                confirmClass: "btn btn-danger btn-sm text-uppercase font-weight-bold"
              });
              if (confirmed) {
                this.socketManager.kickStation(s.stationId);
              }
            });
          }

          instructorRoster.appendChild(tr);
        }
      }

    });

    if (pendingQueueCount === 0 && admissionsQueue) {
      admissionsQueue.innerHTML = '<tr><td colspan="4" class="text-center text-muted py-3">No students waiting in queue.</td></tr>';
    }

    // Issue #25: Slowly flash NET column header whilst there is anyone in the callsign assignment queue
    const rosterHeader = document.getElementById('roster-card-header');
    if (rosterHeader) {
      if (isSunrayView && pendingQueueCount > 0) {
        rosterHeader.classList.add('slow-flash-header');
      } else {
        rosterHeader.classList.remove('slow-flash-header');
      }
    }

    const sunrayBadge = document.getElementById('sunray-queue-badge');
    if (sunrayBadge) {
      if (isSunrayView && pendingQueueCount > 0) {
        sunrayBadge.textContent = `${pendingQueueCount} WAITING`;
        sunrayBadge.classList.remove('d-none');
      } else {
        sunrayBadge.classList.add('d-none');
      }
    }

    if (!activeSpeakerFound) {
      this.activeSpeaker = null;
      const speakerEl = document.getElementById('active-speaker');
      const speakerBox = document.getElementById('active-speaker-box');
      if (speakerEl) speakerEl.textContent = '';
      if (speakerBox) speakerBox.classList.add('d-none');
      
      // If we were receiving, reset to idle
      const container = document.getElementById('ptt-container');
      if (container && container.classList.contains('ptt-card-receiving')) {
        this.updatePTTCardState('IDLE');
      }
    }
  }

  updatePTTCardState(state, infoText = '') {
    const container = document.getElementById('ptt-container');
    const stateText = document.getElementById('ptt-state-text');
    const instruction = document.getElementById('ptt-instruction');
    const pttBtn = document.getElementById('ptt-btn');
    const headerBadge = document.getElementById('ptt-header-status-badge');
    
    // Reset status border color overrides while preserving minimised state
    const isMinimised = container ? container.classList.contains('minimised') : false;
    if (container) {
      container.className = isMinimised
        ? "card mb-3 shadow-sm position-relative minimised"
        : "card mb-3 shadow-sm position-relative";
    }
    
    if (state === 'IDLE') {
      if (container) container.classList.add('ptt-card-idle');
      if (stateText) {
        stateText.textContent = "STANDBY";
        stateText.style.color = "var(--color-phosphor-green)";
      }
      if (instruction) instruction.textContent = "Hold SPACEBAR or push circular dial to speak";
      if (pttBtn) pttBtn.classList.remove('active', 'btn-danger');
      if (headerBadge) {
        headerBadge.textContent = "STANDBY";
        headerBadge.className = "badge bg-secondary text-white ms-1";
      }
      this.audioEngine.clearPlaybackQueue();
      const speakerBox = document.getElementById('active-speaker-box');
      if (speakerBox) speakerBox.classList.add('d-none');
      
    } else if (state === 'KEYING') {
      if (container) container.classList.add('ptt-card-transmitting');
      if (stateText) {
        stateText.innerHTML = `<span class="badge bg-warning text-dark me-2">KEYING</span>STANDBY...`;
        stateText.style.color = "var(--color-tactical-amber)";
      }
      if (instruction) instruction.textContent = "Keying channel... Wait 1 second before speaking";
      if (pttBtn) pttBtn.classList.add('active');
      if (headerBadge) {
        headerBadge.textContent = "KEYING";
        headerBadge.className = "badge bg-warning text-dark ms-1";
      }

    } else if (state === 'TRANSMITTING') {
      if (container) container.classList.add('ptt-card-transmitting');
      if (stateText) {
        stateText.innerHTML = `<span class="pulse-indicator"></span>TRANSMITTING — SPEAK NOW`;
        stateText.style.color = "var(--color-hot-red)";
      }
      if (instruction) instruction.textContent = "Microphone active... Speak now. Release key when finished speaking";
      if (pttBtn) pttBtn.classList.add('active');
      if (headerBadge) {
        headerBadge.textContent = "TRANSMITTING";
        headerBadge.className = "badge bg-danger text-white ms-1";
      }
      
    } else if (state === 'RECEIVING') {
      if (container) container.classList.add('ptt-card-receiving');
      if (stateText) {
        stateText.textContent = `RECEIVING: ${infoText.toUpperCase()}`;
        stateText.style.color = "var(--color-tactical-amber)";
      }
      if (instruction) instruction.textContent = "Frequency locked... Voice transmission disabled";
      if (pttBtn) pttBtn.classList.remove('active');
      if (headerBadge) {
        headerBadge.textContent = `RECEIVING ${infoText.toUpperCase()}`;
        headerBadge.className = "badge bg-warning text-dark ms-1";
      }
      
    } else if (state === 'OVERRIDDEN') {
      if (container) container.classList.add('ptt-card-overridden');
      if (stateText) {
        stateText.textContent = "PTT OVERRIDDEN BY CONTROL";
        stateText.style.color = "#ffffff";
      }
      if (instruction) instruction.textContent = "Channel locked. Control station break-in active.";
      if (pttBtn) pttBtn.classList.remove('active');
      if (headerBadge) {
        headerBadge.textContent = "OVERRIDDEN";
        headerBadge.className = "badge bg-danger text-white ms-1";
      }
      
    } else if (state === 'BLOCKED') {
      if (container) container.classList.add('ptt-card-idle');
      if (stateText) {
        stateText.textContent = "TRANSMISSION BLOCKED";
        stateText.style.color = "var(--color-tactical-amber)";
      }
      if (instruction) instruction.textContent = infoText || "Channel busy... wait for frequency to clear";
      if (headerBadge) {
        headerBadge.textContent = "BLOCKED";
        headerBadge.className = "badge bg-danger text-white ms-1";
      }
    }
  }







  updateDTGClock() {
    document.getElementById('system-clock').textContent = formatDTG(new Date());
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
