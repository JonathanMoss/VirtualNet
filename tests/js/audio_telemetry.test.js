import test from 'node:test';
import assert from 'node:assert/strict';

/**
 * Helper function simulating RMS (Root Mean Square) volume level calculation
 * from Float32Array PCM audio buffer.
 */
function calculateRMS(float32Array) {
  if (!float32Array || float32Array.length === 0) return 0;
  let sumSq = 0;
  for (let i = 0; i < float32Array.length; i++) {
    sumSq += float32Array[i] * float32Array[i];
  }
  return Math.sqrt(sumSq / float32Array.length);
}

/**
 * Maps RMS volume float (0.0 to 1.0) into 10 active VU meter segments.
 * Segment index 1-8 = Green, Segment 9 = Amber, Segment 10 = Red.
 */
function getActiveVUSegments(rmsLevel) {
  const scaled = Math.min(1.0, Math.max(0.0, rmsLevel * 3.5)); // Scale gain
  const totalSegments = 10;
  const activeCount = Math.round(scaled * totalSegments);
  return {
    activeCount,
    isAmberActive: activeCount >= 9,
    isRedActive: activeCount >= 10
  };
}

/**
 * Calculates transmission duration and Direction Finding (DF) alert trigger state.
 */
function evaluateDFAlertState(transmissionSeconds) {
  const maxSafeTxSeconds = 20;
  const isAlertActive = transmissionSeconds >= maxSafeTxSeconds;
  const remainingSeconds = Math.max(0, maxSafeTxSeconds - transmissionSeconds);
  return {
    isAlertActive,
    remainingSeconds
  };
}


test('calculateRMS - correctly calculates volume level for silence and sine wave', () => {
  // Silent buffer
  const silentBuffer = new Float32Array(100).fill(0);
  assert.equal(calculateRMS(silentBuffer), 0);

  // Constant DC signal of 0.5
  const constantBuffer = new Float32Array(100).fill(0.5);
  assert.equal(calculateRMS(constantBuffer), 0.5);

  // Peak signal of 1.0 / -1.0 alternating
  const peakBuffer = new Float32Array([1.0, -1.0, 1.0, -1.0]);
  assert.equal(calculateRMS(peakBuffer), 1.0);
});

test('getActiveVUSegments - maps volume levels into VU meter segments accurately', () => {
  // Silence -> 0 segments
  const silence = getActiveVUSegments(0.0);
  assert.equal(silence.activeCount, 0);
  assert.equal(silence.isAmberActive, false);
  assert.equal(silence.isRedActive, false);

  // Normal speech (~0.15 RMS) -> ~5 segments (Green)
  const normalSpeech = getActiveVUSegments(0.15);
  assert.ok(normalSpeech.activeCount >= 4 && normalSpeech.activeCount <= 6);
  assert.equal(normalSpeech.isAmberActive, false);

  // High gain (~0.26 RMS) -> 9 segments (Amber threshold)
  const highGain = getActiveVUSegments(0.26);
  assert.ok(highGain.isAmberActive);

  // Clipping gain (>=0.30 RMS) -> 10 segments (Red threshold)
  const clippingGain = getActiveVUSegments(0.35);
  assert.equal(clippingGain.activeCount, 10);
  assert.equal(clippingGain.isRedActive, true);
});

test('evaluateDFAlertState - triggers Enemy Direction-Finding Alert after 20 seconds', () => {
  // Safe 5s transmission
  const safeTx = evaluateDFAlertState(5);
  assert.equal(safeTx.isAlertActive, false);
  assert.equal(safeTx.remainingSeconds, 15);

  // 19s transmission (1s remaining)
  const warningTx = evaluateDFAlertState(19);
  assert.equal(warningTx.isAlertActive, false);
  assert.equal(warningTx.remainingSeconds, 1);

  // 20s transmission (DF Alert triggered)
  const alertTx = evaluateDFAlertState(20);
  assert.equal(alertTx.isAlertActive, true);
  assert.equal(alertTx.remainingSeconds, 0);

  // 25s transmission (DF Alert active)
  const overTx = evaluateDFAlertState(25);
  assert.equal(overTx.isAlertActive, true);
  assert.equal(overTx.remainingSeconds, 0);
});
