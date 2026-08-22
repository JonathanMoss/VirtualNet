/**
 * Sunray Controller - VirtualNet
 * Manages instructor admissions queue, callsign assignment, station management, and session control.
 */
import { showAlert, showConfirm, showPrompt } from '../dialog.js';

export class SunrayController {
  constructor(app) {
    this.app = app;
  }

  setupFoldToggle() {
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

      header.addEventListener('click', (e) => {
        const endBtn = document.getElementById('btn-end-session');
        if (e.target !== endBtn && !endBtn?.contains(e.target)) {
          toggleSunray();
        }
      });
    }
  }

  setupSessionEndTrigger() {
    const btnEnd = document.getElementById('btn-end-session');
    if (btnEnd) {
      btnEnd.addEventListener('click', async () => {
        const confirmed = await showConfirm(
          "Are you sure you want to end this Net session? All connected operators will be disconnected and session state purged.",
          {
            title: "TERMINATE NET SESSION",
            confirmText: "END SESSION",
            confirmClass: "btn btn-danger btn-sm text-uppercase font-weight-bold"
          }
        );
        if (confirmed) {
          this.app.socketManager.endSession();
          this.app.clearSavedSession();
          this.app.resetToLanding();
        }
      });
    }
  }

  setupClearTxLogTrigger() {
    const btnClear = document.getElementById('btn-clear-tx-log');
    if (btnClear) {
      btnClear.addEventListener('click', async () => {
        const confirmed = await showConfirm(
          "Are you sure you want to clear the transmission activity log?",
          {
            title: "CLEAR TRANSMISSION LOG",
            confirmText: "CLEAR LOG",
            confirmClass: "btn btn-warning btn-sm text-uppercase font-weight-bold"
          }
        );
        if (confirmed && this.app.socketManager) {
          this.app.socketManager.clearTransmissionLog();
        }
      });
    }
  }

  clearTxLog() {
    const txLogTbody = document.getElementById('sunray-tx-log-tbody');
    if (txLogTbody) {
      txLogTbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted py-3">No transmission records logged yet.</td></tr>';
    }
  }

  renderAdmissionsQueue(queue) {
    const tbody = document.getElementById('admissions-tbody');
    const headerBar = document.getElementById('app-header-bar');
    const queueBadge = document.getElementById('sunray-queue-badge');
    if (!tbody) return;

    const isWaiting = queue && queue.length > 0;

    if (queueBadge) {
      if (isWaiting) {
        queueBadge.textContent = `${queue.length} WAITING`;
        queueBadge.classList.remove('d-none');
      } else {
        queueBadge.classList.add('d-none');
      }
    }

    if (headerBar) {
      if (isWaiting && this.app.myRole === 'SUNRAY') {
        headerBar.classList.add('slow-flash-header');
      } else {
        headerBar.classList.remove('slow-flash-header');
      }
    }

    tbody.innerHTML = '';
    if (!queue || queue.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" class="text-muted text-center py-2">No operators awaiting callsign assignment</td></tr>';
      return;
    }

    queue.forEach(item => {
      const stationId = item.stationId || item.id;
      const tr = document.createElement('tr');
      tr.className = 'align-middle';
      tr.innerHTML = `
        <td class="text-start text-phosphor-green font-weight-bold py-1">${item.nickname}</td>
        <td class="text-start py-1">
          <input type="text" class="form-control form-control-sm text-uppercase input-assign-cs monospace py-0" 
                 placeholder="e.g. R11" maxlength="8" style="width: 90px;" value="${item.suggestedCallSign || ''}">
        </td>
        <td class="text-start py-1">
          <select class="form-select form-select-sm select-assign-role monospace py-0" style="min-width: 165px; width: 100%;">
            <option value="SUB_STATION" ${item.role === 'SUB_STATION' ? 'selected' : ''}>SUB_STATION</option>
            <option value="CONTROL" ${item.role === 'CONTROL' ? 'selected' : ''}>CONTROL</option>
            <option value="INSTRUCTOR" ${item.role === 'INSTRUCTOR' ? 'selected' : ''}>INSTRUCTOR</option>
          </select>
        </td>
        <td class="text-start py-1">
          <button type="button" class="btn btn-tactical btn-sm py-0 btn-do-assign" data-station-id="${stationId}">ASSIGN</button>
        </td>
      `;

      const btnAssign = tr.querySelector('.btn-do-assign');
      const inputCs = tr.querySelector('.input-assign-cs');
      const selectRole = tr.querySelector('.select-assign-role');

      const doAssign = async () => {
        const callSign = inputCs.value.trim().toUpperCase();
        const role = selectRole.value;
        if (!callSign) {
          await showAlert("Please enter a callsign for the operator.", { title: "INPUT REQUIRED" });
          return;
        }
        this.app.socketManager.assignCallsign(stationId, callSign, role);
      };

      if (btnAssign) btnAssign.addEventListener('click', doAssign);
      if (inputCs) {
        inputCs.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            doAssign();
          }
        });
      }
      tbody.appendChild(tr);
    });
  }

  renderInstructorRoster(stations) {
    const tbody = document.getElementById('instructor-roster-tbody');
    if (!tbody) return;

    // Automatically derive awaiting admissions queue from roster stations
    const awaiting = (stations || []).filter(st => st.status === 'AWAITING_ASSIGNMENT' || !st.callSign);
    const queueItems = awaiting.map(st => ({
      stationId: st.stationId || st.id,
      nickname: st.nickname,
      role: st.role || 'SUB_STATION',
      suggestedCallSign: st.callSign || ''
    }));
    this.renderAdmissionsQueue(queueItems);

    tbody.innerHTML = '';
    if (!stations || stations.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="text-muted text-center py-2">NO ACTIVE STATIONS</td></tr>';
      return;
    }

    stations.forEach(st => {
      const tr = document.createElement('tr');
      tr.className = 'align-middle';
      const targetId = st.id || st.stationId;
      const isMe = targetId === this.app.myStationId ? ' <span class="text-warning small">(YOU)</span>' : '';
      const isSunrayRole = st.role === 'SUNRAY' || st.role === 'INSTRUCTOR' || st.role === 'CONTROL';

      tr.innerHTML = `
        <td class="text-start text-phosphor-green font-weight-bold py-1 me-1">${st.callSign || 'AWAITING'}</td>
        <td class="text-start text-light font-weight-bold py-1">${st.nickname || '-'}${isMe}</td>
        <td class="text-start py-1"><span class="badge ${isSunrayRole ? 'bg-warning text-dark' : 'bg-secondary text-light'} py-0">${st.role}</span></td>
        <td class="text-start py-1"><span class="badge ${st.status === 'TALKING' ? 'bg-danger text-white pulse-glow' : 'bg-success text-dark'} py-0">${st.status}</span></td>
        <td class="text-start py-1">
          ${targetId !== this.app.myStationId ? `
            <button type="button" class="btn btn-outline-info btn-sm py-0 me-1 btn-edit-cs" data-station-id="${targetId}" data-cs="${st.callSign || ''}">EDIT CS</button>
            <button type="button" class="btn btn-outline-danger btn-sm py-0 btn-kick-st" data-station-id="${targetId}" data-nick="${st.nickname}">KICK</button>
          ` : '<span class="text-muted small">N/A</span>'}
        </td>
      `;

      const btnEdit = tr.querySelector('.btn-edit-cs');
      if (btnEdit) {
        btnEdit.addEventListener('click', async () => {
          const newCs = await showPrompt("Enter new Call Sign or Suffix for station:", st.callSign || '', {
            title: "MODIFY CALLSIGN",
            placeholder: "e.g. R11A"
          });
          if (newCs && newCs.trim() !== '') {
            this.app.socketManager.assignCallsign(targetId, newCs.trim().toUpperCase(), st.role);
          }
        });
      }

      const btnKick = tr.querySelector('.btn-kick-st');
      if (btnKick) {
        btnKick.addEventListener('click', async () => {
          const confirmed = await showConfirm(`Are you sure you want to kick station ${st.nickname} (${st.callSign || 'N/A'}) from the net?`, {
            title: "KICK STATION",
            confirmText: "KICK STATION",
            confirmClass: "btn btn-danger btn-sm"
          });
          if (confirmed) {
            this.app.socketManager.kickStation(targetId);
          }
        });
      }

      tbody.appendChild(tr);
    });
  }

  renderTxLogRowContent(data) {
    let statusText = data.status || data.reason || 'PTT RELEASED';
    if (statusText === 'PTT_RELEASED') statusText = 'PTT RELEASED';

    let statusBadge = `<span class="badge bg-success font-mono">${statusText}</span>`;
    if (statusText === 'TRANSMITTING') {
      statusBadge = `<span class="badge bg-success font-mono text-uppercase">TRANSMITTING</span>`;
    } else if (statusText === 'MAX_DURATION_EXCEEDED') {
      statusBadge = `<span class="badge bg-danger font-mono">MAX EXCEEDED</span>`;
    } else if (statusText === 'OVERRIDDEN') {
      statusBadge = `<span class="badge bg-warning text-dark font-mono">OVERRIDDEN</span>`;
    } else if (statusText === 'PTT RELEASED') {
      statusBadge = `<span class="badge bg-secondary font-mono">PTT RELEASED</span>`;
    }

    const rxSummaryText = data.rxSummary || 'ALL CALLSIGNS R/X';
    let rxBadgeClass = 'bg-success';
    if (rxSummaryText.startsWith('NOT R/X')) {
      rxBadgeClass = 'bg-warning text-dark';
    } else if (rxSummaryText === 'STREAMING' || rxSummaryText === 'RECEIVING') {
      rxBadgeClass = 'bg-info text-dark';
    }
    const rxBadge = `<span class="badge ${rxBadgeClass} font-mono">${rxSummaryText}</span>`;

    return `
      <td class="text-start font-mono py-1">${data.dtg || '-'}</td>
      <td class="text-start font-weight-bold text-phosphor-green py-1">${data.callSign || '-'}</td>
      <td class="text-start font-mono py-1">${data.duration || '-'}</td>
      <td class="text-start py-1">${statusBadge}</td>
      <td class="text-start py-1">${rxBadge}</td>
    `;
  }

  async loadSunrayTransmissionHistory(pin) {
    if (!pin) return;
    try {
      const res = await fetch(`/api/session/${pin}/transmissions`);
      if (!res.ok) return;
      const data = await res.json();
      const txLogTbody = document.getElementById('sunray-tx-log-tbody');
      if (!txLogTbody || !data.transmissions) return;

      txLogTbody.innerHTML = '';
      if (data.transmissions.length === 0) {
        txLogTbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted py-3">No transmission records logged yet.</td></tr>';
        return;
      }

      data.transmissions.forEach(tx => {
        const tr = document.createElement('tr');
        if (tx.id || tx.transmissionId) {
          tr.dataset.txId = tx.id || tx.transmissionId;
        }
        tr.innerHTML = this.renderTxLogRowContent(tx);
        txLogTbody.appendChild(tr);
      });
    } catch (err) {
      console.warn("Error loading transmission history:", err);
    }
  }

  handleSunrayTxLog(data) {
    const txLogTbody = document.getElementById('sunray-tx-log-tbody');
    if (!txLogTbody || !data) return;

    if (txLogTbody.children.length === 1 && txLogTbody.children[0].textContent.includes('No transmission records')) {
      txLogTbody.innerHTML = '';
    }

    const txId = data.transmissionId || data.id;
    let tr = txId ? txLogTbody.querySelector(`tr[data-tx-id="${txId}"]`) : null;

    if (tr) {
      tr.innerHTML = this.renderTxLogRowContent(data);
    } else {
      tr = document.createElement('tr');
      if (txId) tr.dataset.txId = txId;
      tr.innerHTML = this.renderTxLogRowContent(data);
      txLogTbody.insertBefore(tr, txLogTbody.firstChild);
    }
  }
}
