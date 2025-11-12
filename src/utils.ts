import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { PriorityTag } from './constants';

/**
 * Regular expression to match timestamp strings in the format [MM/DD/YYYY] or [MM/DD/YYYY HH:MM:SS AM/PM]
 */
export const TIMESTAMP_REGEX = /\[[0-9]{2}\/[0-9]{2}\/20[0-9]{2}(?:\s[0-9]{2}:[0-9]{2}:[0-9]{2}\s(?:AM|PM))?\]/;

export const DEFAULT_INCLUDE_GLOBS = ['**/*.md'] as const;

export const DEFAULT_EXCLUDE_GLOBS = [
	'**/node_modules/**',
	'**/.git/**',
	'**/.vscode/**',
	'**/out/**',
	'**/dist/**',
	'**/build/**',
	'**/.next/**',
	'**/target/**'
] as const;

function normalizeGlobList(globs: readonly string[]): string[] {
	return globs
		.map(glob => glob.trim())
		.filter(glob => glob.length > 0);
}

function buildGlobPattern(normalizedGlobs: string[], fallback: string | undefined, wrapSingleInBraces: boolean): string | undefined {
	if (normalizedGlobs.length === 0) {
		return fallback;
	}

	if (normalizedGlobs.length === 1) {
		return wrapSingleInBraces
			? `{${normalizedGlobs[0]}}`
			: normalizedGlobs[0];
	}

	return `{${normalizedGlobs.join(',')}}`;
}

export function getIncludeGlobPattern(): string {
	const config = vscode.workspace.getConfiguration('timex');
	const configuredIncludeGlobs = config.get<string[]>('includeGlobs', Array.from(DEFAULT_INCLUDE_GLOBS));
	const normalizedIncludeGlobs = normalizeGlobList(configuredIncludeGlobs);
	return buildGlobPattern(normalizedIncludeGlobs, DEFAULT_INCLUDE_GLOBS[0], false)!;
}

export function getExcludeGlobPattern(): string | undefined {
	const config = vscode.workspace.getConfiguration('timex');
	const configuredExcludeGlobs = config.get<string[]>('excludeGlobs', Array.from(DEFAULT_EXCLUDE_GLOBS));
	const normalizedExcludeGlobs = normalizeGlobList(configuredExcludeGlobs);
	return buildGlobPattern(normalizedExcludeGlobs, undefined, true);
}

/**
 * DEPRECATED: Finds a folder in the workspace root that matches a wildcard pattern.
 * This function is no longer used since newTaskFolder now supports absolute paths.
 * The wildcard is assumed to be a leading asterisk representing a numeric prefix.
 * @param workspaceRoot The workspace root path
 * @param wildcardPattern The pattern like "*My Tasks"
 * @returns The actual folder name if found, or null if not found
 */
/* Commented out - no longer used with absolute path support
export function findFolderByWildcard(workspaceRoot: string, wildcardPattern: string): string | null {
	if (!wildcardPattern.startsWith('*')) {
		return wildcardPattern; // No wildcard, return as-is
	}

	const suffix = wildcardPattern.substring(1); // Remove the leading asterisk

	try {
		const entries = fs.readdirSync(workspaceRoot, { withFileTypes: true });

		for (const entry of entries) {
			if (entry.isDirectory() && entry.name.endsWith(suffix)) {
				return entry.name;
			}
		}
	} catch (error) {
		console.error('Error scanning workspace root for wildcard folder:', error);
	}

	return null; // No matching folder found
}
*/

/**
 * Reads all configured task hashtags from workspace settings.
 */
