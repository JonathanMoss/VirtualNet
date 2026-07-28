// Web Audio Engine and Simulated Radio Effects Module - VirtualNet

export class WebAudioEngine {
  constructor(app) {
    this.app = app;
    this.audioContext = null;
    this.micStream = null;
    this.scriptNode = null;
    this.encoder = null;
    this.decoder = null;
    
    // Playback scheduling state
    this.nextStartTime = 0;
    this.bufferQueue = [];
    
    // Audio effects nodes
    this.voiceGainNode = null;
    this.bandpassFilterNode = null;
    this.noiseGainNode = null;
    this.noiseSourceNode = null;
    
    // Audio fade interval for UNWORKABLE simulation
    this.dropoutInterval = null;
    
    // Squelch click assets
    this.whiteNoiseBuffer = null;
  }

  async init() {
    // Lazy-initialize AudioContext on user interaction
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    this.audioContext = new AudioContextClass({ sampleRate: 16000 });
    
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

    // 2. Bandpass filter to thins voice frequency
    this.bandpassFilterNode = this.audioContext.createBiquadFilter();
    this.bandpassFilterNode.type = 'bandpass';
    this.bandpassFilterNode.frequency.setValueAtTime(1850, this.audioContext.currentTime); // Center
    this.bandpassFilterNode.Q.setValueAtTime(1.0, this.audioContext.currentTime);

    // 3. Noise node mixes white noise static hiss
    this.noiseGainNode = this.audioContext.createGain();
    this.noiseGainNode.gain.setValueAtTime(0.0, this.audioContext.currentTime);

    // Play continuously static loop
    this.noiseSourceNode = this.audioContext.createBufferSource();
    this.noiseSourceNode.buffer = this.whiteNoiseBuffer;
    this.noiseSourceNode.loop = true;
    
    // Connect static noise to output
    this.noiseSourceNode.connect(this.noiseGainNode);
    
    // Voice goes through bandpass and gain, then mixes with static noise
    this.voiceGainNode.connect(this.bandpassFilterNode);
    
    // Connect both voice and noise output straight to audio destination (speakers)
    this.bandpassFilterNode.connect(this.audioContext.destination);
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
        sampleRate: 16000,
        numberOfChannels: 1
      });
    } else {
      console.warn("WebCodecs not supported. Falling back to raw PCM streaming.");
    }
  }

  updateSignalQualityEffects(quality) {
    if (!this.audioContext) return;
    
    const now = this.audioContext.currentTime;
    
    // Clear any active dropout intervals
    if (this.dropoutInterval) {
      clearInterval(this.dropoutInterval);
      this.dropoutInterval = null;
    }

    if (quality === 'OK') {
      // Clean signal, standard bandpass, no static
      this.voiceGainNode.gain.setTargetAtTime(1.0, now, 0.1);
      this.bandpassFilterNode.frequency.setTargetAtTime(1850, now, 0.1); // center (300Hz-3400Hz approx)
      this.bandpassFilterNode.Q.setTargetAtTime(1.0, now, 0.1);
      this.noiseGainNode.gain.setTargetAtTime(0.0, now, 0.1); // No static
      
    } else if (quality === 'DIFFICULT') {
      // Weak signal, slightly thinner bandpass, static hiss active
      this.voiceGainNode.gain.setTargetAtTime(0.7, now, 0.1);
      this.bandpassFilterNode.frequency.setTargetAtTime(1700, now, 0.1); // narrower center
      this.bandpassFilterNode.Q.setTargetAtTime(1.8, now, 0.1);
      this.noiseGainNode.gain.setTargetAtTime(0.12, now, 0.1); // moderate static
      
    } else if (quality === 'UNWORKABLE') {
      // Terrible link, muffled audio, heavy static, signal dropouts
      this.voiceGainNode.gain.setTargetAtTime(0.25, now, 0.1);
      this.bandpassFilterNode.frequency.setTargetAtTime(1000, now, 0.1); // severe bandpass
      this.bandpassFilterNode.Q.setTargetAtTime(3.0, now, 0.1);
      this.noiseGainNode.gain.setTargetAtTime(0.45, now, 0.1); // heavy static
      
      // Simulate signal fading/dropouts using a random interval modulator
      this.dropoutInterval = setInterval(() => {
        const randGain = Math.random() > 0.4 ? (Math.random() * 0.3) : 0.0;
        if (this.voiceGainNode) {
          this.voiceGainNode.gain.setTargetAtTime(randGain, this.audioContext.currentTime, 0.05);
        }
      }, 300);
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
      this.micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
          sampleRate: 16000
        }
      });
      
      const source = this.audioContext.createMediaStreamSource(this.micStream);
      
      // Setup raw PCM script capture node
      this.scriptNode = this.audioContext.createScriptProcessor(2048, 1, 1);
      
      // Setup WebCodecs encoder if available
      const useOpus = typeof AudioEncoder !== 'undefined';
      if (useOpus) {
        this.encoder = new AudioEncoder({
          output: (chunk) => {
            // Emits binary packet over SocketIO: [4 bytes transmissionId] + [compressed payload]
            const audioData = new Uint8Array(chunk.byteLength);
            chunk.copyTo(audioData);
            this.sendAudioPacket(txId, audioData);
          },
          error: (e) => console.error("AudioEncoder error:", e)
        });
        
        this.encoder.configure({
          codec: 'opus',
          sampleRate: 16000,
          numberOfChannels: 1,
          bitrate: 24000
        });
      }

      let timestampUs = 0;
      this.scriptNode.onaudioprocess = (e) => {
        const inputData = e.inputBuffer.getChannelData(0);
        
        if (useOpus && this.encoder) {
          // Wrap raw floats into AudioData object for WebCodecs
          const audioFrame = new AudioData({
            format: 'f32-planar',
            sampleRate: 16000,
            numberOfFrames: inputData.length,
            numberOfChannels: 1,
            timestamp: timestampUs,
            data: inputData
          });
          
          this.encoder.encode(audioFrame);
          audioFrame.close();
          timestampUs += (inputData.length / 16000) * 1000000;
        } else {
          // Fallback to raw PCM packet sending (16-bit Int format to save bytes)
          const pcm16 = new Int16Array(inputData.length);
          for (let i = 0; i < inputData.length; i++) {
            // clamp floats to int16 range
            const s = Math.max(-1, Math.min(1, inputData[i]));
            pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
          }
          this.sendAudioPacket(txId, new Uint8Array(pcm16.buffer));
        }
      };

      source.connect(this.scriptNode);
      this.scriptNode.connect(this.audioContext.destination);
      
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
    if (this.micStream) {
      this.micStream.getTracks().forEach(track => track.stop());
      this.micStream = null;
    }
    if (this.encoder) {
      this.encoder.close();
      this.encoder = null;
    }
  }

  sendAudioPacket(txId, payloadBytes) {
    // Generate binary buffer: [4 bytes tx hash] + payload
    // We convert the string UUID to a simple 4-byte hash string
    const txHash = this.hashCode(txId);
    
    const buffer = new Uint8Array(4 + payloadBytes.length);
    buffer[0] = (txHash >> 24) & 0xFF;
    buffer[1] = (txHash >> 16) & 0xFF;
    buffer[2] = (txHash >> 8) & 0xFF;
    buffer[3] = txHash & 0xFF;
    buffer.set(payloadBytes, 4);

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

  receiveAudioChunk(binaryData) {
    if (!this.audioContext) return;
    
    if (this.audioContext.state === 'suspended') {
      this.audioContext.resume();
    }

    // Split packet [4 bytes header] + payload
    const payload = binaryData.slice(4);

    const useOpus = typeof AudioDecoder !== 'undefined' && this.decoder;
    if (useOpus) {
      // Decode Opus packet
      const chunk = new EncodedAudioChunk({
        type: 'key',
        timestamp: this.audioContext.currentTime * 1000000,
        data: payload
      });
      this.decoder.decode(chunk);
    } else {
      // Decode raw PCM 16-bit
      const pcm16 = new Int16Array(payload.buffer, payload.byteOffset, payload.length / 2);
      const float32 = new Float32Array(pcm16.length);
      for (let i = 0; i < pcm16.length; i++) {
        float32[i] = pcm16[i] / 32768.0;
      }
      this.schedulePlaybackBuffer(float32);
    }
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
    const audioBuf = this.audioContext.createBuffer(1, floatArray.length, 16000);
    audioBuf.getChannelData(0).set(floatArray);

    const source = this.audioContext.createBufferSource();
    source.buffer = audioBuf;

    // Route playback node through our signal quality effects chain!
    source.connect(this.voiceGainNode);

    // Schedule playback at next smooth start time
    const now = this.audioContext.currentTime;
    if (this.nextStartTime < now) {
      this.nextStartTime = now;
    }

    source.start(this.nextStartTime);
    this.nextStartTime += audioBuf.duration;
  }

  clearPlaybackQueue() {
    this.nextStartTime = 0;
  }
}
