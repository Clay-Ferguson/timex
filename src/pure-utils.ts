/**
 * Pure utility functions that don't depend on VS Code API.
 * These can be easily unit tested in a regular Node.js environment.
 */
import { PriorityTag } from './constants';

/**
 * Regular expression to match timestamp strings in the format [MM/DD/YYYY] or [MM/DD/YYYY HH:MM:SS AM/PM]
 */
export const TIMESTAMP_REGEX = /\[[0-9]{2}\/[0-9]{2}\/20[0-9]{2}(?:\s[0-9]{2}:[0-9]{2}:[0-9]{2}\s(?:AM|PM))?\]/;

/**
 * Parses a timestamp string into a Date object.
 * Supports formats: [MM/DD/YYYY] and [MM/DD/YYYY HH:MM:SS AM/PM]
 * @param timestampString The timestamp string to parse
 * @returns Date object or null if parsing failed
 */
export function parseTimestamp(timestampString: string): Date | null {
	try {
		// Validate that the timestamp is properly wrapped in brackets
		if (!timestampString.startsWith('[') || !timestampString.endsWith(']')) {
			return null;
		}

		const cleanTimestamp = timestampString.slice(1, -1); // Remove brackets from start and end
		const parts = cleanTimestamp.split(' ');
		const datePart = parts[0]; // MM/DD/YYYY
		let timePart = '12:00:00';
		let ampmPart = 'PM';
		if (parts.length === 3) {
			timePart = parts[1];
			ampmPart = parts[2];
		}
		const comps = datePart.split('/');
		if (comps.length !== 3 || comps[2].length !== 4) {
			return null;
		}
		const month = comps[0];
		const day = comps[1];
		const year = comps[2];
		const dateString = `${month}/${day}/${year} ${timePart} ${ampmPart}`;
		const date = new Date(dateString);
		if (isNaN(date.getTime())) {
			return null;
		}

		// Validate that the parsed date actually matches the input components
		// JavaScript Date constructor can adjust invalid dates (e.g., Feb 31 → Mar 3)
		const parsedMonth = date.getMonth() + 1; // getMonth() is 0-indexed
		const parsedDay = date.getDate();
		const parsedYear = date.getFullYear();

		if (parsedMonth !== parseInt(month) ||
			parsedDay !== parseInt(day) ||
			parsedYear !== parseInt(year)) {
			return null;
		}

		return date;
	} catch (error) {
		console.error(`Error parsing timestamp ${timestampString}:`, error);
		return null;
	}
}

/**
 * Formats a Date object into the extension's timestamp string.
 * @param date Source date to format
 * @param includeTime When true, include HH:MM:SS AM/PM; otherwise output date-only format
 */
export function formatTimestamp(date: Date, includeTime: boolean = true): string {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, '0');
	const day = String(date.getDate()).padStart(2, '0');

	if (!includeTime) {
		return `[${month}/${day}/${year}]`;
	}

	const hours12 = date.getHours() % 12 || 12;
	const minutes = String(date.getMinutes()).padStart(2, '0');
	const seconds = String(date.getSeconds()).padStart(2, '0');
	const ampm = date.getHours() >= 12 ? 'PM' : 'AM';
	return `[${month}/${day}/${year} ${String(hours12).padStart(2, '0')}:${minutes}:${seconds} ${ampm}]`;
}

/**
 * Returns a friendly relative date description for a task due date.
 */
export function getRelativeDateString(taskDate: Date): string {
	const now = new Date();
	const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
	const taskDay = new Date(taskDate.getFullYear(), taskDate.getMonth(), taskDate.getDate());

	const diffMs = taskDay.getTime() - today.getTime();
	const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

	if (diffDays < 0) {
		const overdueDays = Math.abs(diffDays);
		return overdueDays === 1 ? '1 day overdue' : `${overdueDays} days overdue`;
	} else if (diffDays === 0) {
		return 'Due today';
	} else if (diffDays === 1) {
		return 'Due tomorrow';
	} else if (diffDays > 365) {
		return 'Due in over a year';
	}

	return `Due in ${diffDays} days`;
}

/**
 * Calculates the number of days between today and the task date.
 * Returns '?' for sentinel far future dates.
 */
export function getDaysDifference(taskDate: Date): number | string {
	if (taskDate.getFullYear() >= 2050) {
		return '?';
	}

	const now = new Date();
	const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
	const taskDay = new Date(taskDate.getFullYear(), taskDate.getMonth(), taskDate.getDate());

	const diffMs = taskDay.getTime() - today.getTime();
	return Math.round(diffMs / (1000 * 60 * 60 * 24));
}

/**
 * Determines whether a task date is more than a year in the future.
 */
export function isFarFuture(taskDate: Date): boolean {
	const now = new Date();
	const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
	const taskDay = new Date(taskDate.getFullYear(), taskDate.getMonth(), taskDate.getDate());

	const diffMs = taskDay.getTime() - today.getTime();
	const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

	return diffDays > 365;
}

/**
 * Determines the emoji icon to display for a task file based on its properties.
 */
export function getIconForTaskFile(taskFile: {
	priority: PriorityTag.High | PriorityTag.Medium | PriorityTag.Low | '';
	tagsInFile: Set<string>;
}): string {
	const isTodo = taskFile.tagsInFile.has('#todo'); 

	let icon = '⚪';

	if (taskFile.tagsInFile.has('#note')) {
		icon = '📝';
	}

	if (isTodo) {
		if (taskFile.priority === PriorityTag.High) {
			icon = '🔴';
		} else if (taskFile.priority === PriorityTag.Medium) {
			icon = '🟠';
		} else if (taskFile.priority === PriorityTag.Low) {
			icon = '🔵';
		}
	}

	return icon;
}