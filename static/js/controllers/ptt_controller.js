import { SYSTEM_CONSTANTS } from '../constants.js';

export class PTTController {
  constructor(app) {
    this.app = app;
    this.isKeying = false;
  }

  setupPTTHandlers() {
    const pttBtn = document.getElementById('ptt-btn');
    if (!pttBtn) return;

    const handlePTTDown = (e) => {
      e.preventDefault();
      if (this.isKeying) return;
      this.isKeying = true;
      this.app.startTransmission();
    };

    const handlePTTUp = (e) => {
      e.preventDefault();
      if (!this.isKeying) return;
      this.isKeying = false;
      this.app.stopTransmission();
    };

    pttBtn.addEventListener('pointerdown', handlePTTDown);
    pttBtn.addEventListener('pointerup', handlePTTUp);
    pttBtn.addEventListener('pointerleave', handlePTTUp);

    window.addEventListener('keydown', (e) => {
      const tag = document.activeElement ? document.activeElement.tagName.toUpperCase() : '';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      if (e.code === 'Space' && !e.repeat) {
        const dashboard = document.getElementById('dashboard-section');
        if (dashboard && !dashboard.classList.contains('d-none')) {
          e.preventDefault();
          if (!this.isKeying) {
            this.isKeying = true;
            this.app.startTransmission();
          }
        }
      }
    });

    window.addEventListener('keyup', (e) => {
      const tag = document.activeElement ? document.activeElement.tagName.toUpperCase() : '';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      if (e.code === 'Space') {
        const dashboard = document.getElementById('dashboard-section');
        if (dashboard && !dashboard.classList.contains('d-none')) {
          e.preventDefault();
          if (this.isKeying) {
            this.isKeying = false;
            this.app.stopTransmission();
          }
        }
      }
    });
  }

  updatePTTCardState(state, detail = '') {
    const container = document.getElementById('ptt-container');
    const stateText = document.getElementById('ptt-state-text');
    const instruction = document.getElementById('ptt-instruction');
    const pttBtn = document.getElementById('ptt-btn');
    const headerBadge = document.getElementById('ptt-header-status-badge');

    if (!container || !stateText || !pttBtn) return;

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
