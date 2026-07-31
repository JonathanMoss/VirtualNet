// Pan and Zoom Controller for Resource Images - VirtualNet

export class PanZoomController {
  constructor() {
    this.instances = new Map(); // imgId -> state object
  }

  attach(imgId) {
    const imgEl = document.getElementById(imgId);
    if (!imgEl) return;

    const viewport = imgEl.parentElement;
    if (!viewport) return;

    if (this.instances.has(imgId)) {
      this.reset(imgId);
      return;
    }

    const state = {
      imgEl,
      viewport,
      scale: 1,
      minScale: 0.5,
      maxScale: 5,
      translateX: 0,
      translateY: 0,
      isDragging: false,
      startX: 0,
      startY: 0,
      initialTX: 0,
      initialTY: 0,
      initialPinchDistance: null
    };

    this.instances.set(imgId, state);

    // Apply styles to viewport and image
    viewport.style.overflow = 'hidden';
    viewport.style.position = 'relative';
    viewport.style.userSelect = 'none';
    viewport.style.webkitUserSelect = 'none';
    imgEl.style.cursor = 'grab';
    imgEl.style.transformOrigin = 'center center';
    imgEl.style.transition = 'transform 0.05s ease-out';

    const updateTransform = () => {
      imgEl.style.transform = `translate(${state.translateX}px, ${state.translateY}px) scale(${state.scale})`;
    };

    state.updateTransform = updateTransform;

    const isNoPanTarget = (el) => {
      let curr = el;
      while (curr && curr !== document && curr !== viewport) {
        if (curr.id === 'BATCO_SLIDER' || (curr.classList && curr.classList.contains('no-pan'))) {
          return true;
        }
        curr = curr.parentNode || curr.parentElement;
      }
      return false;
    };

    // Mouse Down (Start Drag)
    viewport.addEventListener('mousedown', (e) => {
      if (e.button !== 0 || isNoPanTarget(e.target)) return;
      e.preventDefault();
      state.isDragging = true;
      state.startX = e.clientX;
      state.startY = e.clientY;
      state.initialTX = state.translateX;
      state.initialTY = state.translateY;
      imgEl.style.cursor = 'grabbing';
      imgEl.style.transition = 'none';
    });

    // Window Mouse Move (Dragging)
    window.addEventListener('mousemove', (e) => {
      if (!state.isDragging) return;
      e.preventDefault();
      const dx = e.clientX - state.startX;
      const dy = e.clientY - state.startY;
      state.translateX = state.initialTX + dx;
      state.translateY = state.initialTY + dy;
      updateTransform();
    });

    // Window Mouse Up (End Drag)
    window.addEventListener('mouseup', () => {
      if (state.isDragging) {
        state.isDragging = false;
        imgEl.style.cursor = 'grab';
        imgEl.style.transition = 'transform 0.05s ease-out';
      }
    });

    // Mouse Wheel (Zooming)
    viewport.addEventListener('wheel', (e) => {
      e.preventDefault();
      const zoomFactor = e.deltaY < 0 ? 1.15 : 0.85;
      const newScale = Math.min(Math.max(state.scale * zoomFactor, state.minScale), state.maxScale);
      state.scale = newScale;
      updateTransform();
    }, { passive: false });

    // Double Click to Reset or Zoom In
    viewport.addEventListener('dblclick', (e) => {
      if (isNoPanTarget(e.target)) return;
      e.preventDefault();
      if (state.scale > 1.1) {
        this.reset(imgId);
      } else {
        state.scale = 2.0;
        updateTransform();
      }
    });

    // Touch Events for Mobile / Touchscreens
    viewport.addEventListener('touchstart', (e) => {
      if (isNoPanTarget(e.target)) {
        state.isDragging = false;
        return;
      }
      if (e.touches.length === 1) {
        state.isDragging = true;
        state.startX = e.touches[0].clientX;
        state.startY = e.touches[0].clientY;
        state.initialTX = state.translateX;
        state.initialTY = state.translateY;
        imgEl.style.transition = 'none';
      } else if (e.touches.length === 2) {
        state.isDragging = false;
        state.initialPinchDistance = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
      }
    }, { passive: true });

    viewport.addEventListener('touchmove', (e) => {
      if (e.touches.length === 1 && state.isDragging) {
        const dx = e.touches[0].clientX - state.startX;
        const dy = e.touches[0].clientY - state.startY;
        state.translateX = state.initialTX + dx;
        state.translateY = state.initialTY + dy;
        updateTransform();
      } else if (e.touches.length === 2 && state.initialPinchDistance) {
        const currentDist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
        const factor = currentDist / state.initialPinchDistance;
        state.scale = Math.min(Math.max(state.scale * factor, state.minScale), state.maxScale);
        state.initialPinchDistance = currentDist;
        updateTransform();
      }
    }, { passive: true });

    viewport.addEventListener('touchend', (e) => {
      if (e.touches.length < 2) {
        state.initialPinchDistance = null;
      }
      if (e.touches.length === 0) {
        state.isDragging = false;
        imgEl.style.transition = 'transform 0.05s ease-out';
      }
    });
  }

  zoomIn(imgId) {
    const state = this.instances.get(imgId);
    if (!state) return;
    state.scale = Math.min(state.scale * 1.25, state.maxScale);
    state.updateTransform();
  }

  zoomOut(imgId) {
    const state = this.instances.get(imgId);
    if (!state) return;
    state.scale = Math.max(state.scale / 1.25, state.minScale);
    state.updateTransform();
  }

  reset(imgId) {
    const state = this.instances.get(imgId);
    if (!state) return;
    state.scale = 1;
    state.translateX = 0;
    state.translateY = 0;
    state.updateTransform();
  }

  initGlobalZoomButtons() {
    document.querySelectorAll('.btn-zoom-in').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const targetId = e.currentTarget.getAttribute('data-target');
        if (targetId) this.zoomIn(targetId);
      });
    });

    document.querySelectorAll('.btn-zoom-out').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const targetId = e.currentTarget.getAttribute('data-target');
        if (targetId) this.zoomOut(targetId);
      });
    });

    document.querySelectorAll('.btn-zoom-reset').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const targetId = e.currentTarget.getAttribute('data-target');
        if (targetId) this.reset(targetId);
      });
    });
  }
}

export const panZoomController = new PanZoomController();
