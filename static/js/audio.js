// Web Audio Engine and Real-Time Low-Latency Voice Streaming - VirtualNet

export class WebAudioEngine {
  constructor(app) {
    this.app = app;
    this.audioContext = null;
    this.micStream = null;
    this.scriptNode = null;
    this.workletNode = null;
    this.encoder = null;
    this.decoder = null;
    this.useOpus = false;
    this.currentTxId = null;
    this.packetSequence = 0;
    this.capturedPcmFloats = [];
    this.isRecording = false;
    
    // Playback scheduling state
    this.nextStartTime = 0;
    this.lastScheduledEndTime = 0;
    this.activeRxSources = [];
    
    // Audio effects & analyzer nodes
    this.voiceGainNode = null;
    this.txAnalyser = null;
    this.rxAnalyser = null;
    this.txDataArray = new Uint8Array(16);
    this.rxDataArray = new Uint8Array(16);
  }

  async init() {
    if (this.audioContext) return;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    try {
      this.audioContext = new AudioContextClass({ sampleRate: 48000, latencyHint: 'interactive' });
    } catch (e) {
      try {
        this.audioContext = new AudioContextClass({ latencyHint: 'interactive' });
      } catch (e2) {
        try {
          this.audioContext = new AudioContextClass();
        } catch (e3) {
          console.warn("AudioContext initialization warning:", e3);
        }
      }
    }
    
    if (this.audioContext) {
      this.setupEffectsChain();
    }
  }

  generateNoiseBuffer() {
    return;
  }

  makeDistortionCurve() {
    return new Float32Array(0);
  }

  setupEffectsChain() {
    // Pure audio mode: Direct 1:1 voice gain node -> RX Analyser -> destination
    this.voiceGainNode = this.audioContext.createGain();
    this.voiceGainNode.gain.setValueAtTime(1.0, this.audioContext.currentTime);

    this.rxAnalyser = this.audioContext.createAnalyser();
    this.rxAnalyser.fftSize = 32;
    
    this.voiceGainNode.connect(this.rxAnalyser);
    this.rxAnalyser.connect(this.audioContext.destination);
  }

  initCodec() {
    // Legacy WebCodecs hook placeholder
    return;
  }

  static isMediaCaptureSupported() {
    const getUserMediaAvailable = (navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === 'function') ||
      typeof navigator.getUserMedia === 'function' ||
      typeof navigator.webkitGetUserMedia === 'function' ||
      typeof navigator.mozGetUserMedia === 'function';

    return getUserMediaAvailable;
  }

  static getMediaCaptureSupportReason() {
    if (!WebAudioEngine.isMediaCaptureSupported()) {
      return 'Microphone capture is not supported by this browser.';
    }
    return null;
  }

  getUserMedia(constraints) {
    if (navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === 'function') {
      return navigator.mediaDevices.getUserMedia(constraints);
    }

    const legacyGetUserMedia = navigator.getUserMedia || navigator.webkitGetUserMedia || navigator.mozGetUserMedia;
    if (typeof legacyGetUserMedia === 'function') {
      return new Promise((resolve, reject) => {
        legacyGetUserMedia.call(navigator, resolve, reject, constraints);
      });
    }

    return Promise.reject(new Error('Media capture is not supported by this browser.')); 
  }

  playPTTStartChirp() {
    return;
  }

  startTransmitterSidetone() {
    return;
  }

  stopTransmitterSidetone() {
    return;
  }

  playPTTEndSquelchTail() {
    return;
  }

