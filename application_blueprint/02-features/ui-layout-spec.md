# UI/UX Layout Specification: VirtualNet

This document defines the responsive layout structures (Bootstrap 5), interactive state indicators, and keyboard navigation configurations for the VirtualNet web client.

---

## 1. Grid Hierarchy & Layout Mockup

The user dashboard uses a two-column Bootstrap layout:
- **Left Sidebar** (`col-md-3` / `net-sidebar`): Foldable online roster list and Net Control status panel.
- **Main Panel** (`col` / `main-content-panel`): PTT transceiver card and reference resource panels.

### ASCII Wireframe Mockup (Student view after Callsign Assignment)
```
┌────────────────────────────────────────────────────────────────────────┐
│ VirtualNet [Net: Drill Alpha]            [State: DIRECTED NET (Badge)] │
├──────────────────────────────────────┬─────────────────────────────────┤
│ ONLINE ROSTER (col-md-3)             │ PTT RADIO CONTROLS (col-md-9)   │
│                                      │ ┌─────────────────────────────┐ │
│ 👤 CONTROL         (IDLE)            │ │       [ PTT ACTIVE ]        │ │
│ 👤 R11 (John)      (TRANSMITTING) ◄──┼─┤   Hold [SPACEBAR] to Speak  │ │
│ 👤 H10 (Sarah)     (IDLE)            │ │                             │ │
│ 👤 L12 (Mike)      (MUTED)           │ │  Status: RECEIVING R11...   │ │
│                                      │ └─────────────────────────────┘ │
│ ┌──────────────────────────────────┐ │                                 │
│ │ Local Details                    │ │ AIDE MEMOIRE REFERENCE PANELS   │
│ │  My Call Sign: R11               │ │ ┌─────────────────────────────┐ │
│ │  My Nickname: John               │ │ │ [SHORTHAND] [BATCO SLIDER]  │ │
│ └──────────────────────────────────┘ │ │ [VOCAB] [SLATES] [LOGGING]    │ │
│                                      │ └─────────────────────────────┘ │
└──────────────────────────────────────┴─────────────────────────────────┘
```

---

## 2. Component Layout & Bootstrap Classes

### 2.1 Connect / Join Net Screen (Landing Page)
A centered container for student log in:
- Layout classes: `container d-flex align-items-center justify-content-center flex-grow-1 min-vh-100 py-4`
- **Join Net Card (`#join-net-card`)**:
  - **4-Character PIN**: Text input constraint `maxlength="4"`, placeholder `e.g. A3F9`.
  - **Nickname (`#join-nickname`)**: Text input constraint `maxlength="20"`.
  - **Join Button (`#btn-join-net`)**: `.btn .btn-tactical .w-100`.
- *Sub-text toggle link*: "SUNRAY Portal" (toggles to 2.2).

### 2.2 Create Net Screen (SUNRAY / Instructor Portal)
Card container for instructors to host a session (`#create-net-card`):
- Input fields:
  - **Net Session Name (`#create-name`)**: Text input (e.g. `Exercise Drill Alpha`).
  - **SUNRAY Callsign (`#create-sunray-callsign`)**: Default `0`.
  - **Instructor PIN (`#create-instructor-pin`)**: 6-digit numeric input with disc security masking (`-webkit-text-security: disc`).
- **Create Session Button (`#btn-create-net`)**: `.btn .btn-tactical .w-100`.
- Upon creation:
  - Displays `#create-success-box` with the **4-Character PIN** in phosphor green.
  - Transition button to the **SUNRAY Dashboard**.

