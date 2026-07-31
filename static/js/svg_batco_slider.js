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
    this.minOffsetY = 0;
    this.maxOffsetY = 0;
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

      // Allow DOM to settle before calculating bounding boxes
      requestAnimationFrame(() => {
        this.calculateBounds();
        this.attachEvents();
        this.isLoaded = true;
      });
    } catch (err) {
      console.error('Error loading SVG BATCO Slider:', err);
    }
  }

  calculateBounds() {
    if (!this.svg || !this.sheet || !this.sliderGroup) return;

    try {
      const sheetBox = this.sheet.getBBox();
      const sliderBox = this.sliderGroup.getBBox();

      // Top limit: slider top aligns with sheet top
      this.minOffsetY = sheetBox.y - sliderBox.y;

      // Bottom limit: slider bottom aligns with sheet bottom
      this.maxOffsetY = (sheetBox.y + sheetBox.height - sliderBox.height) - sliderBox.y;
    } catch (e) {
      // Fallback numbers if getBBox fails before render
      this.minOffsetY = -8.18;
      this.maxOffsetY = 109.80;
    }
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

    // Styling slider group for clear drag interaction
    this.sliderGroup.style.cursor = 'ns-resize';
    this.sliderGroup.style.touchAction = 'none';

    // Pointer down handler
    const onPointerDown = (e) => {
      e.stopPropagation(); // Prevent pan-zoom viewport drag
      this.isDragging = true;

      const svgPt = this.getSvgPoint(e.clientX, e.clientY);
      this.startSvgY = svgPt.y - this.currentOffsetY;

      if (this.sliderGroup.setPointerCapture && e.pointerId !== undefined) {
        try {
          this.sliderGroup.setPointerCapture(e.pointerId);
        } catch (err) {}
      }

      window.addEventListener('pointermove', onPointerMove, { passive: false });
      window.addEventListener('pointerup', onPointerUp, { passive: false });
      window.addEventListener('pointercancel', onPointerUp, { passive: false });
    };

    // Pointer move handler
    const onPointerMove = (e) => {
      if (!this.isDragging) return;
      e.preventDefault();
      e.stopPropagation();

      const svgPt = this.getSvgPoint(e.clientX, e.clientY);
      let targetOffsetY = svgPt.y - this.startSvgY;

      // Clamp strictly within sheet bounds
      targetOffsetY = Math.max(this.minOffsetY, Math.min(this.maxOffsetY, targetOffsetY));
      this.currentOffsetY = targetOffsetY;

      this.sliderGroup.setAttribute('transform', `translate(0, ${this.currentOffsetY})`);
    };

    // Pointer up handler
    const onPointerUp = (e) => {
      if (!this.isDragging) return;
      this.isDragging = false;
      e.stopPropagation();

      if (this.sliderGroup.releasePointerCapture && e.pointerId !== undefined) {
        try {
          this.sliderGroup.releasePointerCapture(e.pointerId);
        } catch (err) {}
      }

      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
    };

    this.sliderGroup.addEventListener('pointerdown', onPointerDown, { passive: false });
  }

  reset() {
    this.currentOffsetY = 0;
    if (this.sliderGroup) {
      this.sliderGroup.setAttribute('transform', `translate(0, 0)`);
    }
  }
}

export const batcoSvgSliderManager = new BatcoSvgSliderManager();
