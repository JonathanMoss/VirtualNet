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
    this.rxChunksPlayed = 0;
    this.rxBytesReceived = 0;
    this.rxDropReasons = [];

    this.txTimerId = null;
    this.rxTimerId = null;
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

  recordTxAck() {
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
    this.rxChunksPlayed++;
    if (!chunkId) return;
    const match = this.history.find(item => item.id === chunkId);
    if (match) {
      match.isPlayed = true;
    }
  }

  recordRxDrop(reason) {
    if (reason && !this.rxDropReasons.includes(reason)) {
      this.rxDropReasons.push(reason);
    }
  }

  pushHistory(item) {
    this.history.push(item);
    if (this.history.length > this.maxHistory) {
      this.history.shift();
    }
  }

  logTxSummary() {
    if (this.txChunksSent === 0) return;
    const ackPct = ((this.txAcksReceived / this.txChunksSent) * 100).toFixed(1);
    const kbSent = (this.txBytesSent / 1024).toFixed(1);
    const unacked = Math.max(0, this.txChunksSent - this.txAcksReceived);

    console.group('%c[TX TELEMETRY SUMMARY]', 'color: #00ff41; font-weight: bold; background: #040d07; padding: 2px 6px;');
    console.log(`- Chunks Sent: ${this.txChunksSent}`);
    console.log(`- Server ACKs Received: ${this.txAcksReceived} (${ackPct}%)`);
    console.log(`- Total Bytes Transmitted: ${kbSent} KB`);
    if (unacked > 0) {
      console.warn(`- Unacknowledged Chunks (In-Flight / Lost): ${unacked}`);
    } else {
      console.log(`- Unacknowledged Chunks: 0 (100% Delivery Confirmed)`);
    }
    console.groupEnd();
  }

  logRxSummary() {
    if (this.rxChunksReceived === 0 && this.rxDropReasons.length === 0) return;
    const playedCount = Math.min(this.rxChunksReceived, this.rxChunksPlayed);
    const playedPct = this.rxChunksReceived > 0 ? ((playedCount / this.rxChunksReceived) * 100).toFixed(1) : '0.0';
    const kbReceived = (this.rxBytesReceived / 1024).toFixed(1);
    const unplayedCount = Math.max(0, this.rxChunksReceived - playedCount);

    console.group('%c🔊 [RX TELEMETRY SUMMARY]', 'color: #00e5ff; font-weight: bold; background: #040d07; padding: 2px 6px;');
    console.log(`- Chunks Received over Socket: ${this.rxChunksReceived}`);
    console.log(`- Chunks Played via WebAudio: ${playedCount} (${playedPct}%)`);
    console.log(`- Total Bytes Received: ${kbReceived} KB`);

    if (unplayedCount > 0 || this.rxDropReasons.length > 0) {
      console.warn(`- Unplayed / Dropped Chunks: ${unplayedCount}`);
      console.warn(`- Drop / Unplayed Reasons:`, this.rxDropReasons.length > 0 ? this.rxDropReasons : ['Buffered chunks remaining on transmission end']);
    } else {
      console.log(`- Unplayed / Dropped Chunks: 0 (100% Playback Complete)`);
    }
    console.groupEnd();
  }

  startTxSession() {
    if (this.txTimerId) {
      clearTimeout(this.txTimerId);
      this.txTimerId = null;
    }
    this.txChunksSent = 0;
    this.txBytesSent = 0;
    this.txAcksReceived = 0;
    this.history = this.history.filter(item => item.type !== 'tx');
    this.updateStatsText();
  }

  finishTxSession() {
    if (this.txChunksSent === 0) return;

    if (this.txTimerId) clearTimeout(this.txTimerId);
    this.txTimerId = setTimeout(() => {
      if (this.txChunksSent > 0) {
        this.logTxSummary();
        this.txChunksSent = 0;
        this.txBytesSent = 0;
        this.txAcksReceived = 0;
      }
      this.txTimerId = null;
    }, 250);
  }

  resetRxStatsState() {
    this.rxChunksReceived = 0;
    this.rxChunksPlayed = 0;
    this.rxBytesReceived = 0;
    this.rxDropReasons = [];
    if (this.rxTimerId) {
      clearTimeout(this.rxTimerId);
      this.rxTimerId = null;
    }
  }

  startRxSession() {
    this.resetRxStatsState();
    this.history = this.history.filter(item => item.type !== 'rx');
    this.updateStatsText();
  }

  finishRxSession(isInterruptedByPtt = false) {
    if (this.rxChunksReceived === 0 && this.rxDropReasons.length === 0) return;

    if (isInterruptedByPtt) {
      this.recordRxDrop('Truncated by station keying PTT');
      this.logRxSummary();
      this.resetRxStatsState();
      return;
    }

    const remainingMs = this.app.audioEngine ? this.app.audioEngine.getRemainingPlaybackMs() : 0;
    const delayMs = Math.max(200, remainingMs + 150);

    if (this.rxTimerId) clearTimeout(this.rxTimerId);
    this.rxTimerId = setTimeout(() => {
      // Re-check remaining playback ms and active sources in case trailing audio chunks arrived or are still playing
      const currentRemaining = this.app.audioEngine ? this.app.audioEngine.getRemainingPlaybackMs() : 0;
      const currentSources = (this.app.audioEngine && this.app.audioEngine.activeRxSources) ? this.app.audioEngine.activeRxSources.length : 0;

      if (currentRemaining > 0 || currentSources > 0) {
        this.rxTimerId = null;
        this.finishRxSession();
        return;
      }
      this.logRxSummary();
      if (this.app && this.app.socketManager && this.app.currentRxTransmissionId) {
        this.app.socketManager.emitAudioRxPlaybackComplete(this.app.currentRxTransmissionId);
      }
      this.resetRxStatsState();
    }, delayMs);
  }

  resetToIdle() {
    this.txChunksSent = 0;
    this.txBytesSent = 0;
    this.txAcksReceived = 0;
    this.rxChunksReceived = 0;
    this.rxChunksPlayed = 0;
    this.rxBytesReceived = 0;
    this.rxDropReasons = [];
    this.history = [];

    if (this.txTimerId) {
      clearTimeout(this.txTimerId);
      this.txTimerId = null;
    }
    if (this.rxTimerId) {
      clearTimeout(this.rxTimerId);
      this.rxTimerId = null;
    }

    if (this.vuSegments) {
      this.vuSegments.forEach(s => s.classList.remove('active'));
    }
    const vuContainer = document.getElementById('vu-meter-bar');
    if (vuContainer) vuContainer.style.display = 'none';

    if (this.sparklineCtx && this.sparklineCanvas) {
      const ctx = this.sparklineCtx;
      const width = this.sparklineCanvas.width;
      const height = this.sparklineCanvas.height;
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = '#040d07';
      ctx.fillRect(0, 0, width, height);
      ctx.strokeStyle = 'rgba(0, 255, 65, 0.12)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, height / 2);
      ctx.lineTo(width, height / 2);
      ctx.stroke();
    }

    this.updateStatsText();
  }

  resetTxStats() {
    this.finishTxSession();
    this.startTxSession();
  }

  resetRxStats() {
    this.finishRxSession();
    this.startRxSession();
  }

  updateStatsText() {
    if (!this.statsText) return;

    if (this.app.isTransmitting) {
      const ackPct = this.txChunksSent > 0 ? Math.round((this.txAcksReceived / this.txChunksSent) * 100) : 100;
      this.statsText.textContent = `TX: ${this.txAcksReceived}/${this.txChunksSent} ACK (${ackPct}%)`;
    } else if (this.rxChunksReceived > 0 && this.app.pttController && this.app.pttController.state === 'RECEIVING') {
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
    const vuContainer = document.getElementById('vu-meter-bar');

    if (this.app.isTransmitting) {
      if (vuContainer) vuContainer.style.display = 'flex';
      if (!this.vuSegments || this.vuSegments.length === 0) return;

      const volume = this.app.audioEngine ? this.app.audioEngine.getTxVolumeRMS() : 0;
      const activeCount = Math.round(volume * this.vuSegments.length * 2.5); // Scaled multiplier for responsive visual movement

      this.vuSegments.forEach((segment, index) => {
        if (index < activeCount) {
          segment.classList.add('active');
        } else {
          segment.classList.remove('active');
        }
      });
    } else {
      if (vuContainer) vuContainer.style.display = 'none';
      if (this.vuSegments) {
        this.vuSegments.forEach(s => s.classList.remove('active'));
      }
    }
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
