// Logsheet Manager Module - VirtualNet

export class LogsheetManager {
  constructor(app) {
    this.app = app;
    this.tbody = document.getElementById('log-tbody');
    this.table = document.getElementById('log-table');
    this.localCacheKey = 'virtualnet_draft_logs';
    this.entries = []; // Array of { id, dtg, fromCallSign, toCallSign, precedence, eventText, operatorInitials, synced, locked }
    
    // Bind UI actions
    document.getElementById('btn-export-log').addEventListener('click', () => this.exportToCSV());
    
    // Global hotkey Ctrl+N to add row
    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        this.appendNewRow();
      }
    });
  }

  initialize() {
    this.tbody.innerHTML = '';
    this.entries = [];
    this.loadFromCache();
    if (this.entries.length === 0) {
      this.appendNewRow();
    } else {
      this.renderAll();
    }
  }

  loadFromCache() {
    try {
      const data = localStorage.getItem(`${this.localCacheKey}_${this.app.netId}`);
      if (data) {
        this.entries = JSON.parse(data);
      }
    } catch (e) {
      console.error("Failed to load logsheet cache:", e);
    }
  }

  saveToCache() {
    try {
      localStorage.setItem(`${this.localCacheKey}_${this.app.netId}`, JSON.stringify(this.entries));
    } catch (e) {
      console.error("Failed to save logsheet cache:", e);
    }
  }

  clearCache() {
    localStorage.removeItem(`${this.localCacheKey}_${this.app.netId}`);
  }

