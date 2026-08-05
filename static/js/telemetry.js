// Audio Telemetry HUD, LED VU Meter, and Mobile AudioContext Guard - VirtualNet

export class TelemetryManager {
  constructor(app) {
    this.app = app;
    this.sparklineCanvas = null;
    this.sparklineCtx = null;
    this.vuSegments = [];
    this.unmuteBanner = null;
    this.statsText = null;

    // Telemetry tracking state
    this.history = []; // Array of { val: number, isAck: boolean, type: 'tx'|'rx' }
    this.maxHistory = 30; // Max bars across 120px width
    this.txChunksSent = 0;
    this.txBytesSent = 0;
    this.txAcksReceived = 0;
    this.rxChunksReceived = 0;
    this.rxBytesReceived = 0;

    this.animFrameId = null;
    this.isMonitoring = false;
  }

  init() {
    this.sparklineCanvas = document.getElementById('telemetry-sparkline');
    if (this.sparklineCanvas) {
      this.sparklineCtx = this.sparklineCanvas.getContext('2d');
    }
    this.vuSegments = Array.from(document.querySelectorAll('#vu-meter-bar .vu-segment'));
    this.unmuteBanner = document.getElementById('audio-unmute-banner');
    this.statsText = document.getElementById('telemetry-stats-text');

    // Attach tap-to-unmute listener on banner and PTT card container
    if (this.unmuteBanner) {
      this.unmuteBanner.addEventListener('click', () => this.handleUnmuteTap());
    }

    const pttContainer = document.getElementById('ptt-container');
    if (pttContainer) {
      pttContainer.addEventListener('click', () => this.checkAndResumeAudioContext());
      pttContainer.addEventListener('touchstart', () => this.checkAndResumeAudioContext(), { passive: true });
    }

    this.startLoop();
  }

  handleUnmuteTap() {
    if (this.app && this.app.audioEngine) {
      this.app.audioEngine.resumeAudioContext().then(() => {
        this.updateUnmuteBanner();
      });
    }
  }

  checkAndResumeAudioContext() {
    if (this.app && this.app.audioEngine) {
      const state = this.app.audioEngine.getAudioContextState();
      if (state === 'suspended' || state === 'interrupted') {
        this.app.audioEngine.resumeAudioContext().then(() => {
          this.updateUnmuteBanner();
        });
      }
    }
  }

  recordTxChunk(byteSize) {
    this.txChunksSent++;
    this.txBytesSent += byteSize;
    this.pushHistory({ val: Math.min(1.0, byteSize / 4096), isAck: false, type: 'tx' });
    this.updateStatsText();
  }

  recordTxAck(_byteSize) {
    this.txAcksReceived++;
    // Mark last sent chunk as ACKed
    for (let i = this.history.length - 1; i >= 0; i--) {
      if (this.history[i].type === 'tx' && !this.history[i].isAck) {
        this.history[i].isAck = true;
        break;
      }
    }
    this.updateStatsText();
  }

  recordRxChunk(byteSize) {
    this.rxChunksReceived++;
    this.rxBytesReceived += byteSize;
    this.pushHistory({ val: Math.min(1.0, byteSize / 4096), isAck: true, type: 'rx' });
    this.updateStatsText();
  }

  pushHistory(item) {
    this.history.push(item);
    if (this.history.length > this.maxHistory) {
      this.history.shift();
    }
  }

  resetTxStats() {
    this.txChunksSent = 0;
    this.txBytesSent = 0;
    this.txAcksReceived = 0;
    this.updateStatsText();
  }

  resetRxStats() {
    this.rxChunksReceived = 0;
    this.rxBytesReceived = 0;
    this.updateStatsText();
  }

  updateStatsText() {
    if (!this.statsText) return;

    if (this.app.isTransmitting) {
      const ackPct = this.txChunksSent > 0 ? Math.round((this.txAcksReceived / this.txChunksSent) * 100) : 100;
      const kbStr = (this.txBytesSent / 1024).toFixed(1);
      this.statsText.textContent = `TX: ${kbStr}KB | ACK: ${ackPct}%`;
    } else if (this.app.audioEngine && this.app.audioEngine.getQueuedBufferMs() > 0) {
      const bufMs = this.app.audioEngine.getQueuedBufferMs();
      const kbStr = (this.rxBytesReceived / 1024).toFixed(1);
      this.statsText.textContent = `RX: ${kbStr}KB | ${bufMs}ms buf`;
    } else {
      const state = this.app.audioEngine ? this.app.audioEngine.getAudioContextState().toUpperCase() : 'READY';
      this.statsText.textContent = `STATUS: ${state}`;
    }
  }

  updateUnmuteBanner() {
    if (!this.unmuteBanner || !this.app.audioEngine) return;
    const state = this.app.audioEngine.getAudioContextState();

    // Show banner if audioContext is suspended during receiving mode or active session
    const isReceiving = !document.getElementById('active-speaker-box')?.classList.contains('d-none');
    if ((state === 'suspended' || state === 'interrupted') && (isReceiving || this.app.netId)) {
      this.unmuteBanner.classList.remove('d-none');
    } else {
      this.unmuteBanner.classList.add('d-none');
    }
  }

  startLoop() {
    if (this.isMonitoring) return;
    this.isMonitoring = true;

    const render = () => {
      if (!this.isMonitoring) return;
      this.renderVuMeter();
      this.renderSparkline();
      this.updateUnmuteBanner();
      this.animFrameId = requestAnimationFrame(render);
    };

    this.animFrameId = requestAnimationFrame(render);
  }

  stopLoop() {
    this.isMonitoring = false;
    if (this.animFrameId) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
  }

  renderVuMeter() {
    if (!this.vuSegments || this.vuSegments.length === 0) return;

    let volume = 0;
    if (this.app.isTransmitting && this.app.audioEngine) {
      volume = this.app.audioEngine.getTxVolumeRMS();
    } else if (this.app.audioEngine) {
      volume = this.app.audioEngine.getRxVolumeRMS();
    }

    const activeCount = Math.round(volume * this.vuSegments.length * 2.5); // Scaled multiplier for responsive visual movement

    this.vuSegments.forEach((segment, index) => {
      if (index < activeCount) {
        segment.classList.add('active');
      } else {
        segment.classList.remove('active');
      }
    });
  }

  renderSparkline() {
    if (!this.sparklineCtx || !this.sparklineCanvas) return;

    const ctx = this.sparklineCtx;
    const width = this.sparklineCanvas.width;
    const height = this.sparklineCanvas.height;

    ctx.clearRect(0, 0, width, height);

    // Draw dark CRT grid lines
    ctx.strokeStyle = 'rgba(0, 255, 65, 0.08)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, height / 2);
    ctx.lineTo(width, height / 2);
    ctx.stroke();

    if (this.history.length === 0) return;

    const barWidth = 3;
    const gap = 1;
    const step = barWidth + gap;
    const startX = width - (this.history.length * step);

    this.history.forEach((item, index) => {
      const x = startX + (index * step);
      const barHeight = Math.max(3, Math.round(item.val * (height - 4)));
      const y = height - barHeight;

      if (item.type === 'tx') {
        ctx.fillStyle = '#00ff41'; // Phosphor green
      } else {
        ctx.fillStyle = '#00e5ff'; // Tactical cyan for RX
      }

      ctx.fillRect(x, y, barWidth, barHeight);

      // Draw glowing ACK dot at top of bar if acknowledged
      if (item.isAck) {
        ctx.fillStyle = '#ffb000'; // Amber ACK dot
        ctx.fillRect(x, y - 2, barWidth, 2);
      }
    });
  }
}
