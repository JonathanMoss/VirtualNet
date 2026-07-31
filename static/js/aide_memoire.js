// Aide Memoire Module - VirtualNet
import { panZoomController } from './pan_zoom.js';
import { batcoSvgSliderManager } from './svg_batco_slider.js';

export class AideMemoireManager {
  constructor() {
    this.drawer = null;
    this.btnTab = document.getElementById('btn-aide-memoire-tab');

    // Main workspace tab references
    this.mainVocabSelect = document.getElementById('main-vocab-select');
    this.mainSlateSelect = document.getElementById('main-slate-select');

    // Define Vocab card filenames (Card 001 - 012)
    this.vocabList = [
      "001-OPS 1",
      "002-OPS 2",
      "003-OPS 3",
      "004-FIRE SP",
      "005-ATK",
      "006-ENGRS",
      "007-COMMS",
      "008-AVN",
      "009-LOG1",
      "010-LOG2",
      "011-LOG3",
      "012-SPEC OPS"
    ];
  }

  initialize() {
    // Instantiate Bootstrap Offcanvas drawer
    const drawerEl = document.getElementById('aideMemoireDrawer');
    if (drawerEl) {
      this.drawer = new bootstrap.Offcanvas(drawerEl);
    }

    if (this.btnTab) {
      this.btnTab.addEventListener('click', () => {
        if (this.drawer) this.drawer.toggle();
      });
    }

    // Populate vocab card dropdown
    if (this.mainVocabSelect) {
      this.populateVocabSelect(this.mainVocabSelect);
      this.mainVocabSelect.addEventListener('change', () => this.renderVocabCard());
    }

    if (this.mainSlateSelect) {
      this.mainSlateSelect.addEventListener('change', () => this.renderSlateCard());
    }

    // Initial renders
    this.renderVocabCard();
    this.renderSlateCard();

    // Initialize SVG BATCO Slider
    batcoSvgSliderManager.initialize();

    // Attach Pan & Zoom functionality to main workspace resource images & SVG wrapper
    ['batco-svg-wrapper', 'main-batco-img', 'main-vocab-img', 'main-slate-img', 'main-logging-img'].forEach(imgId => {
      panZoomController.attach(imgId);
    });

    panZoomController.initGlobalZoomButtons();
  }

  populateVocabSelect(selectElement) {
    if (!selectElement) return;
    selectElement.innerHTML = '';
    this.vocabList.forEach(cardKey => {
      const opt = document.createElement('option');
      opt.value = cardKey;
      opt.textContent = cardKey;
      selectElement.appendChild(opt);
    });
  }

  renderVocabCard() {
    if (!this.mainVocabSelect) return;
    const imgEl = document.getElementById('main-vocab-img');
    if (imgEl && this.mainVocabSelect.value) {
      imgEl.src = `/static/images/VOCAB/${encodeURIComponent(this.mainVocabSelect.value)}.png`;
      imgEl.alt = this.mainVocabSelect.value;
      panZoomController.reset('main-vocab-img');
    }
  }

  renderSlateCard() {
    if (!this.mainSlateSelect) return;
    const imgEl = document.getElementById('main-slate-img');
    if (imgEl && this.mainSlateSelect.value) {
      imgEl.src = `/static/images/SLATE/${encodeURIComponent(this.mainSlateSelect.value)}.png`;
      imgEl.alt = this.mainSlateSelect.value;
      panZoomController.reset('main-slate-img');
    }
  }
}
