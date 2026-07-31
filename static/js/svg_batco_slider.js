// Interactive SVG BATCO Slider Manager - VirtualNet

export class BatcoSvgSliderManager {
  constructor() {
    this.container = null;
    this.svg = null;
    this.sliderGroup = null;
    this.sheet = null;
    this.isDragging = false;
    this.startSvgY = 0;
    this.currentOffsetY = 0;
    this.minOffsetY = -8.177;
    this.maxOffsetY = 109.799;
    this.rowStepHeight = 9.83; // 1 row step in SVG units
    this.isLoaded = false;
  }

  async initialize() {
    this.container = document.getElementById('batco-svg-wrapper');
    if (!this.container) return;

    try {
      const response = await fetch('/static/images/SVG/BATCO.svg');
      if (!response.ok) throw new Error('Failed to load BATCO.svg');
      const svgText = await response.text();
      this.container.innerHTML = svgText;

      this.svg = this.container.querySelector('svg');
      if (!this.svg) return;

      // Ensure SVG is responsive and fills container nicely
      this.svg.style.width = '100%';
      this.svg.style.height = '100%';
      this.svg.style.maxHeight = '100%';
      this.svg.style.objectFit = 'contain';

      this.sliderGroup = this.svg.getElementById('BATCO_SLIDER');
      this.sheet = this.svg.getElementById('BATCO');

      if (!this.sliderGroup || !this.sheet) {
        console.warn('BATCO or BATCO_SLIDER element not found in SVG');
        return;
      }

      // Calculate bounds & attach controls
      this.calculateBounds();
      this.addHitArea();
      this.attachEvents();
      this.attachButtonControls();
      this.attachTabListener();
      this.isLoaded = true;
    } catch (err) {
      console.error('Error loading SVG BATCO Slider:', err);
    }
  }

  calculateBounds() {
    if (!this.svg || !this.sheet || !this.sliderGroup) return;

    // Exact mathematical SVG user unit bounds for BATCO.svg:
    // Sheet top = 93.680435, Sheet bottom = 225.972105
    // Slider initial y = 101.85787, height = 14.31488 (initial bottom = 116.17275)
    const exactMin = 93.680435 - 101.85787;   // -8.177435
    const exactMax = 225.972105 - 116.17275;  // 109.799355

    try {
      const sheetBox = this.sheet.getBBox();
      const sliderBox = this.sliderGroup.getBBox();

      if (sheetBox.height > 0 && sliderBox.height > 0) {
        this.minOffsetY = sheetBox.y - sliderBox.y;
        this.maxOffsetY = (sheetBox.y + sheetBox.height - sliderBox.height) - sliderBox.y;
      } else {
        this.minOffsetY = exactMin;
        this.maxOffsetY = exactMax;
      }
    } catch (e) {
      this.minOffsetY = exactMin;
      this.maxOffsetY = exactMax;
    }

    this.rowStepHeight = (this.maxOffsetY - this.minOffsetY) / 12;
  }

  addHitArea() {
    if (!this.sliderGroup) return;
    try {
      let hitRect = this.sliderGroup.querySelector('.slider-hit-area');
      if (!hitRect) {
        hitRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        hitRect.setAttribute('class', 'slider-hit-area');
        this.sliderGroup.insertBefore(hitRect, this.sliderGroup.firstChild);
      }

      // Cover exact slider rectangle in SVG user units (40 to 176.5 x 101.8 to 116.3)
      hitRect.setAttribute('x', '40');
      hitRect.setAttribute('y', '101.8');
      hitRect.setAttribute('width', '136.5');
      hitRect.setAttribute('height', '14.5');
      hitRect.setAttribute('fill', 'transparent');
      hitRect.setAttribute('pointer-events', 'all');
      hitRect.style.cursor = 'ns-resize';
    } catch (e) {}
  }

  getSvgPoint(clientX, clientY) {
    const pt = this.svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const ctm = this.svg.getScreenCTM();
    return ctm ? pt.matrixTransform(ctm.inverse()) : { x: 0, y: 0 };
  }

