// Unit tests for static/js/svg_batco_slider.js using Node native test runner (node --test)
import test from 'node:test';
import assert from 'node:assert/strict';
import { BatcoSvgSliderManager } from '../../static/js/svg_batco_slider.js';

test('BatcoSvgSliderManager - initializes with correct default properties', () => {
  const manager = new BatcoSvgSliderManager();
  assert.equal(manager.currentOffsetY, 0);
  assert.equal(manager.minOffsetY, -8.177);
  assert.equal(manager.maxOffsetY, 109.799);
  assert.equal(manager.rowStepHeight, 9.83);
  assert.equal(manager.isLoaded, false);
});

test('BatcoSvgSliderManager - stepRow clamps within bounds', () => {
  const manager = new BatcoSvgSliderManager();
  manager.minOffsetY = -10;
  manager.maxOffsetY = 50;
  manager.rowStepHeight = 20;

  // Step down (positive offset)
  manager.stepRow(1);
  assert.equal(manager.currentOffsetY, 20);

  // Step down twice more (exceeding max 50)
  manager.stepRow(1);
  manager.stepRow(1);
  assert.equal(manager.currentOffsetY, 50); // Clamped to maxOffsetY

  // Step up (negative offset)
  manager.stepRow(-1);
  assert.equal(manager.currentOffsetY, 30);

  // Step up repeatedly (exceeding min -10)
  manager.stepRow(-1);
  manager.stepRow(-1);
  manager.stepRow(-1);
  assert.equal(manager.currentOffsetY, -10); // Clamped to minOffsetY
});

test('BatcoSvgSliderManager - reset restores offset to zero', () => {
  const manager = new BatcoSvgSliderManager();
  manager.currentOffsetY = 45;
  manager.reset();
  assert.equal(manager.currentOffsetY, 0);
});
