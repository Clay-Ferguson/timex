import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { generateNextOrdinalFilename, renumberItems, scanForNumberedItems, verifyNamesAreUnique, stripOrdinalPrefix } from './utils';
import { TaskProvider } from './model';

export interface OrdinalClipboardItem {
	sourcePath: string;
	originalName: string;
	nameWithoutPrefix: string;
	isDirectory: boolean;
}

/**
 * Recursively finds all directories in a given path
 */
async function findAllDirectories(rootPath: string, excludePatterns: string[] = []): Promise<string[]> {
    const directories: string[] = [rootPath]; // Include root directory
    
    const defaultExcludes = [
        'node_modules',
        '.git',
        '.vscode',
        'out',
        'dist',
        'build',
        '.next',
        'target'
    ];
    
    const allExcludes = [...defaultExcludes, ...excludePatterns];
    
    async function scanDirectory(dirPath: string): Promise<void> {
        try {
            const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
            
            for (const entry of entries) {
                if (!entry.isDirectory()) {
                    continue;
                }
                
                // Skip hidden directories and excluded directories
                if (entry.name.startsWith('.') || entry.name.startsWith('_')) {
                    continue;
                }
                
                if (allExcludes.includes(entry.name)) {
                    continue;
                }
                
                const subDirPath = path.join(dirPath, entry.name);
                directories.push(subDirPath);
                
                // Recursively scan subdirectories
                await scanDirectory(subDirPath);
            }
        } catch (error) {
            console.error(`Error scanning directory ${dirPath}:`, error);
        }
    }
    
    await scanDirectory(rootPath);
    return directories;
}

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
            progress.report({ increment: 0, message: 'Scanning for directories...' });

            // Find all directories in the workspace
            const allDirectories = await findAllDirectories(rootPath);
            
            progress.report({ increment: 10, message: `Scanning ${allDirectories.length} directories...` });

            let totalItemsRenumbered = 0;
            let directoriesProcessed = 0;
            const errors: string[] = [];

            // Process each directory
            for (let i = 0; i < allDirectories.length; i++) {
                const directory = allDirectories[i];
                const relativePath = path.relative(rootPath, directory) || 'root';
                
                try {
                    // Check if directory exists and is accessible
                    let dirStats;
                    try {
                        dirStats = await fs.promises.stat(directory);
                    } catch (statError) {
                        // Directory doesn't exist or isn't accessible - skip silently
                        console.log(`Skipping inaccessible directory: ${directory}`);
                        continue;
                    }

                    if (!dirStats.isDirectory()) {
                        // Not a directory - skip silently
                        continue;
                    }

                    // Scan for numbered items in this directory
                    const numberedItems = scanForNumberedItems(directory);

                    // Skip directories without ordinal files (silently) - this includes empty directories
                    if (numberedItems.length === 0) {
                        continue;
                    }

                    progress.report({ 
                        increment: (80 / allDirectories.length), 
                        message: `Processing ${relativePath} (${numberedItems.length} items)...` 
                    });

                    // Verify that all names (after ordinal prefix) are unique
                    const duplicateError = verifyNamesAreUnique(numberedItems);
                    if (duplicateError) {
                        errors.push(`${relativePath}: ${duplicateError}`);
                        continue;
                    }

                    // Perform the renumbering
                    await renumberItems(numberedItems);
                    
                    totalItemsRenumbered += numberedItems.length;
                    directoriesProcessed++;

                } catch (error) {
                    // Only report errors that are not related to empty directories
                    const errorMsg = error instanceof Error ? error.message : String(error);
                    
                    // Skip reporting errors for empty or non-existent directories
                    if (errorMsg.includes('ENOENT') || errorMsg.includes('no such file')) {
                        console.log(`Skipping non-existent directory: ${directory}`);
                        continue;
                    }
                    
                    errors.push(`${relativePath}: ${errorMsg}`);
                    console.error(`Error processing directory ${directory}:`, error);
                }
            }

            progress.report({ increment: 10, message: 'Complete!' });

            // Show results
            if (errors.length > 0) {
                const errorSummary = errors.join('\n\n');
                vscode.window.showErrorMessage(
                    `Renumbering completed with errors:\n\n${errorSummary}\n\nSuccessfully processed: ${directoriesProcessed} directories, ${totalItemsRenumbered} items.`,
                    { modal: true }
                );
            } else if (directoriesProcessed === 0) {
                vscode.window.showInformationMessage('No numbered files or folders found in any directory. Files must start with digits followed by underscore (e.g., "001_file.md")');
            } else {
                vscode.window.showInformationMessage(`Successfully renumbered ${totalItemsRenumbered} items across ${directoriesProcessed} directories.`);
            }
        });

    } catch (error) {
        vscode.window.showErrorMessage(`Failed to renumber files: ${error}`);
        console.error('Renumber files error:', error);
    }
}

export async function insertOrdinalFile (uri: vscode.Uri) {
        if (!uri) {
            vscode.window.showErrorMessage('No file selected');
            return;
        }

        const selectedFilePath = uri.fsPath;

        try {
            // Generate the next ordinal filename
            const nextOrdinalInfo = generateNextOrdinalFilename(selectedFilePath);

            if (!nextOrdinalInfo) {
                vscode.window.showErrorMessage('Selected file does not have an ordinal prefix (e.g., "001_filename.md")');
                return;
            }

            // Check if the new file already exists
            if (fs.existsSync(nextOrdinalInfo.fullPath)) {
                const overwrite = await vscode.window.showWarningMessage(
                    `File "${nextOrdinalInfo.filename}" already exists. Do you want to overwrite it?`,
                    { modal: true },
                    'Overwrite',
                    'Cancel'
                );

                if (overwrite !== 'Overwrite') {
                    return;
                }
            }

            // Create the new empty file
            fs.writeFileSync(nextOrdinalInfo.fullPath, '', 'utf8');

            // Open the file in the editor
            const fileUri = vscode.Uri.file(nextOrdinalInfo.fullPath);
            const document = await vscode.workspace.openTextDocument(fileUri);
            await vscode.window.showTextDocument(document);

            vscode.window.showInformationMessage(`Created and opened: ${nextOrdinalInfo.filename}`);

        } catch (error) {
            vscode.window.showErrorMessage(`Failed to create ordinal file: ${error}`);
            console.error('Insert ordinal file error:', error);
        }
    }

export async function cutByOrdinal(
	uri: vscode.Uri | undefined,
	taskProvider: TaskProvider,
	setClipboard: (item: OrdinalClipboardItem) => void,
	resetClipboard: () => void
): Promise<void> {
	if (!uri) {
		vscode.window.showErrorMessage('No file or folder selected');
		return;
	}

	const filePath = uri.fsPath;

	try {
		const stats = await fs.promises.lstat(filePath);
		const baseName = path.basename(filePath);
		const nameWithoutPrefix = stripOrdinalPrefix(baseName);

		const clipboardItem: OrdinalClipboardItem = {
			sourcePath: filePath,
			originalName: baseName,
			nameWithoutPrefix,
			isDirectory: stats.isDirectory()
		};

		setClipboard(clipboardItem);
		taskProvider.setCutIndicator(baseName);
		void vscode.commands.executeCommand('setContext', 'timex.hasOrdinalCutItem', true);
		vscode.window.showInformationMessage(`Cut ready: ${baseName}`);
	} catch (error: any) {
		const message = error instanceof Error ? error.message : String(error);
		vscode.window.showErrorMessage(`Failed to cut item: ${message}`);
		resetClipboard();
	}
}