  async ensureMicStream() {
    if (!this.audioContext) {
      await this.init();
    }

    if (this.micStream && this.micStream.active && (this.workletNode || this.scriptNode)) {
      return;
    }

    try {
      try {
        this.micStream = await this.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
            channelCount: 1
          }
        });
      } catch (e) {
        console.warn("⚠️ getUserMedia fallback to synthetic stream:", e);
        if (this.audioContext) {
          const dest = this.audioContext.createMediaStreamDestination();
          const osc = this.audioContext.createOscillator();
          const gain = this.audioContext.createGain();
          gain.gain.setValueAtTime(0.01, this.audioContext.currentTime);
          osc.connect(gain);
          gain.connect(dest);
          osc.start();
          this.micStream = dest.stream;
        } else {
          throw e;
        }
      }
      
      const source = this.audioContext.createMediaStreamSource(this.micStream);
      this.capturedPcmFloats = [];

      this.txAnalyser = this.audioContext.createAnalyser();
      this.txAnalyser.fftSize = 32;
      source.connect(this.txAnalyser);

      let workletLoaded = false;
      if (this.audioContext.audioWorklet && typeof AudioWorkletNode !== 'undefined') {
        try {
          await this.audioContext.audioWorklet.addModule(new URL('./audio-worklet-processor.js', import.meta.url));
          this.workletNode = new AudioWorkletNode(this.audioContext, 'pcm-processor', {
            numberOfInputs: 1,
            numberOfOutputs: 0,
            channelCount: 1
          });
          this.workletNode.port.onmessage = (event) => {
            if (this.isRecording) {
              const floatData = new Float32Array(event.data);
              this.capturedPcmFloats.push(new Float32Array(floatData));
              this.flushChunkIfReady();
            }
          };
          source.connect(this.workletNode);
          workletLoaded = true;
        } catch (workletErr) {
          console.warn("AudioWorklet setup failed, falling back to ScriptProcessor:", workletErr);
        }
      }

      if (!workletLoaded) {
        this.scriptNode = this.audioContext.createScriptProcessor(1024, 1, 1);
        this.scriptNode.onaudioprocess = (e) => {
          if (this.isRecording) {
            const inputData = e.inputBuffer.getChannelData(0);
            this.capturedPcmFloats.push(new Float32Array(inputData));
            this.flushChunkIfReady();
          }
        };
        source.connect(this.scriptNode);
        const dummyGain = this.audioContext.createGain();
        dummyGain.gain.setValueAtTime(0, this.audioContext.currentTime);
        this.scriptNode.connect(dummyGain);
        dummyGain.connect(this.audioContext.destination);
      }
      console.log("🎤 [AUDIO] Microphone stream active with mobile DSP noise/echo cancellation.");
    } catch (e) {
      console.warn("Failed to pre-warm microphone stream:", e);
      throw e;
    }
  }

  async startRecording(txId) {
    if (!this.audioContext) await this.init();
    
    if (this.audioContext && (this.audioContext.state === 'suspended' || this.audioContext.state === 'interrupted')) {
      try {
        await Promise.race([
          this.audioContext.resume(),
          new Promise((_, reject) => setTimeout(() => reject(new Error("AudioContext resume timeout")), 500))
        ]);
      } catch (err) {
        console.warn("AudioContext resume warning:", err);
      }
    }

    await this.ensureMicStream();

    this.currentTxId = txId;
    this.packetSequence = 0;
    this.capturedPcmFloats = [];
    this.nextStartTime = 0;

    // 100ms lead-in silence buffer to prevent syllable clipping
    const silenceSamples = Math.round((this.audioContext ? this.audioContext.sampleRate : 48000) * 0.10);
    this.capturedPcmFloats.push(new Float32Array(silenceSamples));

    this.isRecording = true;
    console.log("[AUDIO-TX] PTT Keyed -> Low-latency streaming recording started for TX ID:", txId);
  }

  flushChunkIfReady(force = false) {
    if (!this.isRecording && !force) return;
    if (!this.capturedPcmFloats || this.capturedPcmFloats.length === 0) return;

    let totalSamples = 0;
    for (const arr of this.capturedPcmFloats) {
      totalSamples += arr.length;
    }

    // Flush every ~85ms chunk (4096 samples at 48kHz) or when forced on PTT release
    const targetSamples = 4096;
    if (totalSamples >= targetSamples || (force && totalSamples > 0)) {
      const combinedPcm = new Float32Array(totalSamples);
      let offset = 0;
      for (const arr of this.capturedPcmFloats) {
        combinedPcm.set(arr, offset);
        offset += arr.length;
      }
      this.capturedPcmFloats = [];

      // Convert Float32 to 16-bit Int16 PCM (50% bandwidth reduction)
      const int16Data = this.floatToInt16(combinedPcm);
      this.sendAudioPacket(this.currentTxId, new Uint8Array(int16Data.buffer), true);
    }
  }

  stopRecording() {
    const txId = this.currentTxId;

    if (this.isRecording) {
      this.flushChunkIfReady(true);
    }

    this.isRecording = false;
    this.currentTxId = null;
    this.capturedPcmFloats = [];
    console.log(`[AUDIO-TX] PTT Released -> Finished streaming voice chunks for TX ID: ${txId}`);
  }

  processCapturedAudio() {
    return;
  }

  floatToInt16(float32Array) {
    const int16 = new Int16Array(float32Array.length);
    for (let i = 0; i < float32Array.length; i++) {
      const s = Math.max(-1, Math.min(1, float32Array[i]));
      int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    return int16;
  }

  int16ToFloat32(int16Array) {
    const float32 = new Float32Array(int16Array.length);
    for (let i = 0; i < int16Array.length; i++) {
      float32[i] = int16Array[i] / (int16Array[i] < 0 ? 32768 : 32767);
    }
    return float32;
  }

  resamplePcmFloat32(inputData, fromSampleRate, toSampleRate) {
    if (!inputData || inputData.length === 0 || fromSampleRate === toSampleRate || fromSampleRate <= 0 || toSampleRate <= 0) {
      return inputData;
    }

    const ratio = fromSampleRate / toSampleRate;
    const newLength = Math.round(inputData.length / ratio);
    const result = new Float32Array(newLength);

    for (let i = 0; i < newLength; i++) {
      const pos = i * ratio;
      const index = Math.floor(pos);
      const frac = pos - index;

      if (index >= inputData.length - 1) {
        result[i] = inputData[inputData.length - 1];
      } else {
        const sample1 = inputData[index];
        const sample2 = inputData[index + 1];
        result[i] = sample1 + frac * (sample2 - sample1);
      }
    }
    return result;
  }

  resampleFloat32(inputData) {
    return inputData;
  }

  sendAudioPacket(txId, payloadBytes, isInt16 = true) {
    if (!txId) return;

    const txHash = this.hashCode(txId);
    const sequence = this.packetSequence++ >>> 0;
    // Set bit 31 of sample rate header to indicate 16-bit Int16 PCM format
    const baseSampleRate = (this.audioContext ? this.audioContext.sampleRate : 48000) >>> 0;
    const sampleRateHeader = (baseSampleRate & 0x7FFFFFFF) | (isInt16 ? 0x80000000 : 0);

    const buffer = new Uint8Array(12 + payloadBytes.length);
    buffer[0] = (txHash >> 24) & 0xFF;
    buffer[1] = (txHash >> 16) & 0xFF;
    buffer[2] = (txHash >> 8) & 0xFF;
    buffer[3] = txHash & 0xFF;
    buffer[4] = (sequence >> 24) & 0xFF;
    buffer[5] = (sequence >> 16) & 0xFF;
    buffer[6] = (sequence >> 8) & 0xFF;
    buffer[7] = sequence & 0xFF;
    buffer[8] = (sampleRateHeader >> 24) & 0xFF;
    buffer[9] = (sampleRateHeader >> 16) & 0xFF;
    buffer[10] = (sampleRateHeader >> 8) & 0xFF;
    buffer[11] = sampleRateHeader & 0xFF;
    buffer.set(payloadBytes, 12);

    this.app.socketManager.sendAudioChunk(buffer);
  }

  hashCode(str) {
    let hash = 0;
    if (!str) return 0;
    for (let i = 0; i < str.length; i++) {
      hash = (hash << 5) - hash + str.charCodeAt(i);
      hash |= 0;
    }
    return hash;
  }

  async receiveAudioChunk(binaryData) {
    if (!this.audioContext) {
      await this.init();
    }
    
    if (this.audioContext && (this.audioContext.state === 'suspended' || this.audioContext.state === 'interrupted')) {
      try {
        await Promise.race([
          this.audioContext.resume(),
          new Promise((_, reject) => setTimeout(() => reject(new Error("AudioContext resume timeout")), 200))
        ]);
      } catch (_err) {
        // Ignored
      }
    }

    if (!this.audioContext || this.audioContext.state !== 'running') {
      if (this.app.telemetryManager && this.audioContext) {
        this.app.telemetryManager.recordRxDrop(`AudioContext State: ${this.audioContext.state.toUpperCase()} (Browser autoplay restriction)`);
      }
      this.nextStartTime = 0;
      return;
    }

    let packet = binaryData;
    if (packet instanceof ArrayBuffer) {
      packet = new Uint8Array(packet);
    }
    if (!(packet instanceof Uint8Array)) {
      packet = new Uint8Array(packet);
    }

    if (packet.length <= 8) {
      console.warn("⚠️ [AUDIO-RX] Packet too short, ignoring.");
      return;
    }

    let srcSampleRate = 48000;
    let isInt16 = false;
    let payload;

    if (packet.length >= 12) {
      const rawRate = ((packet[8] << 24) | (packet[9] << 16) | (packet[10] << 8) | packet[11]) >>> 0;
      isInt16 = (rawRate & 0x80000000) !== 0;
      const extractedRate = rawRate & 0x7FFFFFFF;
      if (extractedRate >= 8000 && extractedRate <= 192000) {
        srcSampleRate = extractedRate;
        payload = packet.subarray(12);
      } else {
        payload = packet.subarray(8);
      }
    } else {
      payload = packet.subarray(8);
    }

    if (!payload || payload.length === 0) {
      return;
    }

    let float32;
    const sliced = payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength);
    if (isInt16) {
      // Decode 16-bit Int16 PCM payload
      const int16Array = new Int16Array(sliced);
      float32 = this.int16ToFloat32(int16Array);
    } else {
      // Decode 32-bit Float PCM payload (backwards compatibility)
      float32 = new Float32Array(sliced);
    }

    if (!float32 || float32.length === 0) {
      if (this.app.telemetryManager) {
        this.app.telemetryManager.recordRxDrop('Decode Failure: Empty or corrupted PCM payload');
      }
      return;
    }

    // Resample PCM Float32 to match receiver's local AudioContext sample rate.
    // This prevents mobile browsers (iOS WebKit / Android Chromium) from running low-quality C++ streaming resamplers that cause slow/noisy audio.
    const targetSampleRate = this.audioContext.sampleRate;
    if (srcSampleRate !== targetSampleRate) {
      float32 = this.resamplePcmFloat32(float32, srcSampleRate, targetSampleRate);
    }

    const audioBuf = this.audioContext.createBuffer(1, float32.length, targetSampleRate);
    audioBuf.getChannelData(0).set(float32);

    const currentTime = this.audioContext.currentTime;
    if (!this.nextStartTime || this.nextStartTime < currentTime || (this.nextStartTime - currentTime) > 0.40) {
      this.nextStartTime = currentTime + 0.03; // Clamp jitter buffer to 30ms for real-time low latency
    }

    const source = this.audioContext.createBufferSource();
    source.buffer = audioBuf;
    source.connect(this.voiceGainNode);

    if (!this.activeRxSources) this.activeRxSources = [];
    
    // Throttle queue: Stop oldest source if >6 sources are active to prevent CPU & AudioNode choking
    if (this.activeRxSources.length > 6) {
      const oldest = this.activeRxSources.shift();
      if (oldest) {
        try { oldest.stop(); oldest.disconnect(); } catch (e) {}
      }
    }
    this.activeRxSources.push(source);

    const chunkId = Symbol('rxChunk');
    if (this.app.telemetryManager) {
      this.app.telemetryManager.recordRxChunk(payload.byteLength, chunkId);
    }

    source.onended = () => {
      const idx = this.activeRxSources.indexOf(source);
      if (idx !== -1) this.activeRxSources.splice(idx, 1);
      if (this.app.telemetryManager) {
        this.app.telemetryManager.markRxChunkPlayed(chunkId);
      }
    };

    source.start(this.nextStartTime);
    this.nextStartTime += audioBuf.duration;
    this.lastScheduledEndTime = this.nextStartTime;
  }

  stopAllRxSources() {
    if (this.activeRxSources && this.activeRxSources.length > 0) {
      this.activeRxSources.forEach(src => {
        try { src.stop(); src.disconnect(); } catch (e) {}
      });
      this.activeRxSources = [];
    }
    this.nextStartTime = 0;
    this.lastScheduledEndTime = 0;
  }

  getRemainingPlaybackMs() {
    if (!this.audioContext || !this.lastScheduledEndTime) return 0;
    const remainingSec = this.lastScheduledEndTime - this.audioContext.currentTime;
    return Math.max(0, Math.round(remainingSec * 1000));
  }

  clearPlaybackQueue() {
    this.nextStartTime = 0;
    this.lastScheduledEndTime = 0;
    if (this.activeRxSources) {
      for (const src of this.activeRxSources) {
        try {
          src.stop();
          src.disconnect();
        } catch (_e) {
          // Ignore if already stopped
        }
      }
      this.activeRxSources = [];
    }
  }

  getTxVolumeRMS() {
    if (!this.txAnalyser || !this.isRecording) return 0;
    this.txAnalyser.getByteFrequencyData(this.txDataArray);
    let sum = 0;
    for (let i = 0; i < this.txDataArray.length; i++) {
      sum += this.txDataArray[i];
    }
    return sum / (this.txDataArray.length * 255);
  }

  getRxVolumeRMS() {
    if (!this.rxAnalyser || !this.audioContext) return 0;
    this.rxAnalyser.getByteFrequencyData(this.rxDataArray);
    let sum = 0;
    for (let i = 0; i < this.rxDataArray.length; i++) {
      sum += this.rxDataArray[i];
    }
    return sum / (this.rxDataArray.length * 255);
  }

  getQueuedBufferMs() {
    if (!this.audioContext || !this.nextStartTime) return 0;
    const diff = (this.nextStartTime - this.audioContext.currentTime) * 1000;
    return Math.max(0, Math.round(diff));
  }

  getAudioContextState() {
    return this.audioContext ? this.audioContext.state : 'uninitialized';
  }

  async resumeAudioContext() {
    if (this.audioContext && (this.audioContext.state === 'suspended' || this.audioContext.state === 'interrupted')) {
      await this.audioContext.resume();
      console.log("🔊 [AUDIO] WebAudio AudioContext successfully resumed via user tap.");
    }
  }
}
