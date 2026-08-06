// Unit tests for static/js/telemetry.js using Node native test runner (node --test)
import test from 'node:test';
import assert from 'node:assert/strict';
import { TelemetryManager } from '../../static/js/telemetry.js';

test('TelemetryManager - finishTxSession defers summary logging via timer', (t, done) => {
  const dummyApp = { isTransmitting: false, audioEngine: null };
  const manager = new TelemetryManager(dummyApp);

  manager.startTxSession();
  manager.recordTxChunk(4096);
  manager.recordTxAck(4096);

  assert.equal(manager.txChunksSent, 1);
  assert.equal(manager.txAcksReceived, 1);

  manager.finishTxSession();

  // Immediately after calling finishTxSession, timer is active and stats have not reset yet
  assert.ok(manager.txTimerId !== null);
  assert.equal(manager.txChunksSent, 1);

  // After 300ms, timer has fired and stats have reset
  setTimeout(() => {
    assert.equal(manager.txTimerId, null);
    assert.equal(manager.txChunksSent, 0);
    assert.equal(manager.txAcksReceived, 0);
    done();
  }, 300);
});

test('TelemetryManager - recordRxChunk and markRxChunkPlayed match played count accurately', () => {
  const dummyApp = { isTransmitting: false, audioEngine: null };
  const manager = new TelemetryManager(dummyApp);

  const chunkId1 = Symbol('chunk1');
  const chunkId2 = Symbol('chunk2');

  manager.recordRxChunk(4096, chunkId1);
  manager.recordRxChunk(4096, chunkId2);

  assert.equal(manager.rxChunksReceived, 2);
  assert.equal(manager.rxChunksPlayed, 0);

  manager.markRxChunkPlayed(chunkId1);
  manager.markRxChunkPlayed(chunkId2);

  assert.equal(manager.rxChunksPlayed, 2);
  const unplayed = Math.max(0, manager.rxChunksReceived - Math.min(manager.rxChunksReceived, manager.rxChunksPlayed));
  assert.equal(unplayed, 0);
});
