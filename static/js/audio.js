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
    
    // Squelch click assets & transmitter sidetone
    this.whiteNoiseBuffer = null;
    this.sidetoneOsc = null;
    this.sidetoneGain = null;
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
    // Pure audio mode: No noise buffer needed
    return;
  }

  makeDistortionCurve(amount = 20) {
    return new Float32Array(0);
  }

  setupEffectsChain() {
    // Pure audio mode: Direct 1:1 voice gain node to destination without filters, distortion, or noise
    this.voiceGainNode = this.audioContext.createGain();
    this.voiceGainNode.gain.setValueAtTime(1.0, this.audioContext.currentTime);

    // Direct pure audio connection to output destination
    this.voiceGainNode.connect(this.audioContext.destination);
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
    // Pure audio mode: No simulated signal quality degradation or static noise
    return;
  }

  playPTTStartChirp() {
    // Pure audio mode: No PTT chirp sound effect
    return;
  }

  startTransmitterSidetone() {
    // Pure audio mode: No transmitter sidetone
    return;
  }

  stopTransmitterSidetone() {
    // Pure audio mode: No transmitter sidetone
    return;
  }

  playPTTEndSquelchTail() {
    // Pure audio mode: No squelch tail noise
    return;
  }

  async startRecording(txId) {
    if (!this.audioContext) await this.init();
    
    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume();
    }

    // Start subtle local transmitter carrier sidetone while keying PTT
    this.startTransmitterSidetone();

    try {
      const supportError = WebAudioEngine.getMediaCaptureSupportReason();
      if (supportError) {
        throw new Error(supportError);
      }

      this.micStream = await this.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
          sampleRate: this.audioContext.sampleRate
        }
      });
      
      const source = this.audioContext.createMediaStreamSource(this.micStream);
      this.currentTxId = txId;
      this.packetSequence = 0;
      this.expectedReceiveSequence = 0;
      this.receiveQueue = [];
      this.captureBuffer = new Float32Array(0);
      this.recordedChunks = [];

      // Primary High-Fidelity Recording Engine: MediaRecorder
      if (typeof MediaRecorder !== 'undefined') {
        try {
          const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
            ? 'audio/webm;codecs=opus'
            : MediaRecorder.isTypeSupported('audio/webm')
            ? 'audio/webm'
            : MediaRecorder.isTypeSupported('audio/mp4')
            ? 'audio/mp4'
            : '';
          this.mediaRecorder = new MediaRecorder(this.micStream, mimeType ? { mimeType } : {});
          this.mediaRecorder.ondataavailable = (e) => {
            if (e.data && e.data.size > 0) {
              this.recordedChunks.push(e.data);
            }
          };
          this.mediaRecorder.start();
        } catch (err) {
          console.warn("MediaRecorder setup failed:", err);
        }
      }

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
          bitrate: 64000,
          bitrateMode: 'variable'
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
        this.scriptNode = this.audioContext.createScriptProcessor(512, 1, 1);
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
      this.stopTransmitterSidetone();
      console.error("Failed to start microphone recording:", e);
      throw e;
    }
  }

  stopRecording() {
    this.stopTransmitterSidetone();

    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      const txId = this.currentTxId;
      this.mediaRecorder.onstop = async () => {
        if (this.recordedChunks.length > 0 && txId) {
          try {
            const blob = new Blob(this.recordedChunks, { type: this.mediaRecorder.mimeType || 'audio/webm' });
            const arrayBuffer = await blob.arrayBuffer();
            this.sendAudioPacket(txId, new Uint8Array(arrayBuffer));
          } catch (err) {
            console.error("Failed to send recorded audio blob:", err);
          }
        }
      };
      this.mediaRecorder.stop();
      this.mediaRecorder = null;
    }

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
    this.captureBuffer = new Float32Array(0);
  }

  processCapturedAudio(inputData, timestampUs = 0) {
    if (!inputData || !inputData.length) return;

    // Accumulate incoming samples into capture buffer
    const newBuf = new Float32Array(this.captureBuffer.length + inputData.length);
    newBuf.set(this.captureBuffer);
    newBuf.set(inputData, this.captureBuffer.length);
    this.captureBuffer = newBuf;

    // Chunk into exact 20ms frames (e.g. 960 samples at 48kHz)
    const frameSize = Math.round(this.audioContext.sampleRate * 0.02);

    while (this.captureBuffer.length >= frameSize) {
      const frame = this.captureBuffer.subarray(0, frameSize);
      this.captureBuffer = this.captureBuffer.subarray(frameSize);

      const timestamp = timestampUs || Math.round(this.audioContext.currentTime * 1000000);
      if (this.useOpus && this.encoder) {
        const audioFrame = new AudioData({
          format: 'f32-planar',
          sampleRate: this.audioContext.sampleRate,
          numberOfFrames: frame.length,
          numberOfChannels: 1,
          timestamp,
          data: frame
        });
        this.encoder.encode(audioFrame);
        audioFrame.close();
      } else if (this.currentTxId) {
        const pcm16 = new Int16Array(frame.length);
        for (let i = 0; i < frame.length; i++) {
          const s = Math.max(-1, Math.min(1, frame[i]));
          pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }
        this.sendAudioPacket(this.currentTxId, new Uint8Array(pcm16.buffer));
      }
    }
  }

  resampleFloat32(inputData, fromSampleRate, toSampleRate) {
    if (!inputData || !inputData.length) {
      return new Float32Array(0);
    }
    if (!fromSampleRate || !toSampleRate || Math.abs(fromSampleRate - toSampleRate) < 5) {
      return inputData;
    }
    const ratio = fromSampleRate / toSampleRate;
    const newLength = Math.round(inputData.length / ratio);
    const outputData = new Float32Array(newLength);
    const len = inputData.length;
    
    for (let i = 0; i < newLength; i++) {
      const originIndex = i * ratio;
      const idx = Math.floor(originIndex);
      const t = originIndex - idx;
      
      const p0 = inputData[Math.max(0, idx - 1)];
      const p1 = inputData[Math.min(len - 1, idx)];
      const p2 = inputData[Math.min(len - 1, idx + 1)];
      const p3 = inputData[Math.min(len - 1, idx + 2)];
      
      // Cubic Hermite interpolation for smooth anti-aliased resampling
      const a = -0.5 * p0 + 1.5 * p1 - 1.5 * p2 + 0.5 * p3;
      const b = p0 - 2.5 * p1 + 2 * p2 - 0.5 * p3;
      const c = -0.5 * p0 + 0.5 * p2;
      const d = p1;
      
      outputData[i] = a * t * t * t + b * t * t + c * t + d;
    }
    return outputData;
  }

  sendAudioPacket(txId, payloadBytes) {
    // Generate binary buffer: [4 bytes tx hash] + [4 bytes sequence] + [4 bytes sample rate] + payload
    const txHash = this.hashCode(txId);
    const sequence = this.packetSequence++ >>> 0;
    const sampleRate = (this.audioContext ? this.audioContext.sampleRate : 48000) >>> 0;

    const buffer = new Uint8Array(12 + payloadBytes.length);
    buffer[0] = (txHash >> 24) & 0xFF;
    buffer[1] = (txHash >> 16) & 0xFF;
    buffer[2] = (txHash >> 8) & 0xFF;
    buffer[3] = txHash & 0xFF;
    buffer[4] = (sequence >> 24) & 0xFF;
    buffer[5] = (sequence >> 16) & 0xFF;
    buffer[6] = (sequence >> 8) & 0xFF;
    buffer[7] = sequence & 0xFF;
    buffer[8] = (sampleRate >> 24) & 0xFF;
    buffer[9] = (sampleRate >> 16) & 0xFF;
    buffer[10] = (sampleRate >> 8) & 0xFF;
    buffer[11] = sampleRate & 0xFF;
    buffer.set(payloadBytes, 12);

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

  playFullDecodedBuffer(audioBuf) {
    const source = this.audioContext.createBufferSource();
    source.buffer = audioBuf;
    source.connect(this.voiceGainNode);
    source.start(0);
  }

  async receiveAudioChunk(binaryData) {
    if (!this.audioContext) return;
    
    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume();
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
    let srcSampleRate = 48000;
    let payload;

    if (packet.length >= 12) {
      const extractedRate = ((packet[8] << 24) | (packet[9] << 16) | (packet[10] << 8) | packet[11]) >>> 0;
      if (extractedRate >= 8000 && extractedRate <= 192000) {
        srcSampleRate = extractedRate;
        payload = packet.subarray(12);
      } else {
        payload = packet.subarray(8);
      }
    } else {
      payload = packet.subarray(8);
    }

    // Detect complete recorded audio clip (WebM EBML, Ogg, MP4, or WAV header)
    const isMediaBlob = payload.length > 4 && (
      (payload[0] === 0x1A && payload[1] === 0x45 && payload[2] === 0xDF && payload[3] === 0xA3) ||
      (payload[0] === 0x4F && payload[1] === 0x67 && payload[2] === 0x67 && payload[3] === 0x53) ||
      (payload[0] === 0x52 && payload[1] === 0x49 && payload[2] === 0x46 && payload[3] === 0x46) ||
      (payload[4] === 0x66 && payload[5] === 0x74 && payload[6] === 0x79 && payload[7] === 0x70)
    );

    if (isMediaBlob) {
      try {
        const rawBuffer = payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength);
        const decodedBuf = await this.audioContext.decodeAudioData(rawBuffer);
        this.playFullDecodedBuffer(decodedBuf);
        return;
      } catch (e) {
        console.warn("decodeAudioData failed for media blob, falling back to real-time packet decoder", e);
      }
    }

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

    // Resample raw PCM from sender's sample rate to receiver's audioContext.sampleRate
    float32 = this.resampleFloat32(float32, srcSampleRate, this.audioContext.sampleRate);

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
    const frames = audioData.numberOfFrames;
    const srcSampleRate = audioData.sampleRate || 48000;
    const float32 = new Float32Array(frames);
    
    // Copy channel 0 floats
    audioData.copyTo(float32, { planeIndex: 0 });
    audioData.close();

    // Resample WebCodecs Opus decoded audio to receiver's AudioContext sample rate
    const targetSampleRate = this.audioContext ? this.audioContext.sampleRate : 48000;
    const resampledFloat32 = this.resampleFloat32(float32, srcSampleRate, targetSampleRate);

    this.schedulePlaybackBuffer(resampledFloat32);
  }

  schedulePlaybackBuffer(floatArray) {
    const audioBuf = this.audioContext.createBuffer(1, floatArray.length, this.audioContext.sampleRate);
    audioBuf.getChannelData(0).set(floatArray);

    const source = this.audioContext.createBufferSource();
    source.buffer = audioBuf;

    // Route playback node through our signal quality effects chain!
    source.connect(this.voiceGainNode);

    // Schedule playback with smooth jitter buffer lead time to prevent pops/underflows.
    const now = this.audioContext.currentTime;
    const minLeadTime = 0.045;
    const maxLeadTime = 0.140;

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
