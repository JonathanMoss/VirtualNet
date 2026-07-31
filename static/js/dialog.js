/**
 * Tactical CRT Custom Dialog System - VirtualNet
 * Replaces native browser alert(), confirm(), prompt() message boxes with custom-rendered,
 * accessible, tactical night-ops styled modal dialogs.
 */

class TacticalDialogManager {
  constructor() {
    this.overlayEl = null;
    this.cardEl = null;
    this.titleEl = null;
    this.bodyEl = null;
    this.inputContainerEl = null;
    this.inputEl = null;
    this.footerEl = null;
    this.btnCancelEl = null;
    this.btnConfirmEl = null;
    this.activeResolve = null;

    this.initDOM();
    this.bindEvents();
    this.overrideNativeDialogs();
  }

  /**
   * Initializes the modal DOM elements if not already present.
   */
  initDOM() {
    if (document.getElementById('tactical-dialog-overlay')) {
      this.overlayEl = document.getElementById('tactical-dialog-overlay');
      this.cardEl = document.getElementById('tactical-dialog-card');
      this.titleEl = document.getElementById('tactical-dialog-title');
      this.bodyEl = document.getElementById('tactical-dialog-body');
      this.inputContainerEl = document.getElementById('tactical-dialog-input-container');
      this.inputEl = document.getElementById('tactical-dialog-input');
      this.footerEl = document.getElementById('tactical-dialog-footer');
      this.btnCancelEl = document.getElementById('tactical-dialog-btn-cancel');
      this.btnConfirmEl = document.getElementById('tactical-dialog-btn-confirm');
      return;
    }

    const template = `
      <div id="tactical-dialog-overlay" class="tactical-dialog-overlay d-none" role="dialog" aria-modal="true" aria-labelledby="tactical-dialog-title">
        <div id="tactical-dialog-card" class="tactical-dialog-card shadow-lg">
          <div class="tactical-dialog-header">
            <h5 id="tactical-dialog-title" class="m-0 text-uppercase font-weight-bold"></h5>
            <button type="button" id="tactical-dialog-btn-close" class="btn-close btn-close-white ms-auto shadow-none" aria-label="Close"></button>
          </div>
          <div class="tactical-dialog-content">
            <div id="tactical-dialog-body" class="tactical-dialog-body mb-3"></div>
            <div id="tactical-dialog-input-container" class="mb-3 d-none">
              <input type="text" id="tactical-dialog-input" class="form-control text-uppercase monospace" autocomplete="off">
            </div>
          </div>
          <div id="tactical-dialog-footer" class="tactical-dialog-footer d-flex justify-content-end gap-2">
            <button type="button" id="tactical-dialog-btn-cancel" class="btn btn-outline-secondary btn-sm text-uppercase font-weight-bold">CANCEL</button>
            <button type="button" id="tactical-dialog-btn-confirm" class="btn btn-tactical btn-sm text-uppercase font-weight-bold">OK</button>
          </div>
        </div>
      </div>
    `;

    const div = document.createElement('div');
    div.innerHTML = template.trim();
    document.body.appendChild(div.firstElementChild);

    this.overlayEl = document.getElementById('tactical-dialog-overlay');
    this.cardEl = document.getElementById('tactical-dialog-card');
    this.titleEl = document.getElementById('tactical-dialog-title');
    this.bodyEl = document.getElementById('tactical-dialog-body');
    this.inputContainerEl = document.getElementById('tactical-dialog-input-container');
    this.inputEl = document.getElementById('tactical-dialog-input');
    this.footerEl = document.getElementById('tactical-dialog-footer');
    this.btnCancelEl = document.getElementById('tactical-dialog-btn-cancel');
    this.btnConfirmEl = document.getElementById('tactical-dialog-btn-confirm');
  }

  /**
   * Binds user events and keyboard shortcuts (Enter / Escape).
   */
  bindEvents() {
    const btnClose = document.getElementById('tactical-dialog-btn-close');
    if (btnClose) {
      btnClose.addEventListener('click', () => this.handleCancel());
    }
    this.btnCancelEl.addEventListener('click', () => this.handleCancel());
    this.btnConfirmEl.addEventListener('click', () => this.handleConfirm());

    // Click outside to cancel if confirm/prompt, or close if alert
    this.overlayEl.addEventListener('click', (e) => {
      if (e.target === this.overlayEl) {
        this.handleCancel();
      }
    });

    // Keyboard handlers
    window.addEventListener('keydown', (e) => {
      if (this.overlayEl && !this.overlayEl.classList.contains('d-none')) {
        if (e.key === 'Escape') {
          e.preventDefault();
          this.handleCancel();
        } else if (e.key === 'Enter') {
          // If focus is on cancel button, let cancel trigger naturally
          if (document.activeElement === this.btnCancelEl) return;
          e.preventDefault();
          this.handleConfirm();
        }
      }
    });
  }

