import test from 'node:test';
import assert from 'node:assert/strict';
import { WebAudioEngine } from '../../static/js/audio.js';

/**
 * Mock WebAudio AudioContext for unit testing.
 */
class MockAudioContext {
  constructor(options = {}) {
    this.sampleRate = options.sampleRate || 48000;
    this.currentTime = 10.0;
    this.state = options.state || 'running';
  }

  createGain() {
    return {
      gain: { setValueAtTime: () => {} },
      connect: () => {}
    };
  }

  createAnalyser() {
    return {
      fftSize: 32,
      connect: () => {}
    };
  }

  createBuffer(channels, length, sampleRate) {
    const channelData = new Float32Array(length);
    return {
      numberOfChannels: channels,
      length,
      sampleRate,
      duration: length / sampleRate,
      getChannelData: () => channelData
    };
  }

  createBufferSource() {
    return {
      buffer: null,
      connect: () => {},
      start: () => {},
      stop: () => {},
      disconnect: () => {}
    };
  }

  async resume() {
    this.state = 'running';
  }
}

/**
 * Helper to build a valid audio chunk packet buffer.
 */
function createDummyAudioPacket(sampleCount = 4096, sampleRate = 48000) {
  const header = new Uint8Array(12);
  // Hash txId (4 bytes)
  header[0] = 0x00; header[1] = 0x00; header[2] = 0x00; header[3] = 0x01;
  // Sequence (4 bytes)
  header[4] = 0x00; header[5] = 0x00; header[6] = 0x00; header[7] = 0x01;
  // Sample rate header with Int16 bit set
  const sampleRateHeader = (sampleRate & 0x7FFFFFFF) | 0x80000000;
  header[8] = (sampleRateHeader >> 24) & 0xFF;
  header[9] = (sampleRateHeader >> 16) & 0xFF;
  header[10] = (sampleRateHeader >> 8) & 0xFF;
  header[11] = sampleRateHeader & 0xFF;

  // Int16 payload (2 bytes per sample)
  const payload = new Uint8Array(sampleCount * 2);
  const fullPacket = new Uint8Array(header.length + payload.length);
  fullPacket.set(header, 0);
  fullPacket.set(payload, header.length);
  return fullPacket;
}

test('audio buffer scheduling - 170ms 2-chunk buffer queue does not trigger false jitter reset', async () => {
  const app = {
    socketManager: {},
    telemetryManager: null
  };
  const engine = new WebAudioEngine(app);
  engine.audioContext = new MockAudioContext({ state: 'running' });
  engine.voiceGainNode = engine.audioContext.createGain();

  const currentTime = engine.audioContext.currentTime; // 10.0
  const chunkPacket = createDummyAudioPacket(4096, 48000); // ~0.0853s duration

  // Receive Chunk 1
  await engine.receiveAudioChunk(chunkPacket);
  // nextStartTime should be initialised to currentTime + 0.03 (10.03) + chunk duration (0.085333) = ~10.115333
  const expectedAfter1 = 10.03 + (4096 / 48000);
  assert.ok(Math.abs(engine.nextStartTime - expectedAfter1) < 0.0001, `After chunk 1, nextStartTime expected ~${expectedAfter1}, got ${engine.nextStartTime}`);

  // Receive Chunk 2 immediately (simulation of 2 buffered consecutive chunks)
  // Diff = nextStartTime - currentTime = 10.115333 - 10.0 = 0.115333s (~115.3ms)
  await engine.receiveAudioChunk(chunkPacket);
  const expectedAfter2 = expectedAfter1 + (4096 / 48000);
  assert.ok(Math.abs(engine.nextStartTime - expectedAfter2) < 0.0001, `After chunk 2, nextStartTime expected ~${expectedAfter2}, got ${engine.nextStartTime}`);

  // Receive Chunk 3 (simulating 170.6ms queued buffer diff)
  // Diff = 10.200666 - 10.0 = 0.200666s (200.7ms)
  // Previously threshold was 0.12s (120ms), which caused a false reset to 10.03!
  // With 0.40s (400ms) threshold, no reset occurs and chunk is appended seamlessly.
  await engine.receiveAudioChunk(chunkPacket);
  const expectedAfter3 = expectedAfter2 + (4096 / 48000);
  assert.ok(Math.abs(engine.nextStartTime - expectedAfter3) < 0.0001, `After chunk 3, nextStartTime expected ~${expectedAfter3}, got ${engine.nextStartTime}`);
});