  attachEvents() {
    if (!this.sliderGroup) return;

    this.sliderGroup.style.cursor = 'ns-resize';
    this.sliderGroup.style.touchAction = 'none';

    const getClientXY = (e) => {
      if (e.touches && e.touches.length > 0) {
        return { clientX: e.touches[0].clientX, clientY: e.touches[0].clientY };
      }
      if (e.changedTouches && e.changedTouches.length > 0) {
        return { clientX: e.changedTouches[0].clientX, clientY: e.changedTouches[0].clientY };
      }
      return { clientX: e.clientX, clientY: e.clientY };
    };

    const onStart = (e) => {
      // If Shift key is pressed, allow panning parent image
      if (e.shiftKey) return;
      if (e.button !== undefined && e.button !== 0) return;

      if (e.cancelable) e.preventDefault();
      e.stopPropagation();

      this.isDragging = true;
      const { clientX, clientY } = getClientXY(e);
      const svgPt = this.getSvgPoint(clientX, clientY);
      this.startSvgY = svgPt.y - this.currentOffsetY;

      window.addEventListener('mousemove', onMove, { passive: false });
      window.addEventListener('mouseup', onEnd, { passive: false });
      window.addEventListener('touchmove', onMove, { passive: false });
      window.addEventListener('touchend', onEnd, { passive: false });
      window.addEventListener('touchcancel', onEnd, { passive: false });
      window.addEventListener('pointermove', onMove, { passive: false });
      window.addEventListener('pointerup', onEnd, { passive: false });
      window.addEventListener('pointercancel', onEnd, { passive: false });
    };

    const onMove = (e) => {
      if (!this.isDragging) return;
      if (e.cancelable) e.preventDefault();
      e.stopPropagation();

      const { clientX, clientY } = getClientXY(e);
      const svgPt = this.getSvgPoint(clientX, clientY);
      let targetOffsetY = svgPt.y - this.startSvgY;

      // Clamp strictly within sheet bounds
      targetOffsetY = Math.max(this.minOffsetY, Math.min(this.maxOffsetY, targetOffsetY));
      this.currentOffsetY = targetOffsetY;

      this.sliderGroup.setAttribute('transform', `translate(0, ${this.currentOffsetY})`);
    };

    const onEnd = (e) => {
      if (!this.isDragging) return;
      this.isDragging = false;
      e.stopPropagation();

      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onEnd);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onEnd);
      window.removeEventListener('touchcancel', onEnd);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onEnd);
      window.removeEventListener('pointercancel', onEnd);
    };

    this.sliderGroup.addEventListener('mousedown', onStart, { passive: false });
    this.sliderGroup.addEventListener('touchstart', onStart, { passive: false });
    this.sliderGroup.addEventListener('pointerdown', onStart, { passive: false });
  }

  attachButtonControls() {
    const btnUp = document.getElementById('btn-slider-up');
    const btnDown = document.getElementById('btn-slider-down');

    if (btnUp) {
      btnUp.addEventListener('click', (e) => {
        e.preventDefault();
        this.stepRow(-1);
      });
    }

    if (btnDown) {
      btnDown.addEventListener('click', (e) => {
        e.preventDefault();
        this.stepRow(1);
      });
    }
  }

  attachTabListener() {
    const tabLink = document.getElementById('tab-batco-slider-link');
    if (tabLink) {
      tabLink.addEventListener('shown.bs.tab', () => {
        this.calculateBounds();
        this.addHitArea();
      });
    }
  }

  stepRow(direction) {
    // direction: -1 for Up, 1 for Down
    let targetOffsetY = this.currentOffsetY + (direction * this.rowStepHeight);
    targetOffsetY = Math.max(this.minOffsetY, Math.min(this.maxOffsetY, targetOffsetY));
    this.currentOffsetY = targetOffsetY;

    if (this.sliderGroup) {
      this.sliderGroup.setAttribute('transform', `translate(0, ${this.currentOffsetY})`);
    }
  }

  reset() {
    this.currentOffsetY = 0;
    if (this.sliderGroup) {
      this.sliderGroup.setAttribute('transform', `translate(0, 0)`);
    }
  }
}

export const batcoSvgSliderManager = new BatcoSvgSliderManager();
