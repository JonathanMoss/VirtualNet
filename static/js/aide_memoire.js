// Aide Memoire Module - VirtualNet

export class AideMemoireManager {
  constructor() {
    this.drawer = null;
    this.btnTab = document.getElementById('btn-aide-memoire-tab');
    this.btnBatcoUp = document.getElementById('btn-batco-up');
    this.btnBatcoDown = document.getElementById('btn-batco-down');
    this.vocabSelect = document.getElementById('select-vocab-card');
    this.vocabSearch = document.getElementById('search-vocab');
    this.vocabTbody = document.getElementById('vocab-tbody');
    this.slateSelect = document.getElementById('select-slate-template');
    this.slateContent = document.getElementById('slate-card-content');
    this.batcoTbody = document.getElementById('batco-tbody');

    // Main workspace tab references (Issue #15)
    this.mainBatcoTbody = document.getElementById('main-batco-tbody');
    this.mainVocabSelect = document.getElementById('main-vocab-select');
    this.mainVocabSearch = document.getElementById('main-vocab-search');
    this.mainVocabTbody = document.getElementById('main-vocab-tbody');
    this.mainSlateSelect = document.getElementById('main-slate-select');
    this.mainSlateContent = document.getElementById('main-slate-content');
    
    this.batcoActiveRow = 0; // Index of highlighted row
    this.batcoRowsCount = 12; // Row A to L

    // Define BATCO scrambled codes grid
    this.batcoGrid = [
      { name: "Row A (I)", codes: ["W", "F", "M", "Q", "P", "T", "V", "R", "D", "K"] },
      { name: "Row B (II)", codes: ["J", "O", "C", "S", "Y", "N", "U", "L", "H", "B"] },
      { name: "Row C (III)", codes: ["A", "Z", "X", "E", "G", "I", "W", "P", "T", "F"] },
      { name: "Row D (IV)", codes: ["K", "M", "D", "R", "V", "Q", "S", "C", "Y", "O"] },
      { name: "Row E (V)", codes: ["H", "L", "U", "N", "J", "B", "Z", "X", "G", "A"] },
      { name: "Row F (VI)", codes: ["Q", "V", "P", "T", "M", "D", "W", "K", "R", "S"] },
      { name: "Row G (VII)", codes: ["C", "Y", "O", "J", "S", "N", "L", "B", "U", "H"] },
      { name: "Row H (VIII)", codes: ["E", "I", "A", "Z", "G", "W", "F", "T", "P", "X"] },
      { name: "Row I (IX)", codes: ["R", "D", "M", "Q", "V", "K", "S", "O", "C", "P"] },
      { name: "Row J (X)", codes: ["L", "U", "N", "B", "J", "H", "Y", "A", "Z", "W"] },
      { name: "Row K (XI)", codes: ["G", "X", "E", "F", "I", "T", "Q", "P", "M", "R"] },
      { name: "Row L (XII)", codes: ["O", "C", "S", "Y", "J", "N", "U", "B", "H", "D"] }
    ];

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

    // Tactical Slate Cards
    this.slates = {
      "SITREP": `SITREP TEMPLATE
-----------------------------
LINE 1: DTG (Date Time Group)
LINE 2: UNIT / CALLSIGN
LINE 3: ENEMY ACTIVITY / LOC
LINE 4: OWN SITUATION / GRID
LINE 5: INTENTION / NEXT MOVE
LINE 6: ADMIN & LOGISTICS`,
      "MIST": `MIST CASUALTY REPORT
-----------------------------
M - MECHANISM OF INJURY
I - INJURIES SUSTAINED
S - SIGNS & VITAL STATS
T - TREATMENT GIVEN`,
      "MEDEVAC": `9-LINE MEDEVAC SLATE
-----------------------------
LINE 1: LOCATION OF PICKUP (GRID)
LINE 2: FREQ & CALL SIGN AT SITE
LINE 3: NUMBER OF PATIENTS BY PRECEDENCE
LINE 4: SPECIAL EQUIPMENT REQUIRED
LINE 5: NUMBER OF PATIENTS BY TYPE
LINE 6: SECURITY AT PICKUP SITE
LINE 7: METHOD OF MARKING SITE
LINE 8: PATIENT NATIONALITY & STATUS
LINE 9: NBC CONTAMINATION / TERRAIN`,
      "CFF": `CALL FOR FIRE (CFF) SLATE
-----------------------------
1. OBSERVER IDENTIFICATION & WARN O
2. TARGET LOCATION (GRID 6/8 FIG)
3. TARGET DESCRIPTION
4. METHOD OF ENGAGEMENT
5. METHOD OF FIRE AND CONTROL`,
      "QAOS": `QUICK ATTACK ORDERS (QAOS)
-----------------------------
Q - QUICK OBJECTIVE / GROUND
A - AXIS OF ADVANCE
O - ORDERS & TASK ALLOCATION
S - SIGNALS & TIMINGS`,
      "JAMREP": `JAMREP (JAMMING REPORT)
-----------------------------
1. CALL SIGN AFFECTED
2. FREQUENCY / BAND JAMMED
3. TYPE OF INTERFERENCE / NOISE
4. SIGNAL STRENGTH & BEARING
5. TIME STARTED / DURATION`,
      "EQUIPRECREQ": `RECOVERY REQUEST (EQUIPRECREQ)
-----------------------------
1. CALLSIGN & LOCATION
2. VEHICLE TYPE & REGISTRATION
3. NATURE OF CASUALTY / FAULT
4. RECOVERY METHOD REQUIRED`,
      "EOINCREP": `EOINCREP (EXPLOSIVE ORDNANCE)
-----------------------------
1. DTG & DISCOVERER
2. EXACT LOCATION (GRID)
3. ITEM TYPE & DESCRIPTION
4. HAZARD TO FRIENDLY / CIVILIAN`
    };
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

    if (this.btnBatcoUp) {
      this.btnBatcoUp.addEventListener('click', () => this.moveBatcoSlider(-1));
    }
    if (this.btnBatcoDown) {
      this.btnBatcoDown.addEventListener('click', () => this.moveBatcoSlider(1));
    }

    // Populate vocab card dropdowns
    this.populateVocabSelect(this.vocabSelect);
    if (this.mainVocabSelect) this.populateVocabSelect(this.mainVocabSelect);

    if (this.vocabSelect) {
      this.vocabSelect.addEventListener('change', () => this.renderVocabCard());
    }
    if (this.mainVocabSelect) {
      this.mainVocabSelect.addEventListener('change', () => this.renderVocabCard());
    }
    if (this.vocabSearch) {
      this.vocabSearch.addEventListener('input', () => this.renderVocabCard());
    }
    if (this.mainVocabSearch) {
      this.mainVocabSearch.addEventListener('input', () => this.renderVocabCard());
    }

    if (this.slateSelect) {
      this.slateSelect.addEventListener('change', () => this.renderSlateCard());
    }
    if (this.mainSlateSelect) {
      this.mainSlateSelect.addEventListener('change', () => this.renderSlateCard());
    }

    // Initial renders
    this.renderBatcoTable();
    this.renderVocabCard();
    this.renderSlateCard();
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

  renderBatcoTable() {
    const renderTbody = (tbodyEl) => {
      if (!tbodyEl) return;
      tbodyEl.innerHTML = '';
      this.batcoGrid.forEach((row, rIdx) => {
        const tr = document.createElement('tr');
        if (rIdx === this.batcoActiveRow) {
          tr.classList.add('batco-row-highlight');
        }
        let html = `<td><b>${row.name.split(' ')[1]}</b></td>`;
        row.codes.forEach(code => {
          html += `<td>${code}</td>`;
        });
        tr.innerHTML = html;
        tbodyEl.appendChild(tr);
      });
    };

    renderTbody(this.batcoTbody);
    renderTbody(this.mainBatcoTbody);

    const label = document.getElementById('batco-active-row-name');
    if (label) {
      label.textContent = this.batcoGrid[this.batcoActiveRow].name;
    }
  }

  moveBatcoSlider(dir) {
    this.batcoActiveRow += dir;
    if (this.batcoActiveRow < 0) this.batcoActiveRow = 0;
    if (this.batcoActiveRow >= this.batcoRowsCount) this.batcoActiveRow = this.batcoRowsCount - 1;
    this.renderBatcoTable();
  }

  renderVocabCard() {
    const updateImg = (selectEl, imgId) => {
      if (!selectEl) return;
      const imgEl = document.getElementById(imgId);
      if (imgEl && selectEl.value) {
        imgEl.src = `/static/images/VOCAB/${encodeURIComponent(selectEl.value)}.png`;
        imgEl.alt = selectEl.value;
      }
    };

    updateImg(this.vocabSelect, 'vocab-card-img');
    updateImg(this.mainVocabSelect, 'main-vocab-img');
  }

  renderSlateCard() {
    const updateImg = (selectEl, imgId) => {
      if (!selectEl) return;
      const imgEl = document.getElementById(imgId);
      if (imgEl && selectEl.value) {
        imgEl.src = `/static/images/SLATE/${encodeURIComponent(selectEl.value)}.png`;
        imgEl.alt = selectEl.value;
      }
    };

    updateImg(this.slateSelect, 'slate-card-img');
    updateImg(this.mainSlateSelect, 'main-slate-img');
  }
}
