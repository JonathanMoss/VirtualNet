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
    // Lazy-initialize AudioContext at 48000Hz hardware standard to prevent mobile Android sample rate mismatch & crackling.
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    try {
      this.audioContext = new AudioContextClass({ sampleRate: 48000, latencyHint: 'interactive' });
    } catch (e) {
      console.warn("AudioContext custom sampleRate initialization fallback:", e);
      this.audioContext = new AudioContextClass({ latencyHint: 'interactive' });
    }
    
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

  async ensureMicStream() {
    if (this.micStream && this.micStream.active && (this.workletNode || this.scriptNode)) {
      return;
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
          sampleRate: this.audioContext ? this.audioContext.sampleRate : undefined
        }
      });
      
      const source = this.audioContext.createMediaStreamSource(this.micStream);
      this.capturedPcmFloats = [];

      if (this.audioContext.audioWorklet && typeof AudioWorkletNode !== 'undefined') {
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
          }
        };
        source.connect(this.workletNode);
      } else {
        this.scriptNode = this.audioContext.createScriptProcessor(1024, 1, 1);
        this.scriptNode.onaudioprocess = (e) => {
          if (this.isRecording) {
            const inputData = e.inputBuffer.getChannelData(0);
            this.capturedPcmFloats.push(new Float32Array(inputData));
          }
        };
        source.connect(this.scriptNode);
        const dummyGain = this.audioContext.createGain();
        dummyGain.gain.setValueAtTime(0, this.audioContext.currentTime);
        this.scriptNode.connect(dummyGain);
        dummyGain.connect(this.audioContext.destination);
      }
      console.log("🎤 [AUDIO] Microphone stream pre-warmed and active in background.");
    } catch (e) {
      console.warn("Failed to pre-warm microphone stream:", e);
      throw e;
    }
  }

  async startRecording(txId) {
    if (!this.audioContext) await this.init();
    
    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume();
    }

    await this.ensureMicStream();

    this.currentTxId = txId;
    this.packetSequence = 0;
    this.capturedPcmFloats = [];

    // Pre-pad 100ms of lead-in silence so the first spoken syllable is never clipped
    const silenceSamples = Math.round((this.audioContext ? this.audioContext.sampleRate : 48000) * 0.10);
    this.capturedPcmFloats.push(new Float32Array(silenceSamples));

    this.isRecording = true;
    console.log("🎙️ [AUDIO-TX] PTT Keyed -> Recording active with warm mic stream & 100ms lead silence for TX ID:", txId);
  }

  stopRecording() {
    this.isRecording = false;
    const txId = this.currentTxId;

    // Transmit complete recorded voice message as ONE uncompressed 32-bit Float PCM packet upon PTT release
    if (this.capturedPcmFloats && this.capturedPcmFloats.length > 0 && txId) {
      let totalLength = 0;
      for (const arr of this.capturedPcmFloats) {
        totalLength += arr.length;
      }

      if (totalLength > 0) {
        const combinedPcm = new Float32Array(totalLength);
        let offset = 0;
        for (const arr of this.capturedPcmFloats) {
          combinedPcm.set(arr, offset);
          offset += arr.length;
        }

        console.log(`🚀 [AUDIO-TX] PTT Released -> Assembled ${combinedPcm.byteLength} bytes of 32-bit Float PCM audio (${combinedPcm.length} samples) for TX ID: ${txId}`);
        this.sendAudioPacket(txId, new Uint8Array(combinedPcm.buffer));
      }
    } else {
      console.warn("⚠️ [AUDIO-TX] PTT Released, but no PCM audio floats were captured or TX ID missing.");
    }

    this.currentTxId = null;
    this.capturedPcmFloats = [];
  }

  processCapturedAudio() {
    // Single-packet mode: audio is accumulated in capturedPcmFloats and sent on PTT release
    return;
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

    console.log(`📡 [AUDIO-TX-SOCKET] Emitting binary 'audio_chunk' packet (${buffer.byteLength} bytes) to server...`);
    this.app.socketManager.sendAudioChunk(buffer);
  }

  hashCode(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = (hash << 5) - hash + str.charCodeAt(i);
      hash |= 0; // Convert to 32bit integer
    }
    return hash;
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

    console.log(`🔊 [AUDIO-RX] Received binary 'audio_chunk' packet (${packet.length} bytes) from server`);

    if (packet.length <= 8) {
      console.warn("⚠️ [AUDIO-RX] Packet too short, ignoring.");
      return;
    }

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

    if (!payload || payload.length === 0) {
      console.warn("⚠️ [AUDIO-RX] Payload empty, ignoring.");
      return;
    }

    // Unpack 32-bit Float PCM payload with guaranteed 4-byte alignment for Android ARM CPUs
    const pcmBuffer = payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength);
    let float32 = new Float32Array(pcmBuffer, 0, Math.floor(pcmBuffer.byteLength / 4));

    // Resample Float PCM from sender's sample rate to receiver's AudioContext sample rate
    float32 = this.resampleFloat32(float32, srcSampleRate, this.audioContext.sampleRate);

    if (float32.length === 0) return;

    console.log(`▶️ [AUDIO-RX] Playing continuous voice buffer (${float32.length} samples | Sender Rate: ${srcSampleRate}Hz | Receiver Rate: ${this.audioContext.sampleRate}Hz)`);

    // Play pristine continuous audio buffer
    const audioBuf = this.audioContext.createBuffer(1, float32.length, this.audioContext.sampleRate);
    audioBuf.getChannelData(0).set(float32);

    const source = this.audioContext.createBufferSource();
    source.buffer = audioBuf;
    source.connect(this.voiceGainNode);
    source.start(0);
  }

  clearPlaybackQueue() {
    this.nextStartTime = 0;
  }
}
