/**
 * Roster Controller - VirtualNet
 * Manages active net station roster rendering, status indicators, and sidebar collapsible UI states.
 */

export class RosterController {
  constructor(app) {
    this.app = app;
  }

  setupFoldToggle() {
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

  renderRoster(stations) {
    const list = document.getElementById('roster-list');
    if (!list) return;

    list.innerHTML = '';
    if (!stations || stations.length === 0) {
      list.innerHTML = '<li class="list-group-item bg-transparent text-muted small py-2">NO ACTIVE STATIONS</li>';
      return;
    }

    stations.forEach(st => {
      const li = document.createElement('li');
      li.className = 'list-group-item bg-transparent border-0 d-flex justify-content-between align-items-center py-1 px-2 monospace small';
      li.setAttribute('data-station-id', st.id);

      let badgeClass = 'bg-secondary text-dark';
      let statusText = st.status;

      if (st.status === 'TALKING') {
        badgeClass = 'bg-danger text-white pulse-glow';
        statusText = 'TALKING';
      } else if (st.status === 'ACTIVE') {
        badgeClass = 'bg-success text-dark';
        statusText = 'IDLE';
      } else if (st.status === 'UNWORKABLE') {
        badgeClass = 'bg-warning text-dark';
        statusText = 'UNWORKABLE';
      } else if (st.status === 'AWAITING') {
        badgeClass = 'bg-dark text-warning border border-warning';
        statusText = 'AWAITING';
      }

      const roleBadge = st.role === 'SUNRAY' || st.role === 'CONTROL' || st.role === 'INSTRUCTOR'
        ? '<span class="badge bg-warning text-dark me-1">SUNRAY</span>'
        : '';

      const isMe = st.id === this.app.myStationId ? ' <span class="text-warning fw-bold">(YOU)</span>' : '';

      li.innerHTML = `
        <div class="text-truncate me-2">
          ${roleBadge}
          <strong class="text-phosphor-green">${st.callSign || 'N/A'}</strong>
          <span class="text-muted small">(${st.nickname})</span>${isMe}
        </div>
        <span class="badge ${badgeClass} text-uppercase font-weight-bold" style="font-size: 0.75rem;">${statusText}</span>
      `;
      list.appendChild(li);
    });
  }

  updateStationState(stationId, status) {
    const li = document.querySelector(`[data-station-id="${stationId}"]`);
    if (!li) return;
    const badge = li.querySelector('.badge:last-child');
    if (!badge) return;

    if (status === 'TALKING') {
      badge.className = 'badge bg-danger text-white pulse-glow text-uppercase font-weight-bold';
      badge.textContent = 'TALKING';
    } else if (status === 'ACTIVE' || status === 'IDLE') {
      badge.className = 'badge bg-success text-dark text-uppercase font-weight-bold';
      badge.textContent = 'IDLE';
    } else if (status === 'UNWORKABLE') {
      badge.className = 'badge bg-warning text-dark text-uppercase font-weight-bold';
      badge.textContent = 'UNWORKABLE';
    }
  }
}
