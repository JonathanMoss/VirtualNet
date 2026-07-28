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

    // Define Vocab card datasets (Card 001 - 012)
    this.vocabCards = {
      "Card 001 (OPS 1)": [
        { code: "00", plain: "ADVANCE TO / ADVANCING" },
        { code: "04", plain: "AMBUSH INITIATED / COMMANDED" },
        { code: "08", plain: "ATTACK COMPLETED / OBJECTIVE SECURED" },
        { code: "12", plain: "BOUNDARY / LIMIT OF EXPLOITATION" },
        { code: "35", plain: "MISSION CONFIRMED / ASSIGNED" },
        { code: "36", plain: "MOVE TO GRID REFERENCE (6 FIGURE)" },
        { code: "40", plain: "RECONNAISSANCE PATROL EN ROUTE" },
        { code: "55", plain: "SECURE HARBOUR ESTABLISHED" }
      ],
      "Card 002 (OPS 2)": [
        { code: "10", plain: "ESTABLISH OBSERVATION POST (OP)" },
        { code: "15", plain: "FRIENDLY POSITION ENGAGED" },
        { code: "20", plain: "PATROL RETURNED TO BASE" },
        { code: "25", plain: "WITHDRAWING FROM CURRENT LINE" },
        { code: "30", plain: "RV CONFIRMED AT LOC" }
      ],
      "Card 003 (FIRE SUPPORT)": [
        { code: "01", plain: "CALL FOR FIRE COMPLETED" },
        { code: "02", plain: "SHELLING/MORTAR FIRE IN PROGRESS" },
        { code: "03", plain: "SMOKE SCREEN TRIGGERED" },
        { code: "05", plain: "EFFECTS OBTAINED: HARASSING" },
        { code: "07", plain: "EFFECTS OBTAINED: NEUTRALIZED" }
      ],
      "Card 004 (AVN / HELO)": [
        { code: "11", plain: "HELICOPTER LANDING SITE (HLS) SECURE" },
        { code: "14", plain: "AIRCRAFT AIRBORNE" },
        { code: "18", plain: "EVACUATION IN PROGRESS" },
        { code: "22", plain: "CASUALTY PICKUP COMPLETED" }
      ],
      "Card 005 (COMMS / SIGS)": [
        { code: "90", plain: "RADIO SILENCE ORDERED / DIRECTED" },
        { code: "91", plain: "RADIO SILENCE LIFTED" },
        { code: "94", plain: "FREQUENCY CHANGER ORDERED (STBY FOR EMER)" },
        { code: "99", plain: "NET CLOSED BY CONTROL" }
      ],
      "Card 006 (LOG / CSS)": [
        { code: "50", plain: "AMMUNITION RESUPPLY REQUIRED" },
        { code: "52", plain: "RATIONS AND WATER NEEDED" },
        { code: "58", plain: "FUEL RESUPPLY (POL) REQUESTED" },
        { code: "60", plain: "VEHICLE CASUALTY REPORTED" }
      ]
    };

    // Define Tactical Slate templates
    this.slates = {
      "SITREP": `NATO SITREP (SITUATION REPORT)\n-----------------------------\nLine A: DATE TIME GROUP (DTG) of situation (e.g. 281015Z JUL 26)\nLine B: OWN POSITION (6-figure Grid Ref, e.g. GR 789 456)\nLine C: ENEMY SITUATION (Location, Activity, Strength)\nLine D: OWN SITUATION & INTENTIONS (Actions being taken)`,
      
      "MIST": `UK ONLY: MIST (AT) CASUALTY REPORT\n----------------------------------\nZAP NO: [Callsign suffix / Anonymized ID]\n\nM: MECHANISM OF INJURY (e.g. Blast, GSW, Fall)\nI: INJURY SUSTAINED (e.g. Shrapnel leg, head wound)\nS: SYMPTOMS (MARCH checklist, Vitals)\nT: TREATMENT GIVEN (e.g. Tourniquet applied 1030Z)\n\nA: AGE OF CASUALTY (Approx)\nT: TIME OF WOUNDING (DTG)`,
      
      "MEDEVAC": `NATO MEDEVAC 9-LINE REQUEST\n---------------------------\nLine 1: PICKUP LOCATION (Grid Ref & Callsign)\nLine 2: FREQUENCY & CALLSIGN (At HLS)\nLine 3: PATIENTS BY PRECEDENCE (A: Flash, B: Urgent, C: Priority, D: Routine, E: Convenience)\nLine 4: SPECIAL EQUIPMENT REQUIRED (A: None, B: Hoist, C: Extraction kit, D: Ventilator)\nLine 5: PATIENTS BY TYPE (L + number: Stretcher, W + number: Walking)\nLine 6: SECURITY OF HLS (N: No enemy, P: Possible enemy, E: Enemy in area, X: Armed escort)\nLine 7: METHOD OF MARKING HLS (A: Panels, B: Pyrotechnics, C: Smoke signal, D: None)\nLine 8: PATIENT NATIONALITY & STATUS (A: Military, B: Civilian, C: EPW)\nLine 9: NBC CONTAMINATION / TERRAIN DETAIL`,
      
      "CFF": `FIRE MISSION (CALL FOR FIRE) SLATE\n----------------------------------\n"Fire Mission, Over"\n\nLine A: TARGET LOCATION (6-fig Grid Ref, e.g. GR 123 456)\nLine B: DIRECTION (in mils, e.g. Dir 4800 Mils)\nLine C: TARGET DESCRIPTION (e.g. 3 x En Vehicles in open)\nLine D: NEAREST FRIENDLY POSITION (Distance/Direction)\nLine E: EFFECT REQUIRED (Smoke, Illum, Harass, Destroy)\nLine F: DURATION (e.g. 2 Minutes)\nLine G: TIMING (e.g. At H-Hour / Now)`,
      
      "QAOS": `QUICK ATTACK ORDERS SLATE (QAOS)\n-------------------------------\n01: GROUND (Assault route, FUP, LOE)\n02: ENEMY (Strength, Weapons, Layout)\n03: ORBAT (Assault Group, Fire Support, Reserve)\n04: SCHEME OF MANOEUVRE (Concept of Ops)\n05: KEY TIMINGS (H-Hour, Bounds)\n06: FIRE SUPPORT COORDINATION MEASURES (FSCM)\n07: COMBAT ID MARKS & SIGNALS`,
      
      "JAMREP": `JAMREP (JAMMING REPORT)\n------------------------\nLine A: TYPE OF JAMMING (Music, Tones, Carrier Wave, Noise, Voice)\nLine B: STRENGTH (Weak, Medium, Strong)\nLine C: MODE (Responsive, Constant)\nLine D: AFFECTED FREQUENCY\nLine E: VICTIM LOCATION (Grid Ref)\nLine F: TIME START & DURATION`,
      
      "EQUIPRECREQ": `NATO EQUIPMENT RECOVERY REQUEST (EQUIPRECREQ)\n---------------------------------------------\nLine A: RECOVERY LOCATION (Grid Ref & Landmark)\nLine B: VEHICLE DETAILS (Make, Model, Wpn Serial)\nLine C: VEHICLE PROBLEM (e.g. Bogged in mud, engine seize)\nLine D: CREW AVAILABLE (Yes / No)\nLine E: DESTINATION FOR RECOVERY`,
      
      "EOINCREP": `NATO EXPLOSIVE ORDNANCE INCIDENT (EOINCREP)\n-------------------------------------------\nLine 1: DTG OF DISCOVERY\nLine 2: REPORTING UNIT / CALLSIGN\nLine 3: RV LOCATION GRID (Link-up point)\nLine 4: COMMUNICATIONS METHOD\nLine 5: DESCRIPTION OF EO (Size, type, shape)\nLine 6: LOCATION OF EO (Grid Ref)\nLine 7: TACTICAL SITUATION\nLine 8: DAMAGE / THREAT RADIUS\nLine 9: PRIORITY (Immediate, Urgent, Routine)`
    };
  }

  initialize() {
    // Initialize Off-Canvas drawer object
    const el = document.getElementById('aideMemoireDrawer');
    this.drawer = new bootstrap.Offcanvas(el);

    // Toggle drawer on tab button click
    this.btnTab.addEventListener('click', () => {
      this.drawer.toggle();
    });

    // BATCO slider events
    this.btnBatcoUp.addEventListener('click', () => this.moveBatcoSlider(-1));
    this.btnBatcoDown.addEventListener('click', () => this.moveBatcoSlider(1));

    // Render BATCO table
    this.renderBatcoTable();

    // Render Vocab Cards dropdown
    this.vocabSelect.innerHTML = '';
    Object.keys(this.vocabCards).forEach(cardName => {
      const opt = document.createElement('option');
      opt.value = cardName;
      opt.textContent = cardName;
      this.vocabSelect.appendChild(opt);
    });

    this.vocabSelect.addEventListener('change', () => this.renderVocabCard());
    this.vocabSearch.addEventListener('input', () => this.renderVocabCard());
    this.renderVocabCard();

    // Render Slate templates dropdown
    this.slateSelect.addEventListener('change', () => this.renderSlateCard());
    this.renderSlateCard();
  }

  renderBatcoTable() {
    this.batcoTbody.innerHTML = '';
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
      this.batcoTbody.appendChild(tr);
    });

    // Update active label
    document.getElementById('batco-active-row-name').textContent = this.batcoGrid[this.batcoActiveRow].name;
  }

  moveBatcoSlider(dir) {
    this.batcoActiveRow += dir;
    if (this.batcoActiveRow < 0) this.batcoActiveRow = 0;
    if (this.batcoActiveRow >= this.batcoRowsCount) this.batcoActiveRow = this.batcoRowsCount - 1;
    this.renderBatcoTable();
  }

  renderVocabCard() {
    const selectedCard = this.vocabSelect.value;
    const filter = this.vocabSearch.value.toUpperCase();
    this.vocabTbody.innerHTML = '';

    const list = this.vocabCards[selectedCard] || [];
    const filtered = list.filter(item => 
      item.code.includes(filter) || item.plain.toUpperCase().includes(filter)
    );

    if (filtered.length === 0) {
      this.vocabTbody.innerHTML = '<tr><td colspan="2" class="text-muted text-center py-2">No matching entries.</td></tr>';
      return;
    }

    filtered.forEach(item => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td><b>${item.code}</b></td><td>${item.plain}</td>`;
      this.vocabTbody.appendChild(tr);
    });
  }

  renderSlateCard() {
    const selectedSlate = this.slateSelect.value;
    this.slateContent.textContent = this.slates[selectedSlate] || '';
  }
}
