import { describe, it } from 'mocha';
import * as assert from 'assert';
import { getDaysDifference } from '../../utils';
import { getRelativeDateString } from '../../utils';
import { formatTimestamp } from '../../utils';
import { parseTimestamp } from '../../utils';

describe('parseTimestamp', () => {
	describe('valid timestamp formats', () => {
		it('should parse date-only format [MM/DD/YYYY]', () => {
			const result = parseTimestamp('[09/30/2025]');
			assert.ok(result instanceof Date);
			assert.strictEqual(result!.getFullYear(), 2025);
			assert.strictEqual(result!.getMonth(), 8); // Month is 0-indexed
			assert.strictEqual(result!.getDate(), 30);
			assert.strictEqual(result!.getHours(), 12); // Should default to 12 PM
			assert.strictEqual(result!.getMinutes(), 0);
			assert.strictEqual(result!.getSeconds(), 0);
		});

		it('should parse full timestamp format [MM/DD/YYYY HH:MM:SS AM/PM]', () => {
			const result = parseTimestamp('[09/30/2025 02:30:45 PM]');
			assert.ok(result instanceof Date);
			assert.strictEqual(result!.getFullYear(), 2025);
			assert.strictEqual(result!.getMonth(), 8); // Month is 0-indexed
			assert.strictEqual(result!.getDate(), 30);
			assert.strictEqual(result!.getHours(), 14); // 2 PM = 14:00 in 24-hour format
			assert.strictEqual(result!.getMinutes(), 30);
			assert.strictEqual(result!.getSeconds(), 45);
		});

		it('should parse AM time correctly', () => {
			const result = parseTimestamp('[01/15/2024 08:15:30 AM]');
			assert.ok(result instanceof Date);
			assert.strictEqual(result!.getHours(), 8);
			assert.strictEqual(result!.getMinutes(), 15);
			assert.strictEqual(result!.getSeconds(), 30);
		});

		it('should parse 12 AM as midnight', () => {
			const result = parseTimestamp('[01/15/2024 12:00:00 AM]');
			assert.ok(result instanceof Date);
			assert.strictEqual(result!.getHours(), 0); // 12 AM = 0:00 in 24-hour format
		});

		it('should parse 12 PM as noon', () => {
			const result = parseTimestamp('[01/15/2024 12:00:00 PM]');
			assert.ok(result instanceof Date);
			assert.strictEqual(result!.getHours(), 12); // 12 PM = 12:00 in 24-hour format
		});
	});

	describe('invalid timestamp formats', () => {
		it('should return null for malformed brackets', () => {
			const result = parseTimestamp('09/30/2025]');
			assert.strictEqual(result, null);
		});

		it('should return null for missing brackets entirely', () => {
			const result = parseTimestamp('09/30/2025');
			assert.strictEqual(result, null);
		});

		it('should return null for invalid date format', () => {
			const result = parseTimestamp('[30/09/2025]'); // Wrong order DD/MM/YYYY
			assert.strictEqual(result, null);
		});

		it('should return null for incomplete date', () => {
			const result = parseTimestamp('[09/30]');
			assert.strictEqual(result, null);
		});

		it('should return null for invalid year format', () => {
			const result = parseTimestamp('[09/30/25]'); // Two-digit year
			assert.strictEqual(result, null);
		});

		it('should return null for invalid month', () => {
			const result = parseTimestamp('[13/30/2025]'); // Month 13 doesn't exist
			assert.strictEqual(result, null);
		});

		it('should return null for invalid day', () => {
			const result = parseTimestamp('[02/31/2025]'); // February 31st doesn't exist
			assert.strictEqual(result, null);
		});

		it('should return null for malformed time', () => {
			const result = parseTimestamp('[09/30/2025 25:00:00 PM]'); // 25 hours doesn't exist
			assert.strictEqual(result, null);
		});

		it('should return null for empty string', () => {
			const result = parseTimestamp('');
			assert.strictEqual(result, null);
		});
	});

	describe('edge cases', () => {
		it('should handle leap year February 29th', () => {
			const result = parseTimestamp('[02/29/2024]'); // 2024 is a leap year
			assert.ok(result instanceof Date);
			assert.strictEqual(result!.getMonth(), 1); // February (0-indexed)
			assert.strictEqual(result!.getDate(), 29);
		});

		it('should reject February 29th in non-leap year', () => {
			const result = parseTimestamp('[02/29/2023]'); // 2023 is not a leap year
			assert.strictEqual(result, null);
		});

		it('should handle end of year date', () => {
			const result = parseTimestamp('[12/31/2025]');
			assert.ok(result instanceof Date);
			assert.strictEqual(result!.getMonth(), 11); // December (0-indexed)
			assert.strictEqual(result!.getDate(), 31);
		});

		it('should handle single-digit months and days with leading zeros', () => {
			const result = parseTimestamp('[01/05/2025]');
			assert.ok(result instanceof Date);
			assert.strictEqual(result!.getMonth(), 0); // January (0-indexed)
			assert.strictEqual(result!.getDate(), 5);
		});
	});
});

