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

  recordRxChunk(byteSize, chunkId) {
    this.rxChunksReceived++;
    this.rxBytesReceived += byteSize;
    this.pushHistory({ id: chunkId, val: Math.min(1.0, byteSize / 4096), isPlayed: false, type: 'rx' });
    this.updateStatsText();
  }

  markRxChunkPlayed(chunkId) {
    if (!chunkId) return;
    const match = this.history.find(item => item.id === chunkId);
    if (match) {
      match.isPlayed = true;
    }
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
    this.history = this.history.filter(item => item.type !== 'tx');
    this.updateStatsText();
  }

  resetRxStats() {
    this.rxChunksReceived = 0;
    this.rxBytesReceived = 0;
    this.history = this.history.filter(item => item.type !== 'rx');
    this.updateStatsText();
  }

  updateStatsText() {
    if (!this.statsText) return;

    if (this.app.isTransmitting) {
      const ackPct = this.txChunksSent > 0 ? Math.round((this.txAcksReceived / this.txChunksSent) * 100) : 100;
      this.statsText.textContent = `TX: ${this.txAcksReceived}/${this.txChunksSent} ACK (${ackPct}%)`;
    } else if (this.rxChunksReceived > 0) {
      const playedCount = this.history.filter(item => item.type === 'rx' && item.isPlayed).length;
      const playedPct = Math.round((playedCount / this.rxChunksReceived) * 100);
      this.statsText.textContent = `RX: ${playedCount}/${this.rxChunksReceived} Played (${playedPct}%)`;
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
    // User Directive: Audio level meter is animated ONLY during TX
    if (this.app.isTransmitting && this.app.audioEngine) {
      volume = this.app.audioEngine.getTxVolumeRMS();
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

    // Draw dark CRT canvas background
    ctx.fillStyle = '#040d07';
    ctx.fillRect(0, 0, width, height);

    // Draw dark CRT grid lines
    ctx.strokeStyle = 'rgba(0, 255, 65, 0.12)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, height / 2);
    ctx.lineTo(width, height / 2);
    ctx.stroke();

    const padding = 2;
    const barHeight = height - (padding * 2);

    if (this.app.isTransmitting) {
      // TX Dynamic Scale: Green = ACKed chunks ratio, Yellow/Amber = Un-ACKed chunks ratio
      if (this.txChunksSent > 0) {
        const ackRatio = Math.min(1.0, this.txAcksReceived / this.txChunksSent);
        const greenWidth = Math.round((width - (padding * 2)) * ackRatio);
        const yellowWidth = (width - (padding * 2)) - greenWidth;

        if (greenWidth > 0) {
          ctx.fillStyle = '#00ff41'; // Solid Phosphor Green for ACKed chunks
          ctx.fillRect(padding, padding, greenWidth, barHeight);
        }
        if (yellowWidth > 0) {
          ctx.fillStyle = '#ffb000'; // Yellow/Amber for un-ACKed chunks
          ctx.fillRect(padding + greenWidth, padding, yellowWidth, barHeight);
        }
      }
    } else if (this.rxChunksReceived > 0) {
      // RX Dynamic Scale: Green = Played chunks ratio, Yellow/Amber = Unplayed/Queued chunks ratio
      const playedCount = this.history.filter(item => item.type === 'rx' && item.isPlayed).length;
      const playedRatio = Math.min(1.0, playedCount / this.rxChunksReceived);
      const greenWidth = Math.round((width - (padding * 2)) * playedRatio);
      const yellowWidth = (width - (padding * 2)) - greenWidth;

      if (greenWidth > 0) {
        ctx.fillStyle = '#00ff41'; // Solid Phosphor Green for physically played chunks
        ctx.fillRect(padding, padding, greenWidth, barHeight);
      }
      if (yellowWidth > 0) {
        ctx.fillStyle = '#ffb000'; // Yellow/Amber for unplayed chunks in buffer
        ctx.fillRect(padding + greenWidth, padding, yellowWidth, barHeight);
      }
    }

    // Outer CRT scale border
    ctx.strokeStyle = 'rgba(0, 255, 65, 0.4)';
    ctx.lineWidth = 1;
    ctx.strokeRect(0, 0, width, height);
  }
}