export function getAllConfiguredHashtags(): string[] {
	const config = vscode.workspace.getConfiguration('timex');
	const hashtagsConfig = config.get('hashtags', ['#todo', '#note']);
	
	// Handle both old string format and new array format for backward compatibility
	let hashtags: string[];
	if (Array.isArray(hashtagsConfig)) {
		hashtags = hashtagsConfig;
	} else if (typeof hashtagsConfig === 'string') {
		// Legacy format: comma-delimited string
		hashtags = (hashtagsConfig as string).split(',').map((tag: string) => tag.trim()).filter((tag: string) => tag.length > 0);
	} else {
		hashtags = ['#todo', '#note'];
	}
	
	return hashtags.map(tag => tag.trim()).filter(tag => tag.length > 0);
}

/**
 * Returns true if the provided content contains any configured hashtag.
 */
export function containsAnyConfiguredHashtag(content: string): boolean {
	const allHashtags = getAllConfiguredHashtags();
	return allHashtags.some(hashtag => content.includes(hashtag));
}

/**
 * Finds all configured hashtags present in the given content.
 */
export function findHashtagsInContent(content: string): Set<string> {
	const configuredHashtags = getAllConfiguredHashtags();
	const foundHashtags = new Set<string>();

	for (const hashtag of configuredHashtags) {
		if (content.includes(hashtag)) {
			foundHashtags.add(hashtag);
		}
	}

	return foundHashtags;
}

/**
 * Interface representing a numbered file or folder
 */
export interface NumberedItem {
	originalName: string;
	nameWithoutPrefix: string;
	isDirectory: boolean;
	fullPath: string;
}

/**
 * Regular expression to match files/folders that start with digits followed by underscore
 */
const NUMBERED_ITEM_REGEX = /^(\d+)_(.*)$/;

/**
 * Scans the workspace root for files and folders that have numeric prefixes followed by underscore
 * @param workspaceRoot The workspace root directory path
 * @returns Array of NumberedItem objects sorted by current numeric order (preserves existing sequence)
 */
export function scanForNumberedItems(workspaceRoot: string): NumberedItem[] {
	try {
		const entries = fs.readdirSync(workspaceRoot, { withFileTypes: true });
		const numberedItems: NumberedItem[] = [];

		for (const entry of entries) {
			// Skip hidden files/folders (starting with . or _)
			if (entry.name.startsWith('.') || entry.name.startsWith('_')) {
				continue;
			}

			const match = entry.name.match(NUMBERED_ITEM_REGEX);
			if (match) {
				const nameWithoutPrefix = match[2];
				numberedItems.push({
					originalName: entry.name,
					nameWithoutPrefix,
					isDirectory: entry.isDirectory(),
					fullPath: path.join(workspaceRoot, entry.name)
				});
			}
		}

		// Sort by current numeric prefix to preserve existing order, not alphabetically
		numberedItems.sort((a, b) => {
			const aPrefix = parseInt(a.originalName.match(/^(\d+)_/)![1]);
			const bPrefix = parseInt(b.originalName.match(/^(\d+)_/)![1]);
			return aPrefix - bPrefix;
		});

		return numberedItems;
	} catch (error) {
		console.error('Error scanning for numbered items:', error);
		throw new Error(`Failed to scan workspace root: ${error}`);
	}
}

/**
 * Generates a new 5-digit numeric prefix with underscore
 * @param ordinal The ordinal number (10, 20, 30, etc.)
 * @returns Formatted prefix like "00010_"
 */
export function generateNumberPrefix(ordinal: number): string {
	return String(ordinal).padStart(5, '0') + '_';
}

/**
 * Verifies that all file names (after the ordinal prefix) are unique
 * @param numberedItems Array of NumberedItem objects to check
 * @returns Error message if duplicates found, null if all unique
 */
