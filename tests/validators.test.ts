import { describe, it, expect } from 'vitest';
import {
    DISCORD_MESSAGE_MAX,
    ROLE_DESCRIPTION_MAX,
    USER_NOTE_MAX,
    isBoundedString,
    isNonEmptyString,
    isSnowflake
} from '../src/web/validators.js';

describe('isSnowflake', () => {
    it('accepts a 17-digit numeric string', () => {
        expect(isSnowflake('12345678901234567')).toBe(true);
    });

    it('accepts a 20-digit numeric string (upper bound)', () => {
        expect(isSnowflake('12345678901234567890')).toBe(true);
    });

    it('accepts a real-shaped Discord id', () => {
        expect(isSnowflake('123456789012345678')).toBe(true);
    });

    it('rejects 16 digits (under the lower bound)', () => {
        expect(isSnowflake('1234567890123456')).toBe(false);
    });

    it('rejects 21 digits (over the upper bound)', () => {
        expect(isSnowflake('123456789012345678901')).toBe(false);
    });

    it('rejects strings with non-digit characters', () => {
        expect(isSnowflake('abc456789012345678')).toBe(false);
        expect(isSnowflake('123 456789012345678')).toBe(false);
        expect(isSnowflake('12345678901234567.8')).toBe(false);
    });

    it('rejects an empty string', () => {
        expect(isSnowflake('')).toBe(false);
    });

    it('rejects non-string types', () => {
        // Numbers happen to look like snowflakes but the contract is a
        // string — coercing here would mask wrong-typed payloads.
        expect(isSnowflake(123456789012345678)).toBe(false);
        expect(isSnowflake(null)).toBe(false);
        expect(isSnowflake(undefined)).toBe(false);
        expect(isSnowflake({})).toBe(false);
        expect(isSnowflake([])).toBe(false);
    });

    it('rejects a snowflake with leading/trailing whitespace', () => {
        // We deliberately don't trim — the caller should have done so
        // before reaching the validator.
        expect(isSnowflake(' 123456789012345678')).toBe(false);
        expect(isSnowflake('123456789012345678 ')).toBe(false);
    });
});

describe('isNonEmptyString', () => {
    it('accepts a single character', () => {
        expect(isNonEmptyString('a')).toBe(true);
    });

    it('accepts a string with leading/trailing whitespace and content', () => {
        expect(isNonEmptyString('  hi  ')).toBe(true);
    });

    it('rejects an empty string', () => {
        expect(isNonEmptyString('')).toBe(false);
    });

    it('rejects whitespace-only strings', () => {
        expect(isNonEmptyString(' ')).toBe(false);
        expect(isNonEmptyString('\n\t  ')).toBe(false);
    });

    it('rejects non-string types', () => {
        expect(isNonEmptyString(0)).toBe(false);
        expect(isNonEmptyString(false)).toBe(false);
        expect(isNonEmptyString(null)).toBe(false);
        expect(isNonEmptyString(undefined)).toBe(false);
        expect(isNonEmptyString({})).toBe(false);
        expect(isNonEmptyString([1])).toBe(false);
    });
});

describe('isBoundedString', () => {
    it('accepts a non-empty string within the bound', () => {
        expect(isBoundedString('hello', 10)).toBe(true);
    });

    it('accepts a string exactly at maxLen', () => {
        expect(isBoundedString('hello', 5)).toBe(true);
    });

    it('rejects a string longer than maxLen', () => {
        expect(isBoundedString('hello!', 5)).toBe(false);
    });

    it('rejects a whitespace-only string even when within the bound', () => {
        // The trim check guards against payloads padded with spaces to
        // sneak past the length check.
        expect(isBoundedString('     ', 10)).toBe(false);
    });

    it('rejects a string padded past maxLen with whitespace', () => {
        // The pre-trim length is what counts — the comment in
        // validators.ts spells this out — so a runaway whitespace
        // paste cannot get through under the bound.
        expect(isBoundedString('hi' + ' '.repeat(20), 10)).toBe(false);
    });

    it('rejects empty string', () => {
        expect(isBoundedString('', 10)).toBe(false);
    });

    it('rejects non-string types', () => {
        expect(isBoundedString(null, 10)).toBe(false);
        expect(isBoundedString(undefined, 10)).toBe(false);
        expect(isBoundedString(42, 10)).toBe(false);
        expect(isBoundedString({}, 10)).toBe(false);
    });
});

describe('exported limits', () => {
    it('matches Discord\'s 2000-char content cap', () => {
        expect(DISCORD_MESSAGE_MAX).toBe(2000);
    });

    it('exposes a role description max', () => {
        expect(ROLE_DESCRIPTION_MAX).toBeGreaterThan(0);
    });

    it('exposes a user note max', () => {
        expect(USER_NOTE_MAX).toBeGreaterThan(0);
    });
});
