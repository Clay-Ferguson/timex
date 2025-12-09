import * as vscode from 'vscode';
import * as path from 'path';
import { formatTimestamp } from './utils';
import { ws_exists, ws_delete, ws_write_file, ws_rename } from './ws-file-util';
import { PriorityTag } from './constants';
import { TaskProvider } from './model';

/**
 * Creates a new task file in the workspace root directory.
 * 
 * This function guides the user through creating a new markdown task file:
 * 1. Prompts for a filename (validates for invalid characters)
 * 2. Automatically appends `.md` extension if not provided
 * 3. Warns if the file already exists (with option to overwrite)
 * 4. Generates task content with the current timestamp and default priority (#p3)
 * 5. Opens the newly created file in the editor
 * 6. Refreshes the task tree view to show the new task
 * 
 * The generated task content uses the primary hashtag from configuration.
 * If in "all-tags" mode, the first configured hashtag is used instead.
 * 
 * @param taskProvider - The TaskProvider instance used to get the primary hashtag
 *                       and refresh the task tree view after creation
 * @returns Promise that resolves when the task is created and opened,
 *          or when the user cancels the operation
 * 
 * @example
 * // The generated file content looks like:
 * // 
 * // 
 * // #todo [12/09/2025 02:30:00 PM] #p3
 */
export async function newTask(taskProvider: TaskProvider) {
    // Get the workspace folder
    if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
        vscode.window.showErrorMessage('No workspace folder found');
        return;
    }

    const workspaceFolder = vscode.workspace.workspaceFolders[0];
    const targetPath = workspaceFolder.uri.fsPath;

    // Prompt user for filename
    const userFileName = await vscode.window.showInputBox({
        placeHolder: 'Enter filename for new task',
        prompt: 'Filename (extension .md will be added automatically if not provided)',
        value: '',
        validateInput: (value) => {
            if (!value || value.trim() === '') {
                return 'Filename cannot be empty';
            }
            // Check for invalid filename characters (basic check)
            const invalidChars = /[<>:"/\\|?*]/g;
            if (invalidChars.test(value)) {
                return 'Filename contains invalid characters';
            }
            return null;
        }
    });

    if (!userFileName) {
        // User cancelled the input
        return;
    }

    // Process the filename
    let fileName = userFileName.trim();
    // Add .md extension if not already present (case insensitive)
    if (!fileName.toLowerCase().endsWith('.md')) {
        fileName += '.md';
    }

    let filePath = path.join(targetPath, fileName);

    // Check if file already exists
    if (await ws_exists(filePath)) {
        const overwrite = await vscode.window.showWarningMessage(
            `File "${fileName}" already exists. Do you want to overwrite it?`,
            { modal: true },
            'Overwrite',
            'Cancel'
        );

        if (overwrite !== 'Overwrite') {
            return;
        }
    }

    // Generate timestamp
    const now = new Date();
    const timestamp = formatTimestamp(now);

    // Create task content, with two blank lines because user will want to start editing at beginning of file.
    const primaryHashtag = taskProvider.getPrimaryHashtag();
    // If in "all-tags" mode, use the first configured hashtag instead of "all-tags"
    let hashtagToUse = primaryHashtag;
    if (primaryHashtag === 'all-tags') {
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
        hashtags = hashtags.map(tag => tag.trim()).filter(tag => tag.length > 0);

        hashtagToUse = hashtags.length > 0 ? hashtags[0] : '#todo'; // fallback to #todo if no hashtags configured
    }
    const taskContent = `\n\n${hashtagToUse} ${timestamp} #${PriorityTag.Low}`;

    try {
        // Write the file
        await ws_write_file(filePath, taskContent);

        // Open the file in the editor
        const fileUri = vscode.Uri.file(filePath);
        const document = await vscode.workspace.openTextDocument(fileUri);
        await vscode.window.showTextDocument(document);

        // Refresh the task view
        taskProvider.refresh();

        vscode.window.showInformationMessage(`New task created: ${fileName}`);
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to create task file: ${error}`);
    }
}

/**
 * Deletes a task file from the filesystem after user confirmation.
 * 
 * This function handles the deletion workflow:
 * 1. Validates that a task item with a valid resource URI is provided
 * 2. Shows a modal confirmation dialog to prevent accidental deletions
 * 3. Deletes the file from the filesystem if confirmed
 * 4. Refreshes the task tree view to remove the deleted item
 * 5. Shows appropriate success or error messages
 * 
 * @param item - The tree item representing the task to delete.
 *               Must have a `resourceUri` property containing the file path.
 *               This is typically a TaskFileItem from the task tree view.
 * @param taskProvider - The TaskProvider instance used to refresh the task
 *                       tree view after successful deletion
 * @returns Promise that resolves when the deletion is complete or cancelled
 * 
 * @throws Displays an error message if:
 *         - No task item is provided or item lacks resourceUri
 *         - File deletion fails (e.g., permission issues, file locked)
 */
export async function deleteTask(item: any, taskProvider: TaskProvider) {
    if (!item || !item.resourceUri) {
        vscode.window.showErrorMessage('No task selected');
        return;
    }
    const filePath = item.resourceUri.fsPath;
    const fileName = path.basename(filePath);

    // Show confirmation dialog
    const answer = await vscode.window.showWarningMessage(
        `Are you sure you want to delete the task file "${fileName}"?`,
        { modal: true },
        'Delete',
        'Cancel'
    );

    if (answer === 'Delete') {
        try {
            // Delete the file
            await ws_delete(filePath);

            // Refresh the task view to remove the deleted item
            taskProvider.refresh();

            vscode.window.showInformationMessage(`Task file "${fileName}" has been deleted.`);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to delete task file: ${error}`);
        }
    }
}

