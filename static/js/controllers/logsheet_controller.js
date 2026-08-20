/**
 * Logsheet Controller - VirtualNet
 * Manages interactive radio logsheet rows, shortcuts, DTG auto-fill, and JSON/TXT log exports.
 */
import { formatDTG } from '../utils.js';
import { showAlert } from '../dialog.js';

export class LogsheetController {
  constructor(app) {
    this.app = app;
  }

  setupLogsheetTable() {
    const tableBody = document.getElementById('logsheet-tbody');
    const btnAddRow = document.getElementById('btn-add-log-row');
    const btnExportJson = document.getElementById('btn-export-log-json');
    const btnExportTxt = document.getElementById('btn-export-log-txt');

    if (btnAddRow) {
      btnAddRow.addEventListener('click', () => this.appendLogRow());
    }

    if (btnExportJson) {
      btnExportJson.addEventListener('click', () => this.exportLog('json'));
    }

    if (btnExportTxt) {
      btnExportTxt.addEventListener('click', () => this.exportLog('txt'));
    }

    // Keyboard shortcut Ctrl+N to append log row
    window.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') {
        const dashboard = document.getElementById('dashboard-section');
        if (dashboard && !dashboard.classList.contains('d-none')) {
          e.preventDefault();
          this.appendLogRow();
        }
      }
    });

    if (tableBody && tableBody.children.length === 0) {
      this.appendLogRow();
    }
  }

  appendLogRow(initialData = null) {
    const tableBody = document.getElementById('logsheet-tbody');
    if (!tableBody) return;

    const tr = document.createElement('tr');
    tr.className = 'log-row align-middle';

    const currentDTG = initialData?.dtg || formatDTG(new Date());

    tr.innerHTML = `
      <td class="py-1 px-1" style="width: 140px;">
        <input type="text" class="form-control form-control-sm log-dtg monospace py-0 text-phosphor-green" value="${currentDTG}">
      </td>
      <td class="py-1 px-1" style="width: 90px;">
        <input type="text" class="form-control form-control-sm log-from text-uppercase monospace py-0" value="${initialData?.from || ''}" placeholder="FROM">
      </td>
      <td class="py-1 px-1" style="width: 90px;">
        <input type="text" class="form-control form-control-sm log-to text-uppercase monospace py-0" value="${initialData?.to || ''}" placeholder="TO">
      </td>
      <td class="py-1 px-1" style="width: 100px;">
        <select class="form-select form-select-sm log-precedence monospace py-0">
          <option value="ROUTINE" ${initialData?.precedence === 'ROUTINE' ? 'selected' : ''}>R - ROUTINE</option>
          <option value="PRIORITY" ${initialData?.precedence === 'PRIORITY' ? 'selected' : ''}>P - PRIORITY</option>
          <option value="IMMEDIATE" ${initialData?.precedence === 'IMMEDIATE' ? 'selected' : ''}>I - IMMEDIATE</option>
          <option value="FLASH" ${initialData?.precedence === 'FLASH' ? 'selected' : ''}>F - FLASH</option>
        </select>
      </td>
      <td class="py-1 px-1">
        <input type="text" class="form-control form-control-sm log-text monospace py-0" value="${initialData?.text || ''}" placeholder="MESSAGE / EVENT TEXT">
      </td>
      <td class="py-1 px-1" style="width: 70px;">
        <input type="text" class="form-control form-control-sm log-initials text-uppercase monospace py-0" value="${initialData?.initials || ''}" placeholder="INIT">
      </td>
      <td class="py-1 px-1 text-center" style="width: 40px;">
        <button type="button" class="btn btn-outline-danger btn-sm py-0 px-1 btn-delete-row" title="Delete Row">×</button>
      </td>
    `;

    const btnDelete = tr.querySelector('.btn-delete-row');
    if (btnDelete) {
      btnDelete.addEventListener('click', () => {
        tr.remove();
        if (tableBody.children.length === 0) {
          this.appendLogRow();
        }
      });
    }

    const inputs = tr.querySelectorAll('input, select');
    inputs.forEach((input, index) => {
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          if (index < inputs.length - 1) {
            inputs[index + 1].focus();
          } else {
            this.appendLogRow();
            const newRows = tableBody.querySelectorAll('tr');
            const lastRow = newRows[newRows.length - 1];
            if (lastRow) {
              const firstInput = lastRow.querySelector('input');
              if (firstInput) firstInput.focus();
            }
          }
        }
      });
    });

    tableBody.appendChild(tr);
  }

  exportLog(format = 'json') {
    const tableBody = document.getElementById('logsheet-tbody');
    if (!tableBody) return;

    const rows = tableBody.querySelectorAll('tr');
    const logData = [];

    rows.forEach(tr => {
      const dtg = tr.querySelector('.log-dtg')?.value.trim() || '';
      const from = tr.querySelector('.log-from')?.value.trim() || '';
      const to = tr.querySelector('.log-to')?.value.trim() || '';
      const precedence = tr.querySelector('.log-precedence')?.value || 'ROUTINE';
      const text = tr.querySelector('.log-text')?.value.trim() || '';
      const initials = tr.querySelector('.log-initials')?.value.trim() || '';

      if (dtg || from || to || text) {
        logData.push({ dtg, from, to, precedence, text, initials });
      }
    });

    if (logData.length === 0) {
      showAlert("Radio logsheet is empty. Enter message details before exporting.", { title: "LOG EMPTY" });
      return;
    }

    const filename = `VIRTUALNET_LOG_${this.app.myCallSign || 'STATION'}_${Date.now()}.${format}`;
    let content = '';
    let mimeType = 'text/plain';

    if (format === 'json') {
      content = JSON.stringify(logData, null, 2);
      mimeType = 'application/json';
    } else {
      content = `VIRTUALNET RADIO LOG - STATION: ${this.app.myCallSign || 'N/A'}\n`;
      content += `EXPORT DTG: ${formatDTG(new Date())}\n`;
      content += `================================================================================\n`;
      content += `DTG             | FROM    | TO      | PREC     | INITIALS | MESSAGE TEXT\n`;
      content += `----------------+---------+---------+----------+----------+---------------------\n`;
      logData.forEach(entry => {
        const dtgP = (entry.dtg || '').padEnd(15);
        const fromP = (entry.from || '').padEnd(8);
        const toP = (entry.to || '').padEnd(8);
        const precP = (entry.precedence || '').padEnd(9);
        const initP = (entry.initials || '').padEnd(8);
        content += `${dtgP} | ${fromP} | ${toP} | ${precP} | ${initP} | ${entry.text}\n`;
      });
    }

    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
}