test('audio buffer scheduling - extreme network lag (>400ms) triggers jitter reset', async () => {
  const app = { socketManager: {} };
  const engine = new WebAudioEngine(app);
  engine.audioContext = new MockAudioContext({ state: 'running' });
  engine.voiceGainNode = engine.audioContext.createGain();

  // Set nextStartTime far into the future (500ms lag ahead of currentTime 10.0)
  engine.nextStartTime = 10.50; // diff = 0.50s > 0.40s threshold

  const chunkPacket = createDummyAudioPacket(4096, 48000);
  await engine.receiveAudioChunk(chunkPacket);

  // Should trigger jitter reset to currentTime + 0.03 (10.03) + 0.085333 duration
  const expected = 10.03 + (4096 / 48000);
  assert.ok(Math.abs(engine.nextStartTime - expected) < 0.0001, `Jitter reset expected nextStartTime ~${expected}, got ${engine.nextStartTime}`);
});

test('receiveAudioChunk - drops incoming chunks when AudioContext state is not running', async () => {
  let droppedReason = null;
  const app = {
    socketManager: {},
    telemetryManager: {
      recordRxDrop: (reason) => { droppedReason = reason; }
    }
  };
  const engine = new WebAudioEngine(app);
  // AudioContext remains suspended (mock resume doesn't auto-run without gesture emulation)
  const mockCtx = new MockAudioContext({ state: 'suspended' });
  mockCtx.resume = async () => {}; // stays suspended
  engine.audioContext = mockCtx;

  const chunkPacket = createDummyAudioPacket(4096, 48000);
  await engine.receiveAudioChunk(chunkPacket);

  assert.equal(engine.nextStartTime, 0, 'nextStartTime should be reset to 0 when chunk is dropped');
  assert.ok(droppedReason && droppedReason.includes('SUSPENDED'), `Expected telemetry rx drop for suspended state, got: ${droppedReason}`);
});

test('resamplePcmFloat32 - correctly resamples 48kHz input to 44.1kHz and 44.1kHz to 48kHz', () => {
  const engine = new WebAudioEngine({});
  const input48k = new Float32Array(4800); // 100ms at 48kHz
  for (let i = 0; i < input48k.length; i++) {
    input48k[i] = Math.sin(2 * Math.PI * 440 * (i / 48000));
  }

  // Resample 48000 -> 44100
  const resampled44k = engine.resamplePcmFloat32(input48k, 48000, 44100);
  const expectedLength44k = Math.round(4800 * (44100 / 48000)); // 4410 samples
  assert.equal(resampled44k.length, expectedLength44k, `Expected ${expectedLength44k} samples, got ${resampled44k.length}`);

  // Resample 44100 -> 48000
  const resampled48k = engine.resamplePcmFloat32(resampled44k, 44100, 48000);
  assert.equal(resampled48k.length, 4800, `Expected 4800 samples, got ${resampled48k.length}`);
});

test('receiveAudioChunk - resamples incoming PCM to match receiver AudioContext sampleRate', async () => {
  const app = { socketManager: {} };
  const engine = new WebAudioEngine(app);
  // Receiver AudioContext running at 44100 Hz
  engine.audioContext = new MockAudioContext({ state: 'running', sampleRate: 44100 });
  engine.voiceGainNode = engine.audioContext.createGain();

  // Incoming chunk header specifies 48000 Hz sender rate
  const senderPacket = createDummyAudioPacket(4096, 48000);
  await engine.receiveAudioChunk(senderPacket);

  // AudioBuffer should be created at receiver's 44100 Hz sample rate
  assert.ok(engine.activeRxSources.length > 0, 'activeRxSources should contain scheduled buffer source');
  const sourceNode = engine.activeRxSources[0];
  assert.equal(sourceNode.buffer.sampleRate, 44100, `AudioBuffer sample rate should match receiver AudioContext (44100), got ${sourceNode.buffer.sampleRate}`);
});
