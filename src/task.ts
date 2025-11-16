import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { formatTimestamp } from './utils';
import { PriorityTag } from './constants';
import { TaskProvider } from './model';

export async function newTask(taskProvider: TaskProvider) {
    // Get the workspace folder
    if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
        vscode.window.showErrorMessage('No workspace folder found');
        return;
    }

    const workspaceFolder = vscode.workspace.workspaceFolders[0];
    const rootPath = workspaceFolder.uri.fsPath;

    // Get configured task folder
    const config = vscode.workspace.getConfiguration('timex');
    const taskFolderSetting = config.get<string>('newTaskFolder', '');

    // Determine the target folder
    let targetPath = rootPath;
    if (taskFolderSetting && taskFolderSetting.trim() !== '') {
        const folderPath = taskFolderSetting.trim();

        // Check if it's an absolute path
        if (path.isAbsolute(folderPath)) {
            targetPath = folderPath;
        } else {
            // If relative path, join with workspace root (backward compatibility)
            targetPath = path.join(rootPath, folderPath);
        }

        // Create the folder if it doesn't exist
        if (!fs.existsSync(targetPath)) {
            try {
                fs.mkdirSync(targetPath, { recursive: true });
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to create task folder: ${error}`);
                return;
            }
        }
    }

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
    if (fs.existsSync(filePath)) {
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
        fs.writeFileSync(filePath, taskContent, 'utf8');

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