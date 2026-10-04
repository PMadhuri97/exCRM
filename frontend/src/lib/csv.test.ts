import { describe, expect, it } from 'vitest';

import { csvCell, toCsv } from './csv';

describe('csv', () => {
  it('quotes every cell and doubles embedded quotes', () => {
    expect(csvCell('Acme "Global", Ltd')).toBe('"Acme ""Global"", Ltd"');
  });

  it('writes null and undefined as empty cells', () => {
    expect(csvCell(null)).toBe('""');
    expect(csvCell(undefined)).toBe('""');
  });

  it('defuses cells a spreadsheet would run as a formula', () => {
    for (const payload of ['=HYPERLINK("x")', '+1', '-2+3', '@SUM(A1)']) {
      expect(csvCell(payload)).toBe(`"'${payload.replace(/"/g, '""')}"`);
    }
  });

  it('joins rows with CRLF', () => {
    expect(toCsv([['a', 'b'], ['c', 'd']])).toBe('"a","b"\r\n"c","d"');
  });
});
