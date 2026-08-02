/**
 * VirtualNet - Instructor & Net Control Dashboard Controller
 * Manages live telemetry, scenario inject creation/dispatching, and net state mode controls.
 */

export function initInstructorDashboard(socket) {
  const panel = document.getElementById('instructor-dashboard-section');
  const admissionsTbody = document.getElementById('admissions-tbody');
  const rosterTbody = document.getElementById('instructor-roster-tbody');
  const injectsTbody = document.getElementById('injects-tbody');
  const masterLogTbody = document.getElementById('master-log-tbody');
  
  const netStateBadge = document.getElementById('inst-net-state-badge');
  const btnStateDirected = document.getElementById('btn-net-state-directed');
  const btnStateFree = document.getElementById('btn-net-state-free');
  const activeStationCountEl = document.getElementById('inst-active-station-count');
  const injectCountBadge = document.getElementById('inst-inject-count-badge');
  const queueBadge = document.getElementById('sunray-queue-badge');

  const formCreateInject = document.getElementById('form-create-inject');
  const btnExportMasterLog = document.getElementById('btn-export-master-log');

  if (!panel) return;

  // ==================== NET MODE SWITCHING ====================
  if (btnStateDirected && btnStateFree) {
    btnStateDirected.addEventListener('click', () => {
      socket.emit('set_net_state', { netState: 'DIRECTED' });
    });
    btnStateFree.addEventListener('click', () => {
      socket.emit('set_net_state', { netState: 'FREE' });
    });
  }

  socket.on('net_state_changed', (data) => {
    const mode = data.netState || 'DIRECTED';
    if (netStateBadge) {
      netStateBadge.textContent = `${mode} NET`;
      netStateBadge.className = mode === 'FREE' ? 'badge bg-info text-dark' : 'badge bg-warning text-dark';
    }
    if (btnStateDirected && btnStateFree) {
      if (mode === 'FREE') {
        btnStateFree.classList.add('active', 'btn-info');
        btnStateFree.classList.remove('btn-outline-info');
        btnStateDirected.classList.remove('active');
        btnStateDirected.classList.add('btn-outline-warning');
      } else {
        btnStateDirected.classList.add('active');
        btnStateDirected.classList.remove('btn-outline-warning');
        btnStateFree.classList.remove('active', 'btn-info');
        btnStateFree.classList.add('btn-outline-info');
      }
    }
  });

  // ==================== SCENARIO INJECT MANAGEMENT ====================
  
  // Preset Inject Click Handlers
  document.querySelectorAll('.btn-preset-inject').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const title = btn.getAttribute('data-title');
      const desc = btn.getAttribute('data-desc');
      const titleInput = document.getElementById('inject-title');
      const descInput = document.getElementById('inject-description');
      if (titleInput && descInput) {
        titleInput.value = title;
        descInput.value = desc;
      }
    });
  });

  // Create Inject Form Submit
  if (formCreateInject) {
    formCreateInject.addEventListener('submit', (e) => {
      e.preventDefault();
      const title = document.getElementById('inject-title')?.value.trim();
      const targetCallSign = document.getElementById('inject-target')?.value.trim();
      const description = document.getElementById('inject-description')?.value.trim();

      if (!title || !description) return;

      socket.emit('create_inject', {
        title,
        description,
        target_call_sign: targetCallSign || null,
        time_offset_seconds: 0
      });

      if (document.getElementById('inject-title')) document.getElementById('inject-title').value = '';
      if (document.getElementById('inject-target')) document.getElementById('inject-target').value = '';
      if (document.getElementById('inject-description')) document.getElementById('inject-description').value = '';
    });
  }

  // Socket Listener: Telemetry Update
  socket.on('telemetry_update', (telemetry) => {
    if (!telemetry || !telemetry.success) return;

    // Update active stations count
    if (activeStationCountEl) activeStationCountEl.textContent = telemetry.stationCount || 0;

    // Update net state badge
    if (netStateBadge && telemetry.netState) {
      netStateBadge.textContent = `${telemetry.netState} NET`;
    }

    // Render Admissions Queue & Roster
    renderRosterAndQueue(telemetry.stations || []);

    // Render Injects
    renderInjects(telemetry.injects || []);

    // Request Master Log sync
    if (telemetry.pin) {
      fetchMasterLogs(telemetry.pin);
    }
  });

  // Render Injects List
  function renderInjects(injects) {
    if (injectCountBadge) injectCountBadge.textContent = injects.length;
    if (!injectsTbody) return;

    if (injects.length === 0) {
      injectsTbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted py-2">No scenario injects created.</td></tr>';
      return;
    }

    injectsTbody.innerHTML = injects.map(inj => `
      <tr>
        <td class="fw-bold text-warning">${escapeHtml(inj.title)}</td>
        <td><span class="badge bg-secondary">${escapeHtml(inj.targetCallSign || 'BROADCAST')}</span></td>
        <td class="small text-truncate" style="max-width: 250px;" title="${escapeHtml(inj.description)}">${escapeHtml(inj.description)}</td>
        <td><span class="badge ${inj.status === 'DISPATCHED' ? 'bg-success' : 'bg-warning text-dark'}">${inj.status}</span></td>
        <td>
          ${inj.status === 'PENDING' ? `
            <button class="btn btn-xs btn-warning btn-dispatch-inject py-0 px-2 small" data-id="${inj.id}">🚀 DISPATCH</button>
            <button class="btn btn-xs btn-outline-danger btn-delete-inject py-0 px-1 small" data-id="${inj.id}">✕</button>
          ` : '<span class="text-muted small">Sent</span>'}
        </td>
      </tr>
    `).join('');

    // Attach dispatch buttons
    injectsTbody.querySelectorAll('.btn-dispatch-inject').forEach(btn => {
      btn.addEventListener('click', () => {
        const injectId = btn.getAttribute('data-id');
        socket.emit('dispatch_inject', { injectId });
      });
    });

    // Attach delete buttons
    injectsTbody.querySelectorAll('.btn-delete-inject').forEach(btn => {
      btn.addEventListener('click', () => {
        const injectId = btn.getAttribute('data-id');
        socket.emit('delete_inject', { injectId });
      });
    });
  }

  // Render Admissions Queue & Active Roster
  function renderRosterAndQueue(stations) {
    const unassigned = stations.filter(s => s.status === 'AWAITING_ASSIGNMENT');
    const active = stations.filter(s => s.status !== 'AWAITING_ASSIGNMENT');

    if (queueBadge) {
      if (unassigned.length > 0) {
        queueBadge.textContent = `${unassigned.length} WAITING`;
        queueBadge.classList.remove('d-none');
      } else {
        queueBadge.classList.add('d-none');
      }
    }

    // Admissions Table
    if (admissionsTbody) {
      if (unassigned.length === 0) {
        admissionsTbody.innerHTML = '<tr><td colspan="4" class="text-center text-muted py-2">No students waiting in queue.</td></tr>';
      } else {
        admissionsTbody.innerHTML = unassigned.map(s => `
          <tr>
            <td class="fw-bold text-light">${escapeHtml(s.nickname)}</td>
            <td><span class="badge bg-secondary">${s.role}</span></td>
            <td>
              <input type="text" class="form-control form-control-sm bg-dark text-light border-warning input-assign-cs" placeholder="e.g. 11" style="width: 90px;" data-id="${s.id}">
            </td>
            <td>
              <button class="btn btn-sm btn-warning btn-confirm-assign py-0 px-2" data-id="${s.id}">Assign</button>
            </td>
          </tr>
        `).join('');

        admissionsTbody.querySelectorAll('.btn-confirm-assign').forEach(btn => {
          btn.addEventListener('click', () => {
            const stationId = btn.getAttribute('data-id');
            const input = admissionsTbody.querySelector(`.input-assign-cs[data-id="${stationId}"]`);
            const callSign = input?.value.trim();
            if (callSign) {
              socket.emit('assign_callsign', { stationId, callSign, role: 'SUB_STATION' });
            }
          });
        });
      }
    }

    // Active Roster Table
    if (rosterTbody) {
      if (active.length === 0) {
        rosterTbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted py-2">No active stations.</td></tr>';
      } else {
        rosterTbody.innerHTML = active.map(s => `
          <tr>
            <td class="fw-bold text-warning">${escapeHtml(s.callSign || s.nickname)}</td>
            <td>${escapeHtml(s.nickname)}</td>
            <td><span class="badge bg-secondary">${s.role}</span></td>
            <td>
              <span class="badge ${s.transmissionStatus === 'TRANSMITTING' ? 'bg-danger animate-pulse' : 'bg-success'}">
                ${s.transmissionStatus === 'TRANSMITTING' ? '🎙 TALKING' : 'IDLE'}
              </span>
            </td>
            <td>
              <button class="btn btn-xs btn-outline-warning btn-edit-cs py-0 px-1 small" data-id="${s.id}" data-cs="${s.callSign || ''}">Edit</button>
              ${s.role !== 'SUNRAY' ? `<button class="btn btn-xs btn-outline-danger btn-kick-st py-0 px-1 small" data-id="${s.id}">Kick</button>` : ''}
            </td>
          </tr>
        `).join('');

        rosterTbody.querySelectorAll('.btn-edit-cs').forEach(btn => {
          btn.addEventListener('click', () => {
            const stationId = btn.getAttribute('data-id');
            const currentCs = btn.getAttribute('data-cs');
            const newCs = prompt('Enter updated Callsign:', currentCs);
            if (newCs && newCs.trim() !== currentCs) {
              socket.emit('assign_callsign', { stationId, callSign: newCs.trim() });
            }
          });
        });

        rosterTbody.querySelectorAll('.btn-kick-st').forEach(btn => {
          btn.addEventListener('click', () => {
            const stationId = btn.getAttribute('data-id');
            if (confirm('Are you sure you want to kick this station from the net?')) {
              socket.emit('kick_station', { stationId });
            }
          });
        });
      }
    }
  }

  // Fetch Master Logs via API
  function fetchMasterLogs(pin) {
    if (!masterLogTbody || !pin) return;
    fetch(`/api/session/${pin}/logs`)
      .then(res => res.json())
      .then(data => {
        if (!data.logs || data.logs.length === 0) {
          masterLogTbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted py-2">No master log entries recorded.</td></tr>';
          return;
        }

        masterLogTbody.innerHTML = data.logs.map(log => `
          <tr>
            <td class="font-monospace text-warning small">${escapeHtml(log.dtg)}</td>
            <td class="fw-bold">${escapeHtml(log.fromCallSign)}</td>
            <td class="fw-bold">${escapeHtml(log.toCallSign)}</td>
            <td><span class="badge ${log.precedence === 'FLASH' ? 'bg-danger' : log.precedence === 'IMMEDIATE' ? 'bg-warning text-dark' : 'bg-secondary'}">${log.precedence}</span></td>
            <td>${escapeHtml(log.eventText)}</td>
            <td class="small text-muted">${escapeHtml(log.operatorInitials)}</td>
          </tr>
        `).join('');
      })
      .catch(err => console.error("Error fetching master logs:", err));
  }

  // Export Master Log
  if (btnExportMasterLog) {
    btnExportMasterLog.addEventListener('click', () => {
      const pinBadge = document.getElementById('header-net-pin');
      const pin = pinBadge ? pinBadge.textContent.replace('PIN:', '').trim() : '';
      if (!pin) return;

      fetch(`/api/session/${pin}/logs`)
        .then(res => res.json())
        .then(data => {
          const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `VirtualNet_Master_Log_${pin}.json`;
          a.click();
          URL.revokeObjectURL(url);
        });
    });
  }

  // Listen for inject_dispatched on student / participant screens
  socket.on('inject_dispatched', (inject) => {
    if (!inject) return;
    showInjectNotification(inject);
  });
}

function showInjectNotification(inject) {
  const modalEl = document.getElementById('modal-inject-notification');
  const titleEl = document.getElementById('inject-modal-title');
  const targetEl = document.getElementById('inject-modal-target');
  const descEl = document.getElementById('inject-modal-desc');

  if (titleEl) titleEl.textContent = inject.title || 'INJECT';
  if (targetEl) targetEl.textContent = `TARGET: ${inject.targetCallSign || 'ALL STATIONS'}`;
  if (descEl) descEl.textContent = inject.description || '';

  if (modalEl && window.bootstrap) {
    const bsModal = new window.bootstrap.Modal(modalEl);
    bsModal.show();
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
