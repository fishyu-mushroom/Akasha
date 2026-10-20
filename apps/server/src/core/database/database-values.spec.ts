import { BadRequestException } from '@nestjs/common';
import {
  normalizePropertyConfig,
  normalizePropertyPatch,
  normalizePropertyValue,
} from './database-values';

const options = {
  options: [
    { id: 'a', name: 'A' },
    { id: 'b', name: 'B' },
  ],
};
const prop = (type: string, config: unknown = {}) => ({
  id: 'p',
  type,
  config,
});

describe('normalizePropertyValue', () => {
  it.each([
    ['text', 'hello', 'hello'],
    ['number', 3.5, 3.5],
    ['checkbox', false, false],
    ['url', 'https://example.com', 'https://example.com'],
    ['date', { start: '2026-10-20' }, { start: '2026-10-20' }],
    [
      'date',
      { start: '2026-10-20', end: '2026-10-22' },
      { start: '2026-10-20', end: '2026-10-22' },
    ],
  ])('accepts %s value', (type, value, expected) => {
    expect(normalizePropertyValue(prop(type), value)).toEqual(expected);
  });

  it('validates select options and dedupes multi-select', () => {
    expect(normalizePropertyValue(prop('select', options), 'a')).toBe('a');
    expect(
      normalizePropertyValue(prop('multi_select', options), ['a', 'a', 'b']),
    ).toEqual(['a', 'b']);
    expect(normalizePropertyValue(prop('multi_select', options), [])).toBe(
      null,
    );
  });

  it('treats empty values as clearing', () => {
    expect(normalizePropertyValue(prop('text'), '')).toBeNull();
    expect(normalizePropertyValue(prop('number'), null)).toBeNull();
  });

  it.each([
    ['text', 1],
    ['number', '1'],
    ['number', Number.NaN],
    ['checkbox', 'true'],
    ['url', 'javascript:alert(1)'],
    ['select', 'missing'],
    ['multi_select', ['a', 'missing']],
    ['person', ['not-a-uuid']],
    ['date', { start: '20-10-2026' }],
    ['date', { start: '2026-10-22', end: '2026-10-20' }],
  ])('rejects invalid %s value %j', (type, value) => {
    expect(() => normalizePropertyValue(prop(type, options), value)).toThrow(
      BadRequestException,
    );
  });
});

describe('normalizePropertyPatch', () => {
  it('splits set and removed keys and rejects unknown properties', () => {
    const properties = [
      { id: 'title2', type: 'text', config: {} },
      { id: 'n', type: 'number', config: {} },
    ];
    expect(normalizePropertyPatch(properties, { title2: 'x', n: null })).toEqual(
      { set: { title2: 'x' }, removed: ['n'] },
    );
    expect(() => normalizePropertyPatch(properties, { other: 1 })).toThrow(
      BadRequestException,
    );
  });
});

describe('normalizePropertyConfig', () => {
  it('keeps option ids and defaults status groups', () => {
    expect(
      normalizePropertyConfig('status', {
        options: [{ id: 'x', name: 'X', group: 'weird' }],
      }),
    ).toEqual({ options: [{ id: 'x', name: 'X', group: 'todo' }] });
  });

  it('rejects duplicate option ids', () => {
    expect(() =>
      normalizePropertyConfig('select', {
        options: [
          { id: 'x', name: 'X' },
          { id: 'x', name: 'Y' },
        ],
      }),
    ).toThrow(BadRequestException);
  });

  it('drops options for non-option types', () => {
    expect(normalizePropertyConfig('text', options)).toEqual({});
  });
});
