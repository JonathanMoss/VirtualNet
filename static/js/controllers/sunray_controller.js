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

  renderAdmissionsQueue(queue) {
    const tbody = document.getElementById('admissions-tbody');
    const headerBar = document.getElementById('app-header-bar');
    if (!tbody) return;

    if (headerBar) {
      if (queue && queue.length > 0 && this.app.myRole === 'SUNRAY') {
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
      const tr = document.createElement('tr');
      tr.className = 'align-middle';
      tr.innerHTML = `
        <td class="text-phosphor-green font-weight-bold py-1">${item.nickname}</td>
        <td class="py-1">
          <input type="text" class="form-control form-control-sm text-uppercase input-assign-cs monospace py-0" 
                 placeholder="e.g. R11" maxlength="8" style="width: 90px;" value="${item.suggestedCallSign || ''}">
        </td>
        <td class="py-1">
          <select class="form-select form-select-sm select-assign-role monospace py-0" style="width: 130px;">
            <option value="SUB_STATION" ${item.role === 'SUB_STATION' ? 'selected' : ''}>SUB_STATION</option>
            <option value="CONTROL" ${item.role === 'CONTROL' ? 'selected' : ''}>CONTROL</option>
            <option value="INSTRUCTOR" ${item.role === 'INSTRUCTOR' ? 'selected' : ''}>INSTRUCTOR</option>
          </select>
        </td>
        <td class="text-end py-1">
          <button type="button" class="btn btn-tactical btn-sm py-0 btn-do-assign" data-station-id="${item.stationId}">ASSIGN</button>
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
        this.app.socketManager.assignCallsign(item.stationId, callSign, role);
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

    tbody.innerHTML = '';
    if (!stations || stations.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="text-muted text-center py-2">NO ACTIVE STATIONS</td></tr>';
      return;
    }

    stations.forEach(st => {
      const tr = document.createElement('tr');
      tr.className = 'align-middle';
      const isMe = st.id === this.app.myStationId ? ' <span class="text-warning small">(YOU)</span>' : '';
      const isSunrayRole = st.role === 'SUNRAY' || st.role === 'INSTRUCTOR' || st.role === 'CONTROL';

      tr.innerHTML = `
        <td class="text-phosphor-green font-weight-bold py-1 me-1">${st.callSign || 'AWAITING'}</td>
        <td class="text-muted py-1">${st.nickname}${isMe}</td>
        <td class="py-1"><span class="badge ${isSunrayRole ? 'bg-warning text-dark' : 'bg-secondary text-light'} py-0">${st.role}</span></td>
        <td class="py-1"><span class="badge ${st.status === 'TALKING' ? 'bg-danger text-white pulse-glow' : 'bg-success text-dark'} py-0">${st.status}</span></td>
        <td class="text-end py-1">
          ${st.id !== this.app.myStationId ? `
            <button type="button" class="btn btn-outline-info btn-sm py-0 me-1 btn-edit-cs" data-station-id="${st.id}" data-cs="${st.callSign || ''}">EDIT CS</button>
            <button type="button" class="btn btn-outline-danger btn-sm py-0 btn-kick-st" data-station-id="${st.id}" data-nick="${st.nickname}">KICK</button>
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
            this.app.socketManager.assignCallsign(st.id, newCs.trim().toUpperCase(), st.role);
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
            this.app.socketManager.kickStation(st.id);
          }
        });
      }

      tbody.appendChild(tr);
    });
  }
}