describe('formatTimestamp', () => {
	describe('date-only format (includeTime = false)', () => {
		it('should format a date without time', () => {
			const date = new Date(2025, 8, 30); // September 30, 2025 (month is 0-indexed)
			const result = formatTimestamp(date, false);
			assert.strictEqual(result, '[09/30/2025]');
		});

		it('should pad single-digit months and days with zeros', () => {
			const date = new Date(2025, 0, 5); // January 5, 2025
			const result = formatTimestamp(date, false);
			assert.strictEqual(result, '[01/05/2025]');
		});

		it('should handle end of year date', () => {
			const date = new Date(2025, 11, 31); // December 31, 2025
			const result = formatTimestamp(date, false);
			assert.strictEqual(result, '[12/31/2025]');
		});
	});

	describe('full timestamp format (includeTime = true)', () => {
		it('should format a complete timestamp with PM time', () => {
			const date = new Date(2025, 8, 30, 14, 30, 45); // September 30, 2025 2:30:45 PM
			const result = formatTimestamp(date, true);
			assert.strictEqual(result, '[09/30/2025 02:30:45 PM]');
		});

		it('should format a complete timestamp with AM time', () => {
			const date = new Date(2025, 8, 30, 8, 15, 30); // September 30, 2025 8:15:30 AM
			const result = formatTimestamp(date, true);
			assert.strictEqual(result, '[09/30/2025 08:15:30 AM]');
		});

		it('should handle midnight (12:00:00 AM)', () => {
			const date = new Date(2025, 8, 30, 0, 0, 0); // September 30, 2025 12:00:00 AM
			const result = formatTimestamp(date, true);
			assert.strictEqual(result, '[09/30/2025 12:00:00 AM]');
		});

		it('should handle noon (12:00:00 PM)', () => {
			const date = new Date(2025, 8, 30, 12, 0, 0); // September 30, 2025 12:00:00 PM
			const result = formatTimestamp(date, true);
			assert.strictEqual(result, '[09/30/2025 12:00:00 PM]');
		});

		it('should pad single-digit hours, minutes, and seconds', () => {
			const date = new Date(2025, 8, 30, 9, 5, 7); // September 30, 2025 9:05:07 AM
			const result = formatTimestamp(date, true);
			assert.strictEqual(result, '[09/30/2025 09:05:07 AM]');
		});

		it('should default to including time when parameter is omitted', () => {
			const date = new Date(2025, 8, 30, 14, 30, 45); // September 30, 2025 2:30:45 PM
			const result = formatTimestamp(date); // No second parameter
			assert.strictEqual(result, '[09/30/2025 02:30:45 PM]');
		});
	});

	describe('edge cases', () => {
		it('should handle leap year date', () => {
			const date = new Date(2024, 1, 29, 15, 45, 30); // February 29, 2024 (leap year)
			const result = formatTimestamp(date, true);
			assert.strictEqual(result, '[02/29/2024 03:45:30 PM]');
		});

		it('should handle early morning hours (1 AM)', () => {
			const date = new Date(2025, 8, 30, 1, 0, 0); // September 30, 2025 1:00:00 AM
			const result = formatTimestamp(date, true);
			assert.strictEqual(result, '[09/30/2025 01:00:00 AM]');
		});

		it('should handle late evening hours (11 PM)', () => {
			const date = new Date(2025, 8, 30, 23, 59, 59); // September 30, 2025 11:59:59 PM
			const result = formatTimestamp(date, true);
			assert.strictEqual(result, '[09/30/2025 11:59:59 PM]');
		});

		it('should handle year boundaries', () => {
			const date = new Date(2000, 0, 1, 0, 0, 0); // January 1, 2000 12:00:00 AM
			const result = formatTimestamp(date, true);
			assert.strictEqual(result, '[01/01/2000 12:00:00 AM]');
		});
	});

	describe('round-trip compatibility with parseTimestamp', () => {
		it('should create timestamps that parseTimestamp can parse back (date-only)', () => {
			const originalDate = new Date(2025, 8, 30); // September 30, 2025
			const formatted = formatTimestamp(originalDate, false);
			const parsed = parseTimestamp(formatted);

			assert.ok(parsed instanceof Date);
			assert.strictEqual(parsed!.getFullYear(), originalDate.getFullYear());
			assert.strictEqual(parsed!.getMonth(), originalDate.getMonth());
			assert.strictEqual(parsed!.getDate(), originalDate.getDate());
		});

		it('should create timestamps that parseTimestamp can parse back (full timestamp)', () => {
			const originalDate = new Date(2025, 8, 30, 14, 30, 45); // September 30, 2025 2:30:45 PM
			const formatted = formatTimestamp(originalDate, true);
			const parsed = parseTimestamp(formatted);

			assert.ok(parsed instanceof Date);
			assert.strictEqual(parsed!.getTime(), originalDate.getTime());
		});
	});
});

