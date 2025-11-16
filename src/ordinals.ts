import * as vscode from 'vscode';
import { renumberItems, scanForNumberedItems, verifyNamesAreUnique } from './utils';

export async function renumberFiles() {
    // Get the workspace folder
    if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
        vscode.window.showErrorMessage('No workspace folder found');
        return;
    }

    const workspaceFolder = vscode.workspace.workspaceFolders[0];
    const rootPath = workspaceFolder.uri.fsPath;

    try {
        // Show progress indicator
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'Renumbering Files',
            cancellable: false
        }, async (progress) => {
            progress.report({ increment: 0, message: 'Scanning for numbered files...' });

            // Scan for numbered items
            const numberedItems = scanForNumberedItems(rootPath);

            if (numberedItems.length === 0) {
                vscode.window.showInformationMessage('No numbered files or folders found in workspace root. Files must start with digits followed by underscore (e.g., "001_file.md")');
                return;
            }

            progress.report({ increment: 20, message: `Found ${numberedItems.length} numbered items...` });

            // Verify that all names (after ordinal prefix) are unique
            const duplicateError = verifyNamesAreUnique(numberedItems);
            if (duplicateError) {
                vscode.window.showErrorMessage(duplicateError);
                return;
            }

            progress.report({ increment: 10, message: 'Validating unique names...' });

            // Perform the renumbering
            await renumberItems(numberedItems);

            progress.report({ increment: 50, message: 'Complete!' });

            vscode.window.showInformationMessage(`Successfully renumbered ${numberedItems.length} files and folders.`);
        });

    } catch (error) {
        vscode.window.showErrorMessage(`Failed to renumber files: ${error}`);
        console.error('Renumber files error:', error);
    }
}