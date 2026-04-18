import {
  toBranchStartOfDay,
  toBranchEndOfDay,
  normalizeBusinessDateUTC,
  toBranchDateString,
  getBranchToday,
} from './timezone';

describe('timezone helpers — input format tolerance', () => {
  // The reported production bug: Reports.tsx forwards the UI date through
  // `new Date(value).toISOString()` which produces "YYYY-MM-DDT00:00:00.000Z".
  // The pre-fix helpers split on "-" and Number-coerced "DDT00:00:00.000Z" → NaN,
  // then threw. Inventory's try/catch swallowed the throw and returned all-zero
  // data. These tests prevent that regression.

  describe('toBranchStartOfDay', () => {
    it('YYYY-MM-DD and ISO-Z input produce identical Dates', () => {
      const a = toBranchStartOfDay('2026-04-18');
      const b = toBranchStartOfDay('2026-04-18T00:00:00.000Z');
      expect(b.getTime()).toBe(a.getTime());
    });

    it('ISO with offset still keys off the leading calendar date', () => {
      // The +05:00 instant is irrelevant — only "2026-04-18" should be used.
      const a = toBranchStartOfDay('2026-04-18');
      const b = toBranchStartOfDay('2026-04-18T05:00:00+05:00');
      expect(b.getTime()).toBe(a.getTime());
    });

    it('throws on garbage input', () => {
      expect(() => toBranchStartOfDay('not-a-date')).toThrow(/Invalid date string/);
      expect(() => toBranchStartOfDay('')).toThrow(/Invalid date string/);
      expect(() => toBranchStartOfDay('2026/04/18')).toThrow(/Invalid date string/);
    });
  });

  describe('toBranchEndOfDay', () => {
    it('YYYY-MM-DD and ISO-Z input produce identical Dates', () => {
      const a = toBranchEndOfDay('2026-04-18');
      const b = toBranchEndOfDay('2026-04-18T00:00:00.000Z');
      expect(b.getTime()).toBe(a.getTime());
    });

    it('end-of-day precedes next-day start-of-day by 1ms', () => {
      const end = toBranchEndOfDay('2026-04-18');
      const nextStart = toBranchStartOfDay('2026-04-19');
      expect(nextStart.getTime() - end.getTime()).toBe(1);
    });

    it('throws on garbage input', () => {
      expect(() => toBranchEndOfDay('not-a-date')).toThrow(/Invalid date string/);
    });
  });

  describe('normalizeBusinessDateUTC', () => {
    it('YYYY-MM-DD and ISO-Z input produce identical Dates', () => {
      const a = normalizeBusinessDateUTC('2026-04-18');
      const b = normalizeBusinessDateUTC('2026-04-18T00:00:00.000Z');
      expect(b.getTime()).toBe(a.getTime());
    });

    it('returns UTC midnight regardless of input timezone suffix', () => {
      const d = normalizeBusinessDateUTC('2026-04-18T18:30:00.000Z');
      expect(d.toISOString()).toBe('2026-04-18T00:00:00.000Z');
    });

    it('throws on garbage input', () => {
      expect(() => normalizeBusinessDateUTC('bad')).toThrow(/Invalid date string/);
    });
  });

  describe('round-trip with toBranchDateString / getBranchToday', () => {
    it('toBranchDateString(getBranchToday() → toBranchStartOfDay) yields todayʼs branch date', () => {
      const today = getBranchToday();
      const startOfDayUtc = toBranchStartOfDay(today);
      expect(toBranchDateString(startOfDayUtc)).toBe(today);
    });
  });
});