export function verifyNamesAreUnique(numberedItems: NumberedItem[]): string | null {
	const namesSeen = new Map<string, string[]>(); // nameWithoutPrefix -> list of original full names
	
	for (const item of numberedItems) {
		const nameKey = item.nameWithoutPrefix.toLowerCase(); // Case-insensitive comparison
		
		if (!namesSeen.has(nameKey)) {
			namesSeen.set(nameKey, []);
		}
		namesSeen.get(nameKey)!.push(item.originalName);
	}
	
	// Find any duplicates
	const duplicates: string[] = [];
	for (const [nameKey, originalNames] of namesSeen.entries()) {
		if (originalNames.length > 1) {
			duplicates.push(`"${nameKey}" found in: ${originalNames.join(', ')}`);
		}
	}
	
	if (duplicates.length > 0) {
		return `Duplicate file names detected (ignoring ordinal prefixes):\n${duplicates.join('\n')}\n\nPlease rename these files to have unique names before renumbering.`;
	}
	
	return null;
}

/**
 * Renames files and folders with new sequential numbering starting at 00010 and incrementing by 10
 * @param numberedItems Array of NumberedItem objects to rename
 * @returns Promise that resolves when all renames are complete
 */
export async function renumberItems(numberedItems: NumberedItem[]): Promise<void> {
	const renameOperations: Array<{ oldPath: string; newPath: string; oldName: string; newName: string }> = [];

	// First pass: prepare all rename operations, skipping files that don't need renaming
	for (let i = 0; i < numberedItems.length; i++) {
		const item = numberedItems[i];
		const newOrdinal = (i + 1) * 10; // Start at 10, increment by 10
		const newPrefix = generateNumberPrefix(newOrdinal);
		const newName = newPrefix + item.nameWithoutPrefix;

		// Skip if the file already has the correct name
		if (item.originalName === newName) {
			console.log(`Skipping ${item.originalName} (already has correct name)`);
			continue;
		}

		const newPath = path.join(path.dirname(item.fullPath), newName);

		renameOperations.push({
			oldPath: item.fullPath,
			newPath,
			oldName: item.originalName,
			newName
		});
	}

	// If no renames needed, inform the user
	if (renameOperations.length === 0) {
		console.log('All files already have correct numbering - no renames needed');
		return;
	}

	// Second pass: perform the renames
	const errors: Array<{ operation: any; error: any }> = [];
	
	for (const operation of renameOperations) {
		try {
			await fs.promises.rename(operation.oldPath, operation.newPath);
			console.log(`Renamed: ${operation.oldName} → ${operation.newName}`);
		} catch (error) {
			console.error(`Failed to rename ${operation.oldName}:`, error);
			errors.push({ operation, error });
		}
	}

	if (errors.length > 0) {
		const errorMessages = errors.map(e => `${e.operation.oldName}: ${e.error.message}`).join('\n');
		throw new Error(`Failed to rename ${errors.length} items:\n${errorMessages}`);
	}
}

/**
 * Extracts the ordinal number from a filename with ordinal prefix
 * @param filename The filename to parse (e.g., "00012_something.md")
 * @returns The ordinal number or null if not found
 */
export function extractOrdinalFromFilename(filename: string): number | null {
	const match = filename.match(NUMBERED_ITEM_REGEX);
	if (match) {
		return parseInt(match[1], 10);
	}
	return null;
}

/**
 * Generates the next ordinal filename after a given ordinal file
 * @param selectedFilePath The full path to the selected file with ordinal prefix
 * @returns Object containing the new filename and full path, or null if not an ordinal file
 */
export function generateNextOrdinalFilename(selectedFilePath: string): { filename: string; fullPath: string } | null {
	const filename = path.basename(selectedFilePath);
	const directory = path.dirname(selectedFilePath);
	
	const currentOrdinal = extractOrdinalFromFilename(filename);
	if (currentOrdinal === null) {
		return null;
	}
	
	const nextOrdinal = currentOrdinal + 1;
	const nextPrefix = generateNumberPrefix(nextOrdinal);
	const newFilename = `${nextPrefix}new.md`;
	const newFullPath = path.join(directory, newFilename);
	
	return {
		filename: newFilename,
		fullPath: newFullPath
	};
}

/**
 * Strips the ordinal prefix (e.g., "00010_") from a filename if present.
 * @param fileName The filename to process
 * @returns The filename without ordinal prefix
 */
