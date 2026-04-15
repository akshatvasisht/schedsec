import { describe, it, expect } from 'vitest';
import { ConfidenceDecay } from '../../src/learning/decay.js';
import { PatternAnalyzer } from '../../src/learning/patterns.js';
import { RuleExtractor } from '../../src/learning/rule-extraction.js';

/**
 * Extended Learning * Regression tests for the learning sub-system.
 */

// ─── ConfidenceDecay ─────────────────────────────────────────────────────────

describe('ConfidenceDecay', () => {
  describe('decayPattern', () => {
    it('does not decay recently reinforced patterns', () => {
      const now = new Date('2026-02-26');
      const pattern = {
        confidence: 0.9,
        last_reinforced: '2026-02-20' // 6 days ago (< 1 month)
      };
      const result = ConfidenceDecay.decayPattern(pattern, now);
      expect(result.confidence).toBe(0.9); // unchanged
      expect(result.is_stale).toBe(false);
    });

    it('decays by 5% per month of inactivity', () => {
      const now = new Date('2026-05-26'); // 3 months later
      const pattern = {
        confidence: 0.8,
        last_reinforced: '2026-02-26'
      };
      const result = ConfidenceDecay.decayPattern(pattern, now);
      // 0.8 * 0.95^3 ≈ 0.686
      expect(result.confidence).toBeCloseTo(0.69, 1);
      expect(result.is_stale).toBe(false);
    });

    it('marks pattern as stale when below MIN_CONFIDENCE (0.3)', () => {
      const now = new Date('2028-02-26'); // 2 years later = 24 months
      const pattern = {
        confidence: 0.5,
        last_reinforced: '2026-02-26'
      };
      const result = ConfidenceDecay.decayPattern(pattern, now);
      // 0.5 * 0.95^24 ≈ 0.146
      expect(result.confidence).toBeLessThan(0.3);
      expect(result.is_stale).toBe(true);
    });

    it('applies compound decay correctly (1 month)', () => {
      const now = new Date('2026-03-28'); // ~1 month later
      const pattern = {
        confidence: 1.0,
        last_reinforced: '2026-02-26'
      };
      const result = ConfidenceDecay.decayPattern(pattern, now);
      // 1.0 * 0.95^1 = 0.95
      expect(result.confidence).toBeCloseTo(0.95, 2);
    });
  });

  describe('decayAll', () => {
    it('decays all patterns in a map', () => {
      const now = new Date('2026-05-26');
      const patterns = {
        meeting: { confidence: 0.9, last_reinforced: '2026-02-26' },
        email: { confidence: 0.8, last_reinforced: '2026-04-26' }
      };
      const result = ConfidenceDecay.decayAll(patterns, now);
      expect(result.meeting.confidence).toBeLessThan(0.9); // 3 months decay
      expect(result.email.confidence).toBeLessThan(0.8);   // 1 month decay
      // 3 months decays more than 1 month, but meeting started at 0.9 vs email at 0.8
      // meeting: 0.9 * 0.95^3 ≈ 0.77, email: 0.8 * 0.95^1 = 0.76
      // Both should simply be less than their originals
      expect(result.meeting.confidence).toBeGreaterThan(0);
      expect(result.email.confidence).toBeGreaterThan(0);
    });

    it('handles empty patterns object', () => {
      const result = ConfidenceDecay.decayAll({}, new Date('2026-06-01'));
      expect(Object.keys(result).length).toBe(0);
    });
  });
});

// ─── PatternAnalyzer ─────────────────────────────────────────────────────────