/**
 * Renames a task file to a new filename specified by the user.
 * 
 * This function handles the rename workflow:
 * 1. Validates that a task item with a valid resource URI is provided
 * 2. Shows an input dialog pre-filled with the current filename
 * 3. Validates the new filename for invalid characters
 * 4. Preserves the original file extension if none is provided
 * 5. Performs the rename operation in the same directory
 * 6. Queues the renamed file for reveal in the tree view
 * 7. Refreshes the task tree view to reflect the new name
 * 
 * The function handles edge cases:
 * - Empty or whitespace-only filenames are rejected
 * - Invalid filename characters (/ \ ? % * : | " < >) are rejected
 * - If user provides a name without extension, the original extension is preserved
 * - If the new name matches the old name, the operation is silently cancelled
 * - Files that already exist at the target path trigger an error message
 * 
 * @param item - The tree item representing the task to rename.
 *               Must have a `resourceUri` property containing the file path.
 *               This is typically a TaskFileItem from the task tree view.
 * @param taskProvider - The TaskProvider instance used to queue the reveal
 *                       operation and refresh the task tree view after renaming
 * @returns Promise that resolves when the rename is complete or cancelled
 * 
 * @throws Displays an error message if:
 *         - No task item is provided or item lacks resourceUri
 *         - A file with the new name already exists
 *         - The rename operation fails (e.g., permission issues)
 */
export async function renameTask(item: any, taskProvider: TaskProvider) {
    if (!item || !item.resourceUri) {
        vscode.window.showErrorMessage('No task selected');
        return;
    }

    const fileUri = item.resourceUri;
    const filePath = fileUri.fsPath;
    const parentDir = path.dirname(filePath);
    const oldFileName = path.basename(filePath);
    const oldExtension = path.extname(oldFileName);

    const newName = await vscode.window.showInputBox({
        title: 'Rename Task File',
        prompt: 'Enter a new filename for the task',
        value: oldFileName,
        validateInput: (input) => {
            const trimmed = input.trim();
            if (!trimmed) {
                return 'Filename cannot be empty';
            }
            if (/[/\\?%*:|"<>]/.test(trimmed)) {
                return 'Filename contains invalid characters';
            }
            return null;
        }
    });

    if (!newName) {
        return;
    }

    const trimmedName = newName.trim();
    // Ensure a markdown extension is preserved if none supplied
    let finalName = trimmedName;
    if (path.extname(trimmedName) === '') {
        finalName = `${trimmedName}${oldExtension || '.md'}`;
    }

    if (finalName === oldFileName) {
        return;
    }

    const targetPath = path.join(parentDir, finalName);

    try {
        await ws_rename(filePath, targetPath);
        taskProvider.queueReveal(targetPath);
        taskProvider.refresh();
        vscode.window.showInformationMessage(`Renamed task to "${finalName}".`);
    } catch (error: any) {
        const message = error instanceof Error ? error.message : String(error);
        if (/Exists/i.test(message)) {
            vscode.window.showErrorMessage(`A file named "${finalName}" already exists.`);
        } else {
            console.error('Failed to rename task file:', error);
            vscode.window.showErrorMessage(`Failed to rename task file: ${message}`);
        }
    }
}