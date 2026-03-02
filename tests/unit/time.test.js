import { describe, it, expect } from 'vitest';
import { timeToMinutes, minutesToTime, addMinutes } from '../../src/utils/time.js';

describe('Time Utilities', () => {
  it('converts HH:MM to minutes', () => {
    expect(timeToMinutes('09:00')).toBe(540);
    expect(timeToMinutes('17:30')).toBe(1050);
  });

  it('converts minutes to HH:MM', () => {
    expect(minutesToTime(540)).toBe('09:00');
    expect(minutesToTime(1050)).toBe('17:30');
  });

  it('adds minutes to time string', () => {
    expect(addMinutes('09:00', 30)).toBe('09:30');
    expect(addMinutes('23:45', 30)).toBe('00:15');
  });

  it('handles negative minutes normalization', () => {
    expect(minutesToTime(-30)).toBe('23:30');
  });
});