### 2.3 Instructor / SUNRAY Dashboard Layout
- **PIN Badge & Header Alert**:
  - Displays persistent `PIN: A3F9` badge.
  - **Admissions Queue Visual Alert (`slow-flash-header`)**: Flashes header amber when student operators are awaiting callsign assignment in the admission queue (Issue #25).
- **Admissions Queue Table (`#instructor-admissions-queue`)**:
  - Columns: Nickname, Assign Callsign (`.input-assign-cs`), Role Selector (`.select-assign-role`), Action Button (`[Assign Callsign]`).
- **Active Roster Management Grid (`#instructor-roster`)**:
  - Columns: Callsign, Nickname, Role, Status (`TALKING`, `ACTIVE`, `UNWORKABLE`), Action Buttons:
    - **`[CALLSIGN]` (`.btn-change-callsign`)**: Opens custom prompt dialog to dynamically modify callsign/suffix (Issue #26).
    - **`[KICK]` (`.btn-kick-student`)**: Prompts custom confirmation modal to kick station (Issue #26).
- **Session Control (`#btn-end-session`)**:
  - Styled with `.btn .btn-outline-danger`. Triggers custom tactical confirmation modal before terminating session.
- **Transmission Activity Log Table (`#sunray-tx-log-tbody`)**:
  - Displays real-time voice transmission telemetry for Net Control:
    - **DTG**: Date-Time Group timestamp.
    - **Call Sign**: Transmitting station callsign.
    - **Duration**: Live countup while PTT is held, finalized upon release.
    - **Status**: Live state (`TRANSMITTING` glowing green vs `PTT RELEASED`, `COMPLETED`, or `OVERRIDDEN`).
    - **RX Summary**: Receipt verification summary (`STREAMING` in cyan info badge while PTT is held live; `ALL CALLSIGNS R/X` in green badge vs `NOT R/X: R12, R15` in amber badge upon playback completion).
  - **Clear Activity Log Button (`#btn-clear-tx-log`)**: Prompts Net Control with confirmation modal and issues `clear_transmission_log` event to wipe log rows across clients and backend.

### 2.4 Header Bar
Top navigation bar styled as a military command header:
- Layout classes: `navbar navbar-dark bg-dark border-bottom border-secondary px-3 py-2 shadow-sm`
- Content elements:
  - Branding: `VIRTUALNET` (Phonetic spelling reference toggle on hover).
  - Header PIN: `#header-net-pin` (`PIN: ----`).
  - Net Name: `#header-net-name` (`Net: -`).
  - Callsign Badge: `#header-callsign` (`Callsign: AWAITING`).
  - System Clock: Real-time Date-Time-Group text display (`000000Z UTC`, updated via `formatDTG`).
  - Leave Button: `#btn-leave-net` (`LEAVE`).

### 2.5 Enemy Direction Finding (DF) Alert Banner
- Layout ID: `#df-alert-banner`
- Styling: `.alert .alert-danger .border-3 .border-danger .shadow-lg` (`background-color: #3f0000; color: #ff3333; font-size: 1.25rem;`).
- Trigger: Displays automatically whenever a transmission continuously exceeds 20 seconds (`TRANSMISSION EXCEEDED 20 SECONDS!`).

---

## 3. Reference Resources Panel

The Reference Resources panel (`resources_card.html`) provides multi-functional reference tools for voice procedure, code keying, and report formatting:

### 3.1 1. SHORTHAND Tab
- Quick reference table for standard military logging shorthand:
  - `0` / `CS 0` - Net Control Station
  - `R` - Routine Precedence
  - `P` - Priority Precedence
  - `I` - Immediate Precedence
  - `F` - Flash Precedence
  - `C` - Contact Report (Initiated)
  - `S` - Sighting Report
  - `Z` - Zulu Time (GMT/UTC)
  - `x` - Struck-off / Entry finalized
  - `RPT` - Repeat requested / Say Again
  - `OK` / `D` / `U` - Readability checks (OK, Difficult, Unworkable)

### 3.2 2. BATCO Tab (Interactive SVG BATCO Slider)
- **SVG BATCO Slider Widget (`#svg-batco-container`)**:
  - Rendered via `static/js/svg_batco_slider.js`.
  - Displays the 30-row cipher grid with scrambled letter columns under plain text digits `0` to `9` and special characters.
  - Interactive horizontal slider bar with smooth vertical drag positioning.
  - Touch & Pointer reliability: Supports desktop mouse drag and mobile touch pointer events without viewport pan interference.
  - **Row Step Buttons**: Dedicated `Step Up ▲` and `Step Down ▼` buttons for fine row alignment.
- **BATCO Reference Image Card (`#batco-card-img`)**: High-resolution BATCO reference sheet render.

### 3.3 3. VOCAB Tab (Standard Vocabulary Cards)
- Selector for Cards 001–012: OPS 1-3, FIRE SP, ATK, ENGRS, COMMS, AVN, LOG 1-3, SPEC OPS.
- Image viewer container (`#vocab-card-img`) displaying standard number-to-text substitution cards.

### 3.4 4. SLATES Tab (Tactical Slate Cards AC-71936)
- Selector for high-resolution tactical reference slates (`#slate-card-img`):
  - **CFF**: Call for Fire slate card.
  - **CONTACT**: Contact Report slate card.
  - **MEDEVAC**: MEDEVAC 9-Line slate card.
  - **MISTAT**: Casualty Report (MISTAT) slate card.
  - **SITREP**: Situation Report (SITREP) slate card.

### 3.5 5. LOGGING Tab
- Reference card image (`#logging-card-img`) outlining standard army logsheet format, precedence indicators, and entry guidelines.

### 3.6 Integrated Image Pan/Zoom Control Bar
All reference card image containers feature a dedicated control bar (`static/js/pan_zoom.js`):
- Controls:
  - **Zoom In (`.btn-zoom-in`)**: Increases scale by `+0.25x` (max `3.0x`).
  - **Zoom Out (`.btn-zoom-out`)**: Decreases scale by `-0.25x` (min `0.75x`).
  - **Reset Zoom (`.btn-zoom-reset`)**: Resets scale to `1.0x` and centers image.
- Pan behavior: Drag-pan across zoomed image inside black bounding containers.

---

## 4. Custom Tactical CRT Dialog & Modal System

All popups and dialogs use a custom-rendered, night-ops tactical CRT modal system (`static/js/dialog.js`):

### 4.1 DOM Structure (`#tactical-dialog-overlay`)
```html
<div id="tactical-dialog-overlay" class="tactical-dialog-overlay d-none" role="dialog" aria-modal="true">
  <div id="tactical-dialog-card" class="tactical-dialog-card shadow-lg">
    <div class="tactical-dialog-header">
      <h5 id="tactical-dialog-title" class="m-0 text-uppercase font-weight-bold"></h5>
      <button type="button" id="tactical-dialog-btn-close" class="btn-close btn-close-white ms-auto shadow-none"></button>
    </div>
    <div class="tactical-dialog-content">
      <div id="tactical-dialog-body" class="tactical-dialog-body mb-3"></div>
      <div id="tactical-dialog-input-container" class="mb-3 d-none">
        <input type="text" id="tactical-dialog-input" class="form-control text-uppercase monospace" autocomplete="off">
      </div>
    </div>
    <div id="tactical-dialog-footer" class="tactical-dialog-footer d-flex justify-content-end gap-2">
      <button type="button" id="tactical-dialog-btn-cancel" class="btn btn-outline-secondary btn-sm">CANCEL</button>
      <button type="button" id="tactical-dialog-btn-confirm" class="btn btn-tactical btn-sm">OK</button>
    </div>
  </div>
</div>
```

### 4.2 Modal Types & API
- **`showAlert(message, options)`**: Displays notice modal with "ACKNOWLEDGE" button. Resolves when dismissed.
- **`showConfirm(message, options)`**: Displays confirmation modal with "CONFIRM" and "CANCEL" buttons. Resolves to `true` or `false`.
- **`showPrompt(message, defaultValue, options)`**: Displays input prompt modal with text input field. Resolves to entered string or `null`.

### 4.3 Styling & Aesthetics (`style.css`)
- Overlay: `.tactical-dialog-overlay` with dark backdrop blur (`background-color: rgba(10, 15, 10, 0.85); backdrop-filter: blur(4px);`).
- Card: `.tactical-dialog-card` with sharp zero-radius borders (`border: 2px solid var(--border-color-tactical);`), phosphor green/amber accents, glowing borders, and scale fade-in animation (`tactical-dialog-fade-in`).

### 4.4 Keyboard Navigation & Interceptors
- **Keyboard shortcuts**: <kbd>Enter</kbd> submits/confirms active dialog, <kbd>Escape</kbd> cancels/dismisses modal.
- **Global Interceptor**: Overrides `window.alert`, `window.confirm`, `window.prompt` to log warnings and call tactical dialogs gracefully.

---

## 5. Military/Tactical Design System & CSS Guide

### 5.1 Color Palette
- **Main Background**: `#141714` (Night-ops dark slate)
- **Cards & Containers**: `#202420` (`--bg-color-card`)
- **Borders**: `#3c423c` (`--border-color-tactical`)
- **Phosphor Green**: `#33ff33` (`--color-phosphor-green`)
- **Tactical Amber**: `#ffb000` (`--color-tactical-amber`)
- **Desert Sand**: `#c2b280` (`--color-desert-sand`)
- **Hot Red**: `#ff3333` (`--color-hot-red`)
- **Muted Gray**: `#7a827a` (`--color-muted-gray`)

### 5.2 Hardware Design Rules
- **No Rounded Corners**: `.card, .btn, .form-control, .form-select, .list-group-item, .modal-content, .badge { border-radius: 0 !important; }`
- **Monospace Typography**: `font-family: 'Roboto Mono', Courier, monospace;`

---

## 6. Modular Jinja2 Card Templates & DOM Contract Verification

To improve maintainability and component isolation, `static/templates/index.html` is refactored into modular Jinja2 card templates located in `static/templates/cards/`:

- **`header_card.html`**: Command navbar, PIN badge, system DTG clock, and disconnect action.
- **`join_net_card.html`**: PIN entry and nickname landing page view.
- **`create_net_card.html`**: SUNRAY session creation portal.
- **`transceiver_card.html`**: PTT state indicator and virtual radio transceiver.
- **`roster_card.html`**: Active sub-station roster view.
- **`sunray_card.html`**: Instructor dashboard, admissions queue, callsign assignment, and session management.
- **`df_alert_banner.html`**: Tactical Direction Finding warning banner component.
- **`resources_card.html`**: Main reference resources tab container.

### DOM Contract Verification (`tests/test_dom_contract.py`)
Because JavaScript handlers rely on specific element IDs and CSS selectors, the automated test suite executes a DOM contract suite (`test_dom_contract.py`) that parses Jinja2 card templates to guarantee:
1. All required DOM IDs (`#btn-join-net`, `#join-pin`, `#df-alert-banner`, etc.) remain present in the rendered HTML.
2. Element attributes and structural contracts match JavaScript listener expectations.