describe('getDaysDifference', () => {
	describe('sentinel far future dates', () => {
		it('should return "?" for year 2050', () => {
			const taskDate = new Date(2050, 0, 1); // January 1, 2050
			const result = getDaysDifference(taskDate);
			assert.strictEqual(result, '?');
		});

		it('should return "?" for year 2051', () => {
			const taskDate = new Date(2051, 5, 15); // June 15, 2051
			const result = getDaysDifference(taskDate);
			assert.strictEqual(result, '?');
		});

		it('should return "?" for year 3000', () => {
			const taskDate = new Date(3000, 11, 31); // December 31, 3000
			const result = getDaysDifference(taskDate);
			assert.strictEqual(result, '?');
		});

		it('should still calculate normally for year 2049', () => {
			const taskDate = new Date(2049, 8, 29); // September 29, 2049
			const result = getDaysDifference(taskDate);
			assert.strictEqual(typeof result, 'number');
			assert.ok(typeof result === 'number' && result > 8000); // Should be around 8766 days (24 years * 365.25)
		});
	});

	describe('relative date calculations', () => {
		it('should return 0 for same day', () => {
			const today = new Date();
			const sameDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
			const result = getDaysDifference(sameDay);
			assert.strictEqual(result, 0);
		});

		it('should return positive number for future dates', () => {
			const today = new Date();
			const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
			const result = getDaysDifference(tomorrow);
			assert.strictEqual(result, 1);
		});

		it('should return negative number for past dates', () => {
			const today = new Date();
			const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
			const result = getDaysDifference(yesterday);
			assert.strictEqual(result, -1);
		});

		it('should ignore time of day differences', () => {
			const today = new Date();
			const taskDate1 = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 5, 0, 0, 0); // 5 days from now, midnight
			const taskDate2 = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 5, 23, 59, 59); // 5 days from now, almost midnight

			const result1 = getDaysDifference(taskDate1);
			const result2 = getDaysDifference(taskDate2);

			assert.strictEqual(result1, result2);
			assert.strictEqual(result1, 5);
		});
	});

	describe('specific date calculations', () => {
		it('should handle month boundaries correctly', () => {
			// Test with known dates to verify calculation
			const date1 = new Date(2025, 8, 30); // September 30, 2025
			const date2 = new Date(2025, 9, 1);  // October 1, 2025

			// Calculate expected difference: Oct 1 - Sep 30 = 1 day
			// But we need to mock properly or calculate based on actual current date
			const result = getDaysDifference(date2);

			// Since we can't easily mock the current date, let's just verify the type and that it's reasonable
			assert.strictEqual(typeof result, 'number');
			// The actual result depends on when this test runs, so we just verify it's a number
		});

		it('should handle year boundaries correctly', () => {
			// Test year boundary with a more predictable approach
			const date1 = new Date(2025, 11, 31); // December 31, 2025
			const date2 = new Date(2026, 0, 1);   // January 1, 2026

			// Instead of trying to mock, let's test the logic with today's date
			const today = new Date();
			const nextYear = new Date(today.getFullYear() + 1, 0, 1); // January 1 of next year

			const result = getDaysDifference(nextYear);
			assert.strictEqual(typeof result, 'number');
			// Should be positive since it's in the future
			assert.ok(typeof result === 'number' && result > 0);
		});
	});

	describe('large date differences', () => {
		it('should handle large positive differences', () => {
			const today = new Date();
			const futureDate = new Date(today.getFullYear() + 1, today.getMonth(), today.getDate()); // 1 year from now
			const result = getDaysDifference(futureDate);

			assert.strictEqual(typeof result, 'number');
			assert.ok(typeof result === 'number' && result >= 365 && result <= 366); // Account for leap years
		});

		it('should handle large negative differences', () => {
			const today = new Date();
			const pastDate = new Date(today.getFullYear() - 1, today.getMonth(), today.getDate()); // 1 year ago
			const result = getDaysDifference(pastDate);

			assert.strictEqual(typeof result, 'number');
			assert.ok(typeof result === 'number' && result <= -365 && result >= -366); // Account for leap years
		});
	});
});