export function formatDTG(d = new Date()) {
  const offsetMinutes = d.getTimezoneOffset();
  const offsetHours = -offsetMinutes / 60;
  
  let tzLetter = 'Z';
  if (offsetHours === 0) {
    tzLetter = 'Z';
  } else if (offsetHours >= 1 && offsetHours <= 12) {
    const code = 'A'.charCodeAt(0) + (offsetHours - 1);
    const letterCode = offsetHours >= 10 ? code + 1 : code;
    tzLetter = String.fromCharCode(letterCode);
  } else if (offsetHours <= -1 && offsetHours >= -12) {
    const code = 'N'.charCodeAt(0) + (Math.abs(offsetHours) - 1);
    tzLetter = String.fromCharCode(code);
  } else {
    tzLetter = offsetHours > 0 ? 'A' : 'Z';
  }

  const day = String(d.getDate()).padStart(2, '0');
  const hr = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  const months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  const mon = months[d.getMonth()];
  const yr = String(d.getFullYear()).substring(2);

  return `${day}${hr}${min}${tzLetter} ${mon} ${yr}`;
}

  getDTG() {
    return formatDTG(new Date());
  }

  appendNewRow(initialData = null) {
    const id = initialData ? initialData.id : crypto.randomUUID();
    const dtg = initialData ? initialData.dtg : this.getDTG();
    const fromCallSign = initialData ? initialData.fromCallSign : '';
    const toCallSign = initialData ? initialData.toCallSign : '';
    const precedence = initialData ? initialData.precedence : 'ROUTINE';
    const eventText = initialData ? initialData.eventText : '';
    const operatorInitials = initialData ? initialData.operatorInitials : '';
    const locked = initialData ? initialData.locked : false;

    const entry = { id, dtg, fromCallSign, toCallSign, precedence, eventText, operatorInitials, locked };
    if (!initialData) {
      this.entries.push(entry);
      this.saveToCache();
    }

    const row = document.createElement('tr');
    row.id = `log-row-${id}`;
    row.innerHTML = `
      <td><input type="text" class="log-dtg" value="${dtg}" ${locked ? 'readonly' : ''} tabindex="-1"></td>
      <td><input type="text" class="log-from text-uppercase" value="${fromCallSign}" ${locked ? 'readonly' : ''}></td>
      <td><input type="text" class="log-to text-uppercase" value="${toCallSign}" ${locked ? 'readonly' : ''}></td>
      <td>
        <select class="log-precedence" ${locked ? 'disabled' : ''}>
          <option value="ROUTINE" ${precedence === 'ROUTINE' ? 'selected' : ''}>ROUTINE</option>
          <option value="PRIORITY" ${precedence === 'PRIORITY' ? 'selected' : ''}>PRIORITY</option>
          <option value="IMMEDIATE" ${precedence === 'IMMEDIATE' ? 'selected' : ''}>IMMEDIATE</option>
          <option value="FLASH" ${precedence === 'FLASH' ? 'selected' : ''}>FLASH</option>
        </select>
      </td>
      <td>
        <div class="d-flex align-items-center position-relative">
          <input type="text" class="log-event flex-grow-1" value="${eventText}" ${locked ? 'readonly' : ''}>
          <span class="warning-badge position-absolute end-0 me-2 text-warning d-none" title="Direct substation communication requires NCS authorization on Directed Net.">⚠️</span>
        </div>
      </td>
      <td><input type="text" class="log-initials text-uppercase" value="${operatorInitials}" ${locked ? 'readonly' : ''} maxlength="3"></td>
    `;

    this.tbody.appendChild(row);

    // Register Key events on the input nodes
    if (!locked) {
      this.setupRowListeners(row, id);
    }
    
    // Auto scroll tbody container
    const wrapper = document.getElementById('logsheet-wrapper');
    wrapper.scrollTop = wrapper.scrollHeight;

    return row;
  }

  setupRowListeners(row, id) {
    const fromInput = row.querySelector('.log-from');
    const toInput = row.querySelector('.log-to');
    const precSelect = row.querySelector('.log-precedence');
    const eventInput = row.querySelector('.log-event');
    const initialsInput = row.querySelector('.log-initials');
    const warningBadge = row.querySelector('.warning-badge');

    const updateHandler = () => {
      const entry = this.entries.find(e => e.id === id);
      if (entry && !entry.locked) {
        entry.fromCallSign = fromInput.value.toUpperCase();
        entry.toCallSign = toInput.value.toUpperCase();
        entry.precedence = precSelect.value;
        entry.eventText = eventInput.value;
        entry.operatorInitials = initialsInput.value.toUpperCase();
        this.saveToCache();
        
        // Auto Sync with server in background (Draft syncing)
        this.app.socketManager.syncLogEntry(entry);

        // Validation for Directed Net
        this.validateDirectedNetCommunication(entry.fromCallSign, entry.toCallSign, warningBadge);
      }
    };

    [fromInput, toInput, eventInput, initialsInput].forEach(inp => {
      inp.addEventListener('input', updateHandler);
    });
    precSelect.addEventListener('change', updateHandler);

    // Auto-complete From field if a transmission was active recently
    fromInput.addEventListener('focus', () => {
      if (!fromInput.value && this.app.activeSpeaker && this.app.activeSpeaker !== 'None') {
        fromInput.value = this.app.activeSpeaker;
        updateHandler();
      }
    });

    // Enter Key on initials field completes the row and starts a new one
    initialsInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const entry = this.entries.find(e => e.id === id);
        if (entry) {
          // If valid initials and data present, lock it
          if (entry.operatorInitials.length >= 2 && entry.fromCallSign && entry.toCallSign && entry.eventText) {
            entry.locked = true;
            this.saveToCache();

            // Re-render row as locked
            this.renderRowLocked(row, entry);

            // Save final state
            this.app.socketManager.syncLogEntry(entry);

            // Append new row and focus
            const newRow = this.appendNewRow();
            newRow.querySelector('.log-from').focus();
          } else {
            alert("Ensure From, To, Event Details, and Operator Initials (2-3 letters) are fully filled out before completing entry.");
          }
        }
      }
    });
  }

  validateDirectedNetCommunication(from, to, badge) {
    if (this.app.netState === 'DIRECTED' && from && to) {
      const fromCS = from.trim().toUpperCase();
      const toCS = to.trim().toUpperCase();
      
      // If both are sub-stations (neither is CONTROL/0 or INSTRUCTOR), flag it
      const isSubFrom = fromCS !== 'CONTROL' && fromCS !== '0' && fromCS !== 'INSTRUCTOR';
      const isSubTo = toCS !== 'CONTROL' && toCS !== '0' && toCS !== 'INSTRUCTOR';

      if (isSubFrom && isSubTo) {
        badge.classList.remove('d-none');
      } else {
        badge.classList.add('d-none');
      }
    } else {
      badge.classList.add('d-none');
    }
  }

  renderRowLocked(row, entry) {
    row.innerHTML = `
      <td><input type="text" class="log-dtg" value="${entry.dtg}" readonly tabindex="-1"></td>
      <td><input type="text" class="log-from text-uppercase" value="${entry.fromCallSign}" readonly tabindex="-1"></td>
      <td><input type="text" class="log-to text-uppercase" value="${entry.toCallSign}" readonly tabindex="-1"></td>
      <td>
        <select class="log-precedence" disabled tabindex="-1">
          <option value="${entry.precedence}" selected>${entry.precedence}</option>
        </select>
      </td>
      <td>
        <div class="d-flex align-items-center">
          <input type="text" class="log-event flex-grow-1" value="${entry.eventText}" readonly tabindex="-1">
        </div>
      </td>
      <td><input type="text" class="log-initials text-uppercase" value="${entry.operatorInitials}" readonly tabindex="-1"></td>
    `;
    row.querySelectorAll('input').forEach(inp => inp.style.color = 'var(--color-muted-gray)');
  }

  renderAll() {
    this.tbody.innerHTML = '';
    this.entries.forEach(entry => {
      this.appendNewRow(entry);
    });
  }

  exportToCSV() {
    if (this.entries.length === 0) {
      alert("No log entries to export.");
      return;
    }

    let csvContent = "data:text/csv;charset=utf-8,";
    csvContent += "Time (DTG),From,To,Precedence,Message Details / Event,Initials\n";

    this.entries.forEach(e => {
      const row = [
        `"${e.dtg}"`,
        `"${e.fromCallSign}"`,
        `"${e.toCallSign}"`,
        `"${e.precedence}"`,
        `"${e.eventText.replace(/"/g, '""')}"`,
        `"${e.operatorInitials}"`
      ].join(",");
      csvContent += row + "\n";
    });

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `VirtualNet_Log_${this.app.myCallSign}_${this.app.netId.substring(0, 5)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }
}
