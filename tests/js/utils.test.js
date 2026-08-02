// Unit tests for static/js/utils.js using Node native test runner (node --test)
import test from 'node:test';
import assert from 'node:assert/strict';
import { formatDTG } from '../../static/js/utils.js';

test('formatDTG - formats date into military DTG string format', () => {
  const d = new Date(Date.UTC(2026, 6, 31, 10, 32)); // 31 JUL 2026 10:32 UTC
  const dtg = formatDTG(d);
  
  // Verify format matches DTG pattern: e.g. "311032Z JUL 26" or timezone offset letter
  assert.match(dtg, /^\d{6}[A-Z] JUL 26$/);
});

test('formatDTG - includes valid day, month and 2-digit year', () => {
  const d = new Date('2026-12-15T08:05:00Z');
  const dtg = formatDTG(d);

  assert.ok(dtg.includes('DEC'));
  assert.ok(dtg.includes('26'));
  assert.ok(dtg.startsWith('15'));
});