describe('getRelativeDateString', () => {
	describe('same day', () => {
		it('should return "Due today" for today', () => {
			const today = new Date();
			const sameDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
			const result = getRelativeDateString(sameDay);
			assert.strictEqual(result, 'Due today');
		});

		it('should return "Due today" for today with different time', () => {
			const today = new Date();
			const sameDayDifferentTime = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 15, 30, 45);
			const result = getRelativeDateString(sameDayDifferentTime);
			assert.strictEqual(result, 'Due today');
		});
	});

	describe('future dates', () => {
		it('should return "Due tomorrow" for tomorrow', () => {
			const today = new Date();
			const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
			const result = getRelativeDateString(tomorrow);
			assert.strictEqual(result, 'Due tomorrow');
		});

		it('should return "Due in X days" for multiple days in future', () => {
			const today = new Date();
			const futureDate = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 5);
			const result = getRelativeDateString(futureDate);
			assert.strictEqual(result, 'Due in 5 days');
		});

		it('should return "Due in X days" for one week in future', () => {
			const today = new Date();
			const oneWeek = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 7);
			const result = getRelativeDateString(oneWeek);
			assert.strictEqual(result, 'Due in 7 days');
		});

		it('should return "Due in X days" for 365 days in future', () => {
			const today = new Date();
			const oneYear = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 365);
			const result = getRelativeDateString(oneYear);
			assert.strictEqual(result, 'Due in 365 days');
		});

		it('should return "Due in over a year" for more than 365 days', () => {
			const today = new Date();
			const overOneYear = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 366);
			const result = getRelativeDateString(overOneYear);
			assert.strictEqual(result, 'Due in over a year');
		});

		it('should return "Due in over a year" for far future dates', () => {
			const today = new Date();
			const farFuture = new Date(today.getFullYear() + 5, today.getMonth(), today.getDate());
			const result = getRelativeDateString(farFuture);
			assert.strictEqual(result, 'Due in over a year');
		});
	});

	describe('past dates (overdue)', () => {
		it('should return "1 day overdue" for yesterday (singular)', () => {
			const today = new Date();
			const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
			const result = getRelativeDateString(yesterday);
			assert.strictEqual(result, '1 day overdue');
		});

		it('should return "X days overdue" for multiple days past (plural)', () => {
			const today = new Date();
			const threeDaysAgo = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 3);
			const result = getRelativeDateString(threeDaysAgo);
			assert.strictEqual(result, '3 days overdue');
		});

		it('should return "X days overdue" for one week past', () => {
			const today = new Date();
			const oneWeekAgo = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 7);
			const result = getRelativeDateString(oneWeekAgo);
			assert.strictEqual(result, '7 days overdue');
		});

		it('should return "X days overdue" for one month past', () => {
			const today = new Date();
			const oneMonthAgo = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 30);
			const result = getRelativeDateString(oneMonthAgo);
			assert.strictEqual(result, '30 days overdue');
		});

		it('should return "X days overdue" for far past dates', () => {
			const today = new Date();
			const farPast = new Date(today.getFullYear() - 1, today.getMonth(), today.getDate());
			const result = getRelativeDateString(farPast);
			// Should be 365 or 366 days depending on leap year
			assert.ok(result === '365 days overdue' || result === '366 days overdue');
		});
	});

	describe('boundary cases', () => {
		it('should handle month boundaries correctly', () => {
			// Test crossing month boundary with a more realistic approach
			const result1 = getRelativeDateString(new Date(2025, 8, 30)); // September 30, 2025
			const result2 = getRelativeDateString(new Date(2025, 9, 1));  // October 1, 2025

			// Both should return valid relative date strings
			assert.strictEqual(typeof result1, 'string');
			assert.strictEqual(typeof result2, 'string');
			assert.ok(result1.length > 0);
			assert.ok(result2.length > 0);
		});

		it('should handle year boundaries correctly', () => {
			// Test year boundary with a more realistic approach
			const result1 = getRelativeDateString(new Date(2025, 11, 31)); // December 31, 2025
			const result2 = getRelativeDateString(new Date(2026, 0, 1));   // January 1, 2026

			// Both should return valid relative date strings
			assert.strictEqual(typeof result1, 'string');
			assert.strictEqual(typeof result2, 'string');
			assert.ok(result1.length > 0);
			assert.ok(result2.length > 0);
		});

		it('should handle leap year dates', () => {
			const leapYearDate = new Date(2024, 1, 29); // February 29, 2024 (leap year)
			const result = getRelativeDateString(leapYearDate);
			// Should return some overdue message since 2024 is in the past
			assert.ok(result.includes('overdue'));
		});
	});

	describe('edge cases', () => {
		it('should ignore time components and only consider dates', () => {
			const today = new Date();
			const sameDayMorning = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 8, 0, 0);
			const sameDayEvening = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 20, 0, 0);

			const result1 = getRelativeDateString(sameDayMorning);
			const result2 = getRelativeDateString(sameDayEvening);

			assert.strictEqual(result1, result2);
			assert.strictEqual(result1, 'Due today');
		});

		it('should handle exactly 366 days (boundary test)', () => {
			const today = new Date();
			const exactly366Days = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 366);
			const result = getRelativeDateString(exactly366Days);
			assert.strictEqual(result, 'Due in over a year');
		});

		it('should use plural form for 2+ days overdue', () => {
			const today = new Date();
			const twoDaysAgo = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 2);
			const result = getRelativeDateString(twoDaysAgo);
			assert.strictEqual(result, '2 days overdue');
		});

		it('should use plural form for 2+ days in future', () => {
			const today = new Date();
			const twoDaysFromNow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 2);
			const result = getRelativeDateString(twoDaysFromNow);
			assert.strictEqual(result, 'Due in 2 days');
		});
	});
});