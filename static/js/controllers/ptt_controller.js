import { SYSTEM_CONSTANTS } from '../constants.js';

export class PTTController {
  constructor(app) {
    this.app = app;
  }

  get isKeying() {
    return this.app ? this.app.isKeying : false;
  }

  set isKeying(val) {
    if (this.app) {
      this.app.isKeying = val;
    }
  }

  isEditingInput(target) {
    const el = target || document.activeElement;
    if (!el) return false;
    const tag = el.tagName ? el.tagName.toUpperCase() : '';
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
  }

  setupPTTHandlers() {
    const startAudioContext = async () => {
      if (!this.app.audioEngine.audioContext) {
        await this.app.audioEngine.init();
      }
      if (this.app.audioEngine.audioContext && (this.app.audioEngine.audioContext.state === 'suspended' || this.app.audioEngine.audioContext.state === 'interrupted')) {
        this.app.audioEngine.audioContext.resume().catch(err => {
          console.warn("AudioContext non-blocking resume warning:", err);
        });
      }
    };

    // User gesture unlock for WebAudio API
    window.addEventListener('click', startAudioContext, { once: true });
    window.addEventListener('keydown', startAudioContext, { once: true });
    window.addEventListener('touchstart', startAudioContext, { once: true });

    // Global Spacebar Keydown Handler
    window.addEventListener('keydown', (e) => {
      const isSpace = e.code === 'Space' || e.key === ' ' || e.key === 'Spacebar' || e.keyCode === 32;
      if (!isSpace) return;

      const dashboard = document.getElementById('dashboard-section');
      const isDashboardActive = dashboard && !dashboard.classList.contains('d-none');

      if (isDashboardActive && !this.isEditingInput(e.target)) {
        e.preventDefault(); // Stop browser page scrolling to bottom!
        if (e.repeat) return;

        if (!this.isKeying && !this.app.isTransmitting) {
          this.isKeying = true;
          startAudioContext().then(() => {
            this.app.startTransmission();
          });
        }
      }
    });

    // Global Spacebar Keyup Handler
    window.addEventListener('keyup', (e) => {
      const isSpace = e.code === 'Space' || e.key === ' ' || e.key === 'Spacebar' || e.keyCode === 32;
      if (!isSpace) return;

      const dashboard = document.getElementById('dashboard-section');
      const isDashboardActive = dashboard && !dashboard.classList.contains('d-none');

      if (isDashboardActive && !this.isEditingInput(e.target)) {
        e.preventDefault();
        if (this.isKeying || this.app.isTransmitting) {
          this.isKeying = false;
          this.app.stopTransmission();
        }
      }
    });

    // UI Transceiver Hold-to-Talk Mouse & Touch Listeners
    const bindBtn = () => {
      const pttBtn = document.getElementById('ptt-btn');
      if (!pttBtn) return;

      pttBtn.addEventListener('mousedown', async (e) => {
        if (e.button !== undefined && e.button !== 0) return;
        e.preventDefault();
        this.isKeying = true;
        await startAudioContext();
        this.app.startTransmission();
      });

      const handleRelease = (e) => {
        if (e && e.button !== undefined && e.button !== 0) return;
        if (this.isKeying || this.app.isTransmitting) {
          this.isKeying = false;
          this.app.stopTransmission();
        }
      };

      pttBtn.addEventListener('mouseup', handleRelease);
      pttBtn.addEventListener('mouseleave', handleRelease);
      window.addEventListener('mouseup', handleRelease);

      pttBtn.addEventListener('touchstart', async (e) => {
        e.preventDefault();
        if (!this.isKeying && !this.app.isTransmitting) {
          this.isKeying = true;
          await startAudioContext();
          this.app.startTransmission();
        }
      });

      pttBtn.addEventListener('touchend', (e) => {
        e.preventDefault();
        if (this.isKeying || this.app.isTransmitting) {
          this.isKeying = false;
          this.app.stopTransmission();
        }
      });
    };

    bindBtn();
  }

  updatePTTCardState(state, detail = '') {
    const container = document.getElementById('ptt-container');
    const stateText = document.getElementById('ptt-state-text');
    const instruction = document.getElementById('ptt-instruction');
    const pttBtn = document.getElementById('ptt-btn');
    const headerBadge = document.getElementById('ptt-header-status-badge');

    if (!container || !stateText || !pttBtn) return;

    pttBtn.disabled = !this.app.myCallSign;

    const isMinimised = container.classList.contains('minimised');
    container.className = isMinimised
      ? "card mb-3 shadow-sm position-relative minimised"
      : "card mb-3 shadow-sm position-relative";

    if (state === 'TRANSMITTING') {
      container.classList.add('ptt-card-transmitting');
      stateText.innerHTML = `<span class="pulse-indicator"></span>TRANSMITTING — SPEAK NOW`;
      stateText.style.color = "var(--color-hot-red)";
      if (instruction) instruction.textContent = "Microphone active... Speak now. Release key when finished speaking";
      pttBtn.classList.add('active');
      if (headerBadge) {
        headerBadge.textContent = "TRANSMITTING";
        headerBadge.className = "badge bg-danger text-white ms-1";
      }
    } else if (state === 'RECEIVING') {
      container.classList.add('ptt-card-receiving');
      stateText.textContent = `RECEIVING: ${detail.toUpperCase()}`;
      stateText.style.color = "var(--color-tactical-amber)";
      if (instruction) instruction.textContent = "Frequency locked... Voice transmission disabled";
      pttBtn.classList.remove('active');
      if (headerBadge) {
        headerBadge.textContent = `RECEIVING ${detail.toUpperCase()}`;
        headerBadge.className = "badge bg-warning text-dark ms-1";
      }
    } else if (state === 'BLOCKED') {
      container.classList.add('ptt-card-idle');
      stateText.textContent = "TRANSMISSION BLOCKED";
      stateText.style.color = "var(--color-tactical-amber)";
      if (instruction) instruction.textContent = detail || "Channel busy... wait for frequency to clear";
      if (headerBadge) {
        headerBadge.textContent = "BLOCKED";
        headerBadge.className = "badge bg-danger text-white ms-1";
      }
    } else if (state === 'OVERRIDDEN') {
      container.classList.add('ptt-card-overridden');
      stateText.textContent = "PTT OVERRIDDEN BY CONTROL";
      stateText.style.color = "#ffffff";
      if (instruction) instruction.textContent = "Channel locked. Control station break-in active.";
      pttBtn.classList.remove('active');
      if (headerBadge) {
        headerBadge.textContent = "OVERRIDDEN";
        headerBadge.className = "badge bg-danger text-white ms-1";
      }
    } else {
      // IDLE / STANDBY
      container.classList.add('ptt-card-idle');
      stateText.textContent = "STANDBY";
      stateText.style.color = "var(--color-phosphor-green)";
      if (instruction) instruction.textContent = "Hold SPACEBAR or push circular dial to speak (Max 20s)";
      pttBtn.classList.remove('active');
      if (headerBadge) {
        headerBadge.textContent = "STANDBY";
        headerBadge.className = "badge bg-secondary text-white ms-1";
      }
    }
  }

  showDFAlertBanner() {
    const banner = document.getElementById('df-alert-banner');
    if (banner) {
      banner.classList.remove('d-none');
      setTimeout(() => banner.classList.add('d-none'), SYSTEM_CONSTANTS.DF_BANNER_DURATION_MS);
    }
  }
}