describe('PatternAnalyzer', () => {
  describe('extractPatterns', () => {
    const schedules = [
      {
        task_name: 'Standup',
        date: '2026-02-26', // February = month 1, season 0 (Winter)
        final_start: '09:00',
        ai_start: '09:00',
        ai_duration: 15,
        final_duration: 20,
        energy: 'Light'
      },
      {
        task_name: 'Standup',
        date: '2026-02-27',
        final_start: '09:30',
        ai_start: '09:00',
        ai_duration: 15,
        final_duration: 18,
        energy: 'Light'
      },
      {
        task_name: 'Deep Work',
        date: '2026-07-15', // July = month 6, season 2 (Summer)
        final_start: '10:00',
        ai_start: '10:00',
        ai_duration: 120,
        final_duration: 150,
        energy: 'Deep'
      }
    ];

    it('extracts time preference averages per task', () => {
      const result = PatternAnalyzer.extractPatterns(schedules);
      expect(result.time_prefs['Standup']).toBeDefined();
      // Average of hours 9 and 9 = 9 (09:00 and 09:30 both round to hour 9)
      expect(result.time_prefs['Standup']).toBe(9);
      expect(result.time_prefs['Deep Work']).toBe(10);
    });

    it('extracts duration ratios by energy level', () => {
      const result = PatternAnalyzer.extractPatterns(schedules);
      expect(result.duration_ratios['Light']).toBeDefined();
      // Standup: 20/15 ≈ 1.33 and 18/15 = 1.2, avg ≈ 1.27
      expect(result.duration_ratios['Light']).toBeGreaterThan(1.0);
      // Deep Work: 150/120 = 1.25
      expect(result.duration_ratios['Deep']).toBeCloseTo(1.25, 2);
    });

    it('groups tasks by season', () => {
      const result = PatternAnalyzer.extractPatterns(schedules);
      // Season 0 (Winter) should have 2 entries, Season 2 (Summer) should have 1
      expect(result.seasonal[0].length).toBe(2);
      expect(result.seasonal[2].length).toBe(1);
    });

    it('handles empty schedule array', () => {
      const result = PatternAnalyzer.extractPatterns([]);
      expect(result.time_prefs).toEqual({});
      expect(result.duration_ratios).toEqual({});
    });

    it('handles entries missing optional fields', () => {
      const sparse = [
        { task_name: 'Quick task', date: '2026-03-01', ai_start: '14:00', energy: 'Moderate' }
        // No final_start, no final_duration, no ai_duration
      ];
      const result = PatternAnalyzer.extractPatterns(sparse);
      expect(result.time_prefs).toEqual({}); // no final_start = no time pref
      expect(result.duration_ratios).toEqual({}); // no durations = no ratios
    });
  });
});

// ─── RuleExtractor ───────────────────────────────────────────────────────────

describe('RuleExtractor', () => {
  describe('identifyEdits', () => {
    it('flags implausible duration changes (> 3x)', () => {
      const ai = [{ task_id: 't1', task_name: 'Test', start: '09:00', duration: 15 }];
      const final = [{ task_id: 't1', task_name: 'Test', start: '09:00', duration: 60 }]; // 4x
      const edits = RuleExtractor.identifyEdits(ai, final);
      expect(edits.length).toBe(1);
      expect(edits[0].flagged).toBe('implausible');
    });

    it('flags implausible duration changes (< 0.2x)', () => {
      const ai = [{ task_id: 't1', task_name: 'Test', start: '09:00', duration: 60 }];
      const final = [{ task_id: 't1', task_name: 'Test', start: '09:00', duration: 10 }]; // 0.16x
      const edits = RuleExtractor.identifyEdits(ai, final);
      expect(edits[0].flagged).toBe('implausible');
    });

    it('does not flag normal duration changes', () => {
      const ai = [{ task_id: 't1', task_name: 'Test', start: '09:00', duration: 60 }];
      const final = [{ task_id: 't1', task_name: 'Test', start: '09:00', duration: 90 }]; // 1.5x
      const edits = RuleExtractor.identifyEdits(ai, final);
      expect(edits[0].flagged).toBeUndefined();
    });
  });

  describe('shouldSkipForLearning', () => {
    it('skips implausible edits', () => {
      expect(RuleExtractor.shouldSkipForLearning({ flagged: 'implausible' })).toBe(true);
    });

    it('skips correction-flagged entries', () => {
      expect(RuleExtractor.shouldSkipForLearning({ task: 'Test' }, { correction_flag: true })).toBe(true);
    });

    it('skips non-preference skip reasons', () => {
      const nonPref = ['External Blocker'];
      expect(RuleExtractor.shouldSkipForLearning({ task: 'Test' }, { skip_reason: 'External Blocker' }, nonPref)).toBe(true);
    });

    it('does not skip valid edits', () => {
      expect(RuleExtractor.shouldSkipForLearning({ type: 'DURATION', flagged: undefined }, { skip_reason: 'Completed Earlier' }, ['External Blocker'])).toBe(false);
    });
  });
});