export function stripOrdinalPrefix(fileName: string): string {
	const match = fileName.match(NUMBERED_ITEM_REGEX);
	return match ? match[2] : fileName;
}

/**
 * Set of common image file extensions
 */
const IMAGE_EXTENSIONS = new Set<string>([
	'.png',
	'.jpg',
	'.jpeg',
	'.gif',
	'.bmp',
	'.svg',
	'.webp',
	'.tif',
	'.tiff',
	'.avif'
]);

/**
 * Checks if a filename has an image extension
 * @param filename The filename to check
 * @returns True if the file has an image extension, false otherwise
 */
export function isImageFileName(filename: string): boolean {
	const ext = path.extname(filename).toLowerCase();
	return IMAGE_EXTENSIONS.has(ext);
}

/**
 * Generates a 128-bit hash (32 hex characters) of a file's contents
 * @param filePath The absolute path to the file
 * @returns A promise that resolves to the hash string in hexadecimal format
 */
export async function generateFileHash(filePath: string): Promise<string> {
	return new Promise((resolve, reject) => {
		try {
			const hash = crypto.createHash('sha256');
			const stream = fs.createReadStream(filePath);

			stream.on('data', (data) => {
				hash.update(data);
			});

			stream.on('end', () => {
				// Get full SHA-256 hash (64 hex chars) and truncate to 128 bits (32 hex chars)
				const fullHash = hash.digest('hex');
				const hash128 = fullHash.substring(0, 32);
				resolve(hash128);
			});

			stream.on('error', (error) => {
				reject(new Error(`Failed to read file for hashing: ${error.message}`));
			});
		} catch (error) {
			reject(error);
		}
	});
}

/**
 * Regular expression to match markdown links with TIMEX- pattern
 * Matches both regular links [text](url) and image links ![text](url)
 * Pattern matches files like: name.TIMEX-hash.ext
 * Allows empty brackets like ![]() or []()
 */
export const TIMEX_LINK_REGEX = /(!?\[([^\]]*)\]\(([^)]*\.TIMEX-[^)]+)\))/g;

/**
 * Extracts the hash from a TIMEX- filename
 * Expected format: name.TIMEX-hash.ext where hash is 32 hex characters
 * @param filename The filename or path to parse
 * @returns The hash string or null if not found
 */
export function extractHashFromTimexFilename(filename: string): string | null {
	// Match pattern: *.TIMEX-{32 hex chars}.ext
	const match = filename.match(/\.TIMEX-([a-f0-9]{32})\.[^.]+$/i);
	return match ? match[1].toLowerCase() : null;
}

/**
 * Interface for attachment file information
 */
export interface AttachmentInfo {
	hash: string;
	fullPath: string;
	filename: string;
}

/**
 * Builds an index of all TIMEX- attachment files in a directory tree
 * @param rootPath The root directory to scan
 * @param excludePattern Optional glob pattern for exclusions
 * @returns Promise resolving to a Map of hash -> AttachmentInfo
 */
export async function buildAttachmentIndex(rootPath: string, excludePattern?: string): Promise<Map<string, AttachmentInfo>> {
	const attachmentMap = new Map<string, AttachmentInfo>();
	
	// Use workspace.findFiles for efficient scanning
	// Pattern matches files like: name.TIMEX-hash.ext
	const pattern = new vscode.RelativePattern(rootPath, '**/*.TIMEX-*.*');
	const files = await vscode.workspace.findFiles(pattern, excludePattern);
	
	for (const fileUri of files) {
		const filePath = fileUri.fsPath;
		const filename = path.basename(filePath);
		const hash = extractHashFromTimexFilename(filename);
		
		if (hash) {
			attachmentMap.set(hash, {
				hash,
				fullPath: filePath,
				filename
			});
		}
	}
	
	return attachmentMap;
}/**
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

