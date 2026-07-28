// Web Audio Engine and Simulated Radio Effects Module - VirtualNet

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
    this.receiveQueue = [];
    this.receiveTimer = null;
    this.receiveLatencyMs = 55;
    this.expectedReceiveSequence = 0;
    
    // Playback scheduling state
    this.nextStartTime = 0;
    this.bufferQueue = [];
    
    // Audio effects nodes
    this.voiceGainNode = null;
    this.bypassGainNode = null;
    this.compressorNode = null;
    this.bandpassFilterNode = null;
    this.bandpassGainNode = null;
    this.noiseGainNode = null;
    this.noiseSourceNode = null;
    
    // Audio fade interval for UNWORKABLE simulation
    this.dropoutInterval = null;
    
    // Squelch click assets
    this.whiteNoiseBuffer = null;
  }

  async init() {
    // Lazy-initialize AudioContext on user interaction with the lowest latency hint.
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    this.audioContext = new AudioContextClass({ latencyHint: 'interactive' });
    
    // Pre-generate a 1-second looping white noise buffer for static simulation
    this.generateNoiseBuffer();
    
    // Setup playback effects chain
    this.setupEffectsChain();
    
    // Initialize WebCodecs Encoder/Decoder if available
    this.initCodec();
  }

  generateNoiseBuffer() {
    const bufferSize = this.audioContext.sampleRate; // 1 second
    this.whiteNoiseBuffer = this.audioContext.createBuffer(1, bufferSize, this.audioContext.sampleRate);
    const data = this.whiteNoiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }
  }

  setupEffectsChain() {
    // 1. Voice gain controls voice level
    this.voiceGainNode = this.audioContext.createGain();
    this.voiceGainNode.gain.setValueAtTime(1.0, this.audioContext.currentTime);

    // 2. Bypass path for clean audio quality when network conditions are good.
    this.bypassGainNode = this.audioContext.createGain();
    this.bypassGainNode.gain.setValueAtTime(1.0, this.audioContext.currentTime);

    // 3. Bandpass filter to keep radio-quality fallback available.
    this.bandpassFilterNode = this.audioContext.createBiquadFilter();
    this.bandpassFilterNode.type = 'bandpass';
    this.bandpassFilterNode.frequency.setValueAtTime(1850, this.audioContext.currentTime);
    this.bandpassFilterNode.Q.setValueAtTime(1.0, this.audioContext.currentTime);
    this.bandpassGainNode = this.audioContext.createGain();
    this.bandpassGainNode.gain.setValueAtTime(0.0, this.audioContext.currentTime);

    // 4. Noise node mixes white noise static hiss
    this.noiseGainNode = this.audioContext.createGain();
    this.noiseGainNode.gain.setValueAtTime(0.0, this.audioContext.currentTime);

    // Compressor for clean voice clarity on bypass path
    this.compressorNode = this.audioContext.createDynamicsCompressor();
    this.compressorNode.threshold.setValueAtTime(-24, this.audioContext.currentTime);
    this.compressorNode.knee.setValueAtTime(30, this.audioContext.currentTime);
    this.compressorNode.ratio.setValueAtTime(4, this.audioContext.currentTime);
    this.compressorNode.attack.setValueAtTime(0.003, this.audioContext.currentTime);
    this.compressorNode.release.setValueAtTime(0.25, this.audioContext.currentTime);

    // Play continuously static loop
    this.noiseSourceNode = this.audioContext.createBufferSource();
    this.noiseSourceNode.buffer = this.whiteNoiseBuffer;
    this.noiseSourceNode.loop = true;

    // Connect static noise to output
    this.noiseSourceNode.connect(this.noiseGainNode);

    // Voice goes through both a clean bypass path and a filtered radio-style path.
    this.voiceGainNode.connect(this.bypassGainNode);
    this.voiceGainNode.connect(this.bandpassFilterNode);

    // Connect both voice and noise output to destination
    this.bypassGainNode.connect(this.compressorNode);
    this.compressorNode.connect(this.audioContext.destination);
    this.bandpassFilterNode.connect(this.bandpassGainNode);
    this.bandpassGainNode.connect(this.audioContext.destination);
    this.noiseGainNode.connect(this.audioContext.destination);

    // Start static noise source running
    this.noiseSourceNode.start(0);
  }

  initCodec() {
    const isWebCodecsSupported = typeof AudioEncoder !== 'undefined' && typeof AudioDecoder !== 'undefined';
    
    if (isWebCodecsSupported) {
      console.log("WebCodecs Opus encoding supported.");
      
      // Initialize AudioDecoder
      this.decoder = new AudioDecoder({
        output: (audioData) => this.handleDecodedAudio(audioData),
        error: (e) => console.error("Opus Decoder error:", e)
      });
      
      this.decoder.configure({
        codec: 'opus',
        sampleRate: this.audioContext.sampleRate,
        numberOfChannels: 1
      });
    } else {
      console.warn("WebCodecs not supported. Falling back to raw PCM streaming.");
    }
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

    const host = window.location.hostname;
    const isLocalhost = host === 'localhost' || host === '127.0.0.1' || host === '::1';
    if (!window.isSecureContext && !isLocalhost) {
      return 'Microphone capture requires a secure origin. Use HTTPS or run the app on localhost/127.0.0.1.';
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

  updateSignalQualityEffects(quality) {
    if (!this.audioContext) return;
    
    const now = this.audioContext.currentTime;
    
    if (this.dropoutInterval) {
      clearInterval(this.dropoutInterval);
      this.dropoutInterval = null;
    }

    if (quality === 'OK') {
      // Clean signal, bypass radio-style filtering, no static.
      this.bypassGainNode.gain.setTargetAtTime(1.0, now, 0.05);
      this.bandpassGainNode.gain.setTargetAtTime(0.0, now, 0.05);
      this.noiseGainNode.gain.setTargetAtTime(0.0, now, 0.05);
      this.bandpassFilterNode.frequency.setTargetAtTime(this.audioContext.sampleRate / 2, now, 0.05);
      this.bandpassFilterNode.Q.setTargetAtTime(0.7, now, 0.05);

    } else if (quality === 'DIFFICULT') {
      // Mildly filtered signal with subtle noise.
      this.bypassGainNode.gain.setTargetAtTime(0.0, now, 0.05);
      this.bandpassGainNode.gain.setTargetAtTime(0.85, now, 0.05);
      this.noiseGainNode.gain.setTargetAtTime(0.045, now, 0.05);
      this.bandpassFilterNode.frequency.setTargetAtTime(1800, now, 0.05);
      this.bandpassFilterNode.Q.setTargetAtTime(1.1, now, 0.05);

    } else if (quality === 'UNWORKABLE') {
      // Radio-style effect with heavier filtering and hiss.
      this.bypassGainNode.gain.setTargetAtTime(0.0, now, 0.05);
      this.bandpassGainNode.gain.setTargetAtTime(1.0, now, 0.05);
      this.noiseGainNode.gain.setTargetAtTime(0.12, now, 0.05);
      this.bandpassFilterNode.frequency.setTargetAtTime(1200, now, 0.05);
      this.bandpassFilterNode.Q.setTargetAtTime(1.8, now, 0.05);
    }
  }

  playPTTStartChirp() {
    if (!this.audioContext) return;
    const now = this.audioContext.currentTime;
    
    // Quick synthesizer chirp click (1200Hz -> 600Hz envelope over 40ms)
    const osc = this.audioContext.createOscillator();
    const gain = this.audioContext.createGain();
    
    osc.type = 'sine';
    osc.frequency.setValueAtTime(1200, now);
    osc.frequency.exponentialRampToValueAtTime(600, now + 0.04);
    
    gain.gain.setValueAtTime(0.15, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.04);
    
    osc.connect(gain);
    gain.connect(this.audioContext.destination);
    
    osc.start(now);
    osc.stop(now + 0.04);
  }

  playPTTEndSquelchTail() {
    if (!this.audioContext || !this.whiteNoiseBuffer) return;
    const now = this.audioContext.currentTime;
    
    // Play a brief 150ms burst of low-pass filtered noise to simulate squelch release
    const noise = this.audioContext.createBufferSource();
    noise.buffer = this.whiteNoiseBuffer;
    
    const filter = this.audioContext.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(800, now);
    
    const gain = this.audioContext.createGain();
    gain.gain.setValueAtTime(0.35, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
    
    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.audioContext.destination);
    
    noise.start(now);
    noise.stop(now + 0.18);
  }

  async startRecording(txId) {
    if (!this.audioContext) await this.init();
    
    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume();
    }

    try {
      const supportError = WebAudioEngine.getMediaCaptureSupportReason();
      if (supportError) {
        throw new Error(supportError);
      }

      this.micStream = await this.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          channelCount: 1,
          sampleRate: this.audioContext.sampleRate,
          sampleSize: 16
        }
      });
      
      const source = this.audioContext.createMediaStreamSource(this.micStream);
      this.currentTxId = txId;
      this.packetSequence = 0;
      this.expectedReceiveSequence = 0;
      this.receiveQueue = [];

      // Setup WebCodecs encoder if available for lower bandwidth and better quality.
      this.useOpus = typeof AudioEncoder !== 'undefined';
      if (this.useOpus) {
        this.encoder = new AudioEncoder({
          output: (chunk) => {
            const audioData = new Uint8Array(chunk.byteLength);
            chunk.copyTo(audioData);
            this.sendAudioPacket(txId, audioData);
          },
          error: (e) => console.error("AudioEncoder error:", e)
        });
        
        this.encoder.configure({
          codec: 'opus',
          sampleRate: this.audioContext.sampleRate,
          numberOfChannels: 1,
          bitrate: 32000,
          bitrateMode: 'constant'
        });
      }

      // Prefer AudioWorklet where available for lower latency capture.
      if (this.audioContext.audioWorklet && typeof AudioWorkletNode !== 'undefined') {
        await this.audioContext.audioWorklet.addModule(new URL('./audio-worklet-processor.js', import.meta.url));
        this.workletNode = new AudioWorkletNode(this.audioContext, 'pcm-processor', {
          numberOfInputs: 1,
          numberOfOutputs: 0,
          channelCount: 1
        });
        this.workletNode.port.onmessage = (event) => {
          const floatData = new Float32Array(event.data);
          this.processCapturedAudio(floatData);
        };
        source.connect(this.workletNode);
      } else {
        this.scriptNode = this.audioContext.createScriptProcessor(64, 1, 1);
        let timestampUs = 0;
        this.scriptNode.onaudioprocess = (e) => {
          const inputData = e.inputBuffer.getChannelData(0);
          this.processCapturedAudio(inputData, timestampUs);
          timestampUs += (inputData.length / this.audioContext.sampleRate) * 1000000;
        };
        source.connect(this.scriptNode);
        const dummyGain = this.audioContext.createGain();
        dummyGain.gain.setValueAtTime(0, this.audioContext.currentTime);
        this.scriptNode.connect(dummyGain);
        dummyGain.connect(this.audioContext.destination);
      }
      
    } catch (e) {
      console.error("Failed to start microphone recording:", e);
      throw e;
    }
  }

  stopRecording() {
    if (this.scriptNode) {
      this.scriptNode.disconnect();
      this.scriptNode = null;
    }
    if (this.workletNode) {
      this.workletNode.port.close();
      this.workletNode.disconnect();
      this.workletNode = null;
    }
    if (this.micStream) {
      this.micStream.getTracks().forEach(track => track.stop());
      this.micStream = null;
    }
    if (this.encoder) {
      this.encoder.close();
      this.encoder = null;
    }
    this.currentTxId = null;
  }

  processCapturedAudio(inputData, timestampUs = 0) {
    const timestamp = timestampUs || Math.round(this.audioContext.currentTime * 1000000);
    if (this.useOpus && this.encoder) {
      const audioFrame = new AudioData({
        format: 'f32-planar',
        sampleRate: this.audioContext.sampleRate,
        numberOfFrames: inputData.length,
        numberOfChannels: 1,
        timestamp,
        data: inputData
      });
      this.encoder.encode(audioFrame);
      audioFrame.close();
    } else if (this.currentTxId) {
      const pcm16 = new Int16Array(inputData.length);
      for (let i = 0; i < inputData.length; i++) {
        const s = Math.max(-1, Math.min(1, inputData[i]));
        pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
      }
      this.sendAudioPacket(this.currentTxId, new Uint8Array(pcm16.buffer));
    }
  }

  sendAudioPacket(txId, payloadBytes) {
    // Generate binary buffer: [4 bytes tx hash] + [4 bytes sequence] + payload
    const txHash = this.hashCode(txId);
    const sequence = this.packetSequence++ >>> 0;

    const buffer = new Uint8Array(8 + payloadBytes.length);
    buffer[0] = (txHash >> 24) & 0xFF;
    buffer[1] = (txHash >> 16) & 0xFF;
    buffer[2] = (txHash >> 8) & 0xFF;
    buffer[3] = txHash & 0xFF;
    buffer[4] = (sequence >> 24) & 0xFF;
    buffer[5] = (sequence >> 16) & 0xFF;
    buffer[6] = (sequence >> 8) & 0xFF;
    buffer[7] = sequence & 0xFF;
    buffer.set(payloadBytes, 8);

    this.app.socketManager.sendAudioChunk(buffer);
  }

  startReceiveScheduler() {
    if (this.receiveTimer) return;
    this.receiveTimer = setInterval(() => this.tryFlushReceiveQueue(), 10);
  }

  stopReceiveScheduler() {
    if (this.receiveTimer) {
      clearInterval(this.receiveTimer);
      this.receiveTimer = null;
    }
  }

  tryFlushReceiveQueue() {
    if (!this.receiveQueue.length) {
      this.stopReceiveScheduler();
      return;
    }

    const now = performance.now();
    const first = this.receiveQueue[0];
    const isExpected = first.seq === this.expectedReceiveSequence;
    const isLate = now - first.arrivedAt > 120;
    const hasEnoughBuffered = this.receiveQueue.length >= 4;

    if (!isExpected && !isLate && !hasEnoughBuffered) {
      return;
    }

    if (first.seq > this.expectedReceiveSequence && (isLate || hasEnoughBuffered)) {
      // Skip a missing packet if it has been delayed too long or enough audio is buffered.
      this.expectedReceiveSequence = first.seq;
    }

    const frame = this.receiveQueue.shift();
    this.schedulePlaybackBuffer(frame.float32);
    this.expectedReceiveSequence = frame.seq + 1;
  }

  hashCode(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = (hash << 5) - hash + str.charCodeAt(i);
      hash |= 0; // Convert to 32bit integer
    }
    return hash;
  }

  receiveAudioChunk(binaryData) {
    if (!this.audioContext) return;
    
    if (this.audioContext.state === 'suspended') {
      this.audioContext.resume();
    }

    let packet = binaryData;
    if (packet instanceof ArrayBuffer) {
      packet = new Uint8Array(packet);
    }
    if (!(packet instanceof Uint8Array)) {
      packet = new Uint8Array(packet);
    }

    if (packet.length <= 8) {
      return;
    }

    const seq = (packet[4] << 24) | (packet[5] << 16) | (packet[6] << 8) | packet[7];
    const payload = packet.subarray(8);
    const arrivedAt = performance.now();

    const useOpus = typeof AudioDecoder !== 'undefined' && this.decoder;
    let float32;
    if (useOpus) {
      try {
        const chunk = new EncodedAudioChunk({
          type: 'key',
          timestamp: this.audioContext.currentTime * 1000000,
          data: payload
        });
        this.decoder.decode(chunk);
        return;
      } catch (e) {
        console.warn('WebCodecs decode failed, falling back to raw PCM', e);
      }
    }

    const pcm16 = new Int16Array(payload.buffer, payload.byteOffset, payload.length / 2);
    float32 = new Float32Array(pcm16.length);
    for (let i = 0; i < pcm16.length; i++) {
      float32[i] = pcm16[i] / 32768.0;
    }

    if (this.expectedReceiveSequence === 0) {
      this.expectedReceiveSequence = seq;
    }

    if (seq < this.expectedReceiveSequence) {
      return;
    }

    const duplicate = this.receiveQueue.some(frame => frame.seq === seq);
    if (duplicate) {
      return;
    }

    this.receiveQueue.push({ seq, float32, arrivedAt });
    this.receiveQueue.sort((a, b) => a.seq - b.seq);
    this.startReceiveScheduler();
    this.tryFlushReceiveQueue();
  }

  handleDecodedAudio(audioData) {
    const channels = audioData.numberOfChannels;
    const frames = audioData.numberOfFrames;
    const float32 = new Float32Array(frames);
    
    // Copy channel 0 floats
    audioData.copyTo(float32, { planeIndex: 0 });
    audioData.close();

    this.schedulePlaybackBuffer(float32);
  }

  schedulePlaybackBuffer(floatArray) {
    const audioBuf = this.audioContext.createBuffer(1, floatArray.length, this.audioContext.sampleRate);
    audioBuf.getChannelData(0).set(floatArray);

    const source = this.audioContext.createBufferSource();
    source.buffer = audioBuf;

    // Route playback node through our signal quality effects chain!
    source.connect(this.voiceGainNode);

    // Schedule playback with minimal buffer lead time for lower latency.
    const now = this.audioContext.currentTime;
    const minLeadTime = 0.015;
    const maxLeadTime = 0.08;

    if (this.nextStartTime < now + minLeadTime) {
      this.nextStartTime = now + minLeadTime;
    } else if (this.nextStartTime > now + maxLeadTime) {
      this.nextStartTime = now + minLeadTime;
    }

    source.start(this.nextStartTime);
    this.nextStartTime = Math.max(this.nextStartTime + audioBuf.duration, now + minLeadTime);
  }

  clearPlaybackQueue() {
    this.nextStartTime = 0;
  }
}
