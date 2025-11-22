import * as vscode from 'vscode';
import * as path from 'path';
import { formatTimestamp, parseTimestamp, TIMESTAMP_REGEX, ws_read_file, ws_write_file } from './utils';
import { TaskProvider } from './model';

/**
 * Adds time to a task's timestamp
 * @param item The tree item containing the task
 * @param amount The amount to add (e.g., 1)
 * @param unit The unit of time ('day', 'week', 'month', 'year')
 * @param taskProvider The task provider instance to refresh after update
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