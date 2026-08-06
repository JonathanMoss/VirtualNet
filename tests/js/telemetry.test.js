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