  /**
   * Overrides native window.alert, window.confirm, window.prompt
   */
  overrideNativeDialogs() {
    const self = this;
    window.alert = function (message) {
      console.warn('⚠️ Native alert() intercepted by TacticalDialogManager.');
      self.alert(message);
    };

    window.confirm = function (message) {
      console.warn('⚠️ Native confirm() intercepted by TacticalDialogManager. Synchronous execution will return false; use await showConfirm() instead.');
      self.confirm(message);
      return false;
    };

    window.prompt = function (message, defaultValue) {
      console.warn('⚠️ Native prompt() intercepted by TacticalDialogManager. Synchronous execution will return null; use await showPrompt() instead.');
      self.prompt(message, defaultValue);
      return null;
    };
  }

  /**
   * Show Custom Alert Modal
   */
  alert(message, options = {}) {
    return new Promise((resolve) => {
      this.activeType = 'alert';
      this.activeResolve = resolve;

      this.titleEl.textContent = options.title || 'SYSTEM NOTICE';
      this.titleEl.style.color = options.titleColor || 'var(--color-phosphor-green)';
      this.bodyEl.textContent = message;

      this.inputContainerEl.classList.add('d-none');
      this.btnCancelEl.classList.add('d-none');
      this.btnConfirmEl.textContent = options.confirmText || 'ACKNOWLEDGE';
      this.btnConfirmEl.className = 'btn btn-tactical btn-sm text-uppercase font-weight-bold';

      this.show();
      this.btnConfirmEl.focus();
    });
  }

  /**
   * Show Custom Confirmation Modal
   */
  confirm(message, options = {}) {
    return new Promise((resolve) => {
      this.activeType = 'confirm';
      this.activeResolve = resolve;

      this.titleEl.textContent = options.title || 'CONFIRM ACTION';
      this.titleEl.style.color = options.titleColor || 'var(--color-tactical-amber)';
      this.bodyEl.textContent = message;

      this.inputContainerEl.classList.add('d-none');
      this.btnCancelEl.classList.remove('d-none');
      this.btnCancelEl.textContent = options.cancelText || 'CANCEL';
      this.btnConfirmEl.textContent = options.confirmText || 'CONFIRM';
      this.btnConfirmEl.className = options.confirmClass || 'btn btn-danger btn-sm text-uppercase font-weight-bold';

      this.show();
      this.btnConfirmEl.focus();
    });
  }

  /**
   * Show Custom Prompt Modal
   */
  prompt(message, defaultValue = '', options = {}) {
    return new Promise((resolve) => {
      this.activeType = 'prompt';
      this.activeResolve = resolve;

      this.titleEl.textContent = options.title || 'INPUT REQUIRED';
      this.titleEl.style.color = options.titleColor || 'var(--color-tactical-amber)';
      this.bodyEl.textContent = message;

      this.inputContainerEl.classList.remove('d-none');
      this.inputEl.value = defaultValue;

      this.btnCancelEl.classList.remove('d-none');
      this.btnCancelEl.textContent = options.cancelText || 'CANCEL';
      this.btnConfirmEl.textContent = options.confirmText || 'SUBMIT';
      this.btnConfirmEl.className = options.confirmClass || 'btn btn-tactical btn-sm text-uppercase font-weight-bold';

      this.show();
      this.inputEl.focus();
      this.inputEl.select();
    });
  }

  show() {
    this.overlayEl.classList.remove('d-none');
    document.body.classList.add('modal-open');
  }

  hide() {
    this.overlayEl.classList.add('d-none');
    document.body.classList.remove('modal-open');
  }

  handleConfirm() {
    if (!this.activeResolve) return;
    const resolve = this.activeResolve;
    this.activeResolve = null;

    let result;
    if (this.activeType === 'alert') {
      result = true;
    } else if (this.activeType === 'confirm') {
      result = true;
    } else if (this.activeType === 'prompt') {
      result = this.inputEl.value;
    }

    this.hide();
    resolve(result);
  }

  handleCancel() {
    if (!this.activeResolve) return;
    const resolve = this.activeResolve;
    this.activeResolve = null;

    let result;
    if (this.activeType === 'alert') {
      result = true;
    } else if (this.activeType === 'confirm') {
      result = false;
    } else if (this.activeType === 'prompt') {
      result = null;
    }

    this.hide();
    resolve(result);
  }
}

// Singleton Instance
export const dialogManager = new TacticalDialogManager();

export function showAlert(message, options) {
  return dialogManager.alert(message, options);
}

export function showConfirm(message, options) {
  return dialogManager.confirm(message, options);
}

export function showPrompt(message, defaultValue, options) {
  return dialogManager.prompt(message, defaultValue, options);
}
