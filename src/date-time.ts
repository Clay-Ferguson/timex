import * as vscode from 'vscode';
import * as path from 'path';
import { formatTimestamp, parseTimestamp, TIMESTAMP_REGEX } from './utils';
import { ws_write_file } from './ws-file-util';
import { ws_read_file } from './ws-file-util';
import { TaskProvider } from './task-model';

/**
 * Adds a specified amount of time to a task's existing timestamp.
 * 
 * This function reads the task file, finds its timestamp, adds the specified
 * time duration, and writes the updated timestamp back to the file. It preserves
 * the original timestamp format (date-only vs full datetime with time).
 * 
 * The function performs a targeted update of only the affected task in the tree view
 * rather than triggering a full workspace rescan for better performance.
 * 
 * @param item - The VS Code tree item representing the task. Must have a `resourceUri`
 *               property containing the file path.
 * @param amount - The numeric amount of time to add. Positive values move the date forward,
 *                 negative values (if supported) would move it backward.
 * @param unit - The unit of time to add: 'day', 'week' (7 days), 'month', or 'year'.
 * @param taskProvider - The TaskProvider instance used to update the tree view after
 *                       modifying the task file.
 * @returns A Promise that resolves when the operation completes. Shows an info message
 *          on success or an error message if the operation fails.
 * 
 * @example
 * // Add 1 week to a task's due date
 * await addTimeToTask(selectedItem, 1, 'week', taskProvider);
 * 
 * @example
 * // Add 2 months to a task's due date
 * await addTimeToTask(selectedItem, 2, 'month', taskProvider);
 */
export async function addTimeToTask(item: any, amount: number, unit: 'day' | 'week' | 'month' | 'year', taskProvider: TaskProvider): Promise<void> {
    if (!item || !item.resourceUri) {
        vscode.window.showErrorMessage('No task selected');
        return;
    }

    const filePath = item.resourceUri.fsPath;

    try {
        // Read the file content
        const content = await ws_read_file(filePath);

        // Find existing timestamp
        const timestampMatch = content.match(TIMESTAMP_REGEX);

        if (!timestampMatch) {
            vscode.window.showErrorMessage('No timestamp found in task file');
            return;
        }

        const currentTimestampString = timestampMatch[0];

        // Detect if the original timestamp was in long format (with time) or short format (date-only)
        const cleanTimestamp = currentTimestampString.replace(/[\[\]]/g, '');
        const isLongFormat = cleanTimestamp.includes(' ') && cleanTimestamp.includes(':');

        // Parse the current timestamp
        const parsedDate = parseTimestamp(currentTimestampString);
        if (!parsedDate) {
            vscode.window.showErrorMessage('Unable to parse timestamp');
            return;
        }

        // Add the specified amount of time
        const newDate = new Date(parsedDate);
        switch (unit) {
            case 'day':
                newDate.setDate(newDate.getDate() + amount);
                break;
            case 'week':
                newDate.setDate(newDate.getDate() + (amount * 7));
                break;
            case 'month':
                newDate.setMonth(newDate.getMonth() + amount);
                break;
            case 'year':
                newDate.setFullYear(newDate.getFullYear() + amount);
                break;
        }

        // Format the new timestamp based on original format
        const newTimestampString = formatTimestamp(newDate, isLongFormat);

        // Replace the timestamp in the file content
        const newContent = content.replace(currentTimestampString, newTimestampString);

        // Write the updated content back to the file
        await ws_write_file(filePath, newContent);

        // Update just this single task instead of refreshing the entire view
        await taskProvider.updateSingleTask(filePath, newTimestampString);

        vscode.window.showInformationMessage(`Added ${amount} ${unit}${amount > 1 ? 's' : ''} to task due date`);

    } catch (error) {
        vscode.window.showErrorMessage(`Failed to update task: ${error}`);
    }
}

/**
 * Inserts a full timestamp at the current cursor position in the active editor.
 * 
 * The timestamp is formatted in the long format: `[MM/DD/YYYY HH:MM:SS AM/PM]`
 * using the current date and time. This format is used by Timex for task
 * scheduling with specific times.
 * 
 * This function requires an active text editor. If no editor is open, it displays
 * an error message to the user.
 * 
 * @returns A Promise that resolves when the timestamp has been inserted.
 *          Shows an info message confirming the inserted timestamp,
 *          or an error message if no editor is active.
 * 
 * @example
 * // User invokes command, inserts: [12/09/2025 02:30:45 PM]
 * await insertTimestamp();
 */
export async function insertTimestamp() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showErrorMessage('No active editor found');
        return;
    }

    // Generate current timestamp in the required format
    const now = new Date();
    const timestamp = formatTimestamp(now);

    // Insert timestamp at cursor position
    const position = editor.selection.active;
    editor.edit(editBuilder => {
        editBuilder.insert(position, timestamp);
    });

    vscode.window.showInformationMessage(`Timestamp inserted: ${timestamp}`);
}

/**
 * Inserts a date-only timestamp at the current cursor position in the active editor.
 * 
 * The date is formatted in the short format: `[MM/DD/YYYY]` using the current date.
 * Unlike `insertTimestamp()`, this function does not include time information.
 * When Timex parses date-only timestamps, it assumes 12:00 PM on that day.
 * 
 * This format is useful for tasks where the specific time is not important,
 * only the due date matters.
 * 
 * This function requires an active text editor. If no editor is open, it displays
 * an error message to the user.
 * 
 * @returns A Promise that resolves when the date has been inserted.
 *          Shows an info message confirming the inserted date,
 *          or an error message if no editor is active.
 * 
 * @example
 * // User invokes command, inserts: [12/09/2025]
 * await insertDate();
 * 
 * @see insertTimestamp - For inserting full timestamps with time information
 */
export async function insertDate() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showErrorMessage('No active editor found');
        return;
    }

    // Generate current date (date-only format, no time)
    const now = new Date();
    const dateOnly = formatTimestamp(now, false); // false = short format (date only)

    // Insert date at cursor position
    const position = editor.selection.active;
    editor.edit(editBuilder => {
        editBuilder.insert(position, dateOnly);
    });

    vscode.window.showInformationMessage(`Date inserted: ${dateOnly}`);
}