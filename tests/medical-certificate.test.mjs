import test from 'node:test';
import assert from 'node:assert/strict';
import { formatMedicalDate, MEDICAL_CERTIFICATE_STATUS } from '../src/lib/medicalCertificate.js';

test('medical certificate dates render without timezone shifts', () => {
  assert.equal(formatMedicalDate('2026-10-28'), '28/10/2026');
  assert.equal(formatMedicalDate('2027-01-01T00:00:00.000Z'), '01/01/2027');
  assert.equal(formatMedicalDate(null), 'Non indicata');
});

test('all medical statuses are present in profile', () => {
  assert.equal(MEDICAL_CERTIFICATE_STATUS.valid.label, 'Valido');
  assert.equal(MEDICAL_CERTIFICATE_STATUS.expiring.label, 'In scadenza');
  assert.equal(MEDICAL_CERTIFICATE_STATUS.expired.label, 'Scaduto');
  assert.equal(MEDICAL_CERTIFICATE_STATUS.pending.label, 'Da verificare');
});
