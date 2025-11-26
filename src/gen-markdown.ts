import * as vscode from 'vscode';
import * as path from 'path';
import { getTitleFromFile, IMAGE_EXTENSIONS, NumberedItem, scanForNumberedItems, stripOrdinalPrefix } from './utils';
import { ws_stat } from './ws-file-util';
import { ws_write_file } from './ws-file-util';
import { ws_read_file } from './ws-file-util';

interface GenerateContext {
    owningWorkspace: vscode.WorkspaceFolder;
    createdIndexes: string[];
    progress: vscode.Progress<{ message?: string }>;
    singleFileMode: boolean;
    targetDirectory: string;
}

function getTitleFromContent(content: string): string | undefined {
    const match = content.match(/^#\s+(.*)$/m);
    return match ? match[1].trim() : undefined;
}

async function generateMarkdownForDirectory(directory: string, context: GenerateContext): Promise<string | null> {
    const { owningWorkspace, createdIndexes, progress, singleFileMode, targetDirectory } = context;
    const relativePath = path.relative(owningWorkspace.uri.fsPath, directory) || path.basename(directory) || '.';
    progress.report({ message: `Scanning ${relativePath}` });

    let numberedItems: NumberedItem[];
    try {
        numberedItems = await scanForNumberedItems(directory);
    } catch (error: any) {
        throw new Error(`Failed to scan ${relativePath}: ${error instanceof Error ? error.message : String(error)}`);
    }

    if (numberedItems.length === 0) {
        return null;
    }

    const sections: string[] = [];
    let addedContent = false;

    for (const item of numberedItems) {
        if (item.isDirectory) {
            const childContent = await generateMarkdownForDirectory(item.fullPath, context);
            if (childContent) {
                if (singleFileMode) {
                    const folderLabel = stripOrdinalPrefix(item.originalName) || item.originalName;
                    // sections.push(`# ${folderLabel}`);
                    sections.push(childContent);
                } else {
                    const childIndexPath = path.join(item.fullPath, '_index.md');
                    const derivedTitle = await getTitleFromFile(childIndexPath);
                    const folderLabel = derivedTitle ?? (stripOrdinalPrefix(item.originalName) || item.originalName);
                    const linkTarget = encodeURI(path.posix.join(item.originalName, '_index.md'));
                    sections.push(`# [${folderLabel}](${linkTarget})`);
                }
                addedContent = true;
            }
        } else {
            const extension = path.extname(item.originalName).toLowerCase();
            if (IMAGE_EXTENSIONS.has(extension)) {
                const strippedName = stripOrdinalPrefix(item.originalName) || item.originalName;
                const altText = path.basename(strippedName, extension);
                
                let imagePath = item.originalName;
                if (singleFileMode) {
                    const relPath = path.relative(targetDirectory, item.fullPath);
                    imagePath = relPath.split(path.sep).join('/');
                }
                
                const encodedSource = encodeURI(imagePath);
                sections.push(`![${altText}](${encodedSource})`);
                addedContent = true;
            } else if (extension === '.md') {
                const contents = await ws_read_file(item.fullPath);
                sections.push(contents.trimEnd());
                sections.push('---');
                addedContent = true;
            }
        }
    }

    if (!addedContent) {
        return null;
    }

    if (sections.length > 0 && sections[sections.length - 1] === '---') {
        sections.pop();
    }

    const compiled = sections.join('\n\n').trimEnd() + '\n';

    if (!singleFileMode) {
        const indexPath = path.join(directory, '_index.md');
        await ws_write_file(indexPath, compiled);
        createdIndexes.push(indexPath);
    }
    
    return compiled;
}

export async function generateMarkdown(resource ?: vscode.Uri | vscode.Uri[]) {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
        vscode.window.showErrorMessage('No workspace folder found');
        return;
    }

    const mode = await vscode.window.showQuickPick(['Multiple Index Files (Recursive)', 'Single Index File (Flattened)'], {
        placeHolder: 'Select generation mode'
    });

    if (!mode) {
        return;
    }

    const singleFileMode = mode.startsWith('Single');

    const candidateUri = Array.isArray(resource) ? resource[0] : resource;

    // Determine the target directory based on what was selected
    let targetDirectory: string;
    let owningWorkspace: vscode.WorkspaceFolder;

    if (candidateUri) {
        // User right-clicked on a folder or file - determine target folder
        try {
            const stat = await ws_stat(candidateUri.fsPath);
            if ((stat.type & vscode.FileType.Directory) !== 0) {
                // Selected a folder - use it as target
                targetDirectory = candidateUri.fsPath;
            } else {
                // Selected a file - use workspace root
                targetDirectory = workspaceFolders[0].uri.fsPath;
            }
        } catch {
            // Error accessing path - fall back to workspace root
            targetDirectory = workspaceFolders[0].uri.fsPath;
        }
        owningWorkspace = vscode.workspace.getWorkspaceFolder(candidateUri) ?? workspaceFolders[0];
    } else {
        // No selection - use workspace root
        targetDirectory = workspaceFolders[0].uri.fsPath;
        owningWorkspace = workspaceFolders[0];
    }

    const createdIndexes: string[] = [];
    let rootContent: string | null = null;

    try {
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'Generating Markdown Indexes',
            cancellable: false
        }, async (progress) => {
            const context: GenerateContext = { 
                owningWorkspace, 
                createdIndexes, 
                progress, 
                singleFileMode,
                targetDirectory 
            };
            rootContent = await generateMarkdownForDirectory(targetDirectory, context);
        });

        if (!rootContent && createdIndexes.length === 0) {
            return;
        }

        if (singleFileMode && rootContent) {
            const indexPath = path.join(targetDirectory, '_index.md');
            await ws_write_file(indexPath, rootContent);
            createdIndexes.push(indexPath);
        }

        const rootIndex = createdIndexes[createdIndexes.length - 1];
        await vscode.commands.executeCommand('markdown.showPreview', vscode.Uri.file(rootIndex));

        const relativeDir = path.relative(owningWorkspace.uri.fsPath, targetDirectory) || owningWorkspace.name;
        vscode.window.showInformationMessage(`Generated ${createdIndexes.length} index file(s) starting at ${relativeDir}`);
    } catch (error: any) {
        const message = error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage(`Failed to generate markdown index: ${message}`);
    }
}

export async function previewFolderAsMarkdown(uri: vscode.Uri) {
    if (!uri) {
        vscode.window.showErrorMessage('No file or folder selected');
        return;
    }

    try {
        // Determine the folder to preview
        let folderPath: string;
        const stat = await ws_stat(uri.fsPath);

        if ((stat.type & vscode.FileType.Directory) !== 0) {
            // User clicked a folder - use it directly
            folderPath = uri.fsPath;
        } else {
            // User clicked a file - use workspace root instead
            // This allows previewing the root folder (which can't be directly selected in VS Code)
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders || workspaceFolders.length === 0) {
                vscode.window.showErrorMessage('No workspace folder found');
                return;
            }
            folderPath = workspaceFolders[0].uri.fsPath;
        }

        // Create a virtual URI using our custom scheme
        // Format: timex-preview:/path/to/folder
        const previewUri = vscode.Uri.parse(`timex-preview:${folderPath}`).with({
            scheme: 'timex-preview',
            path: folderPath
        });

        // Show directly in markdown preview mode without opening as text document first
        // This avoids the flicker of a tab opening and closing
        await vscode.commands.executeCommand('markdown.showPreview', previewUri);

    } catch (error: any) {
        const message = error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage(`Failed to preview folder: ${message}`);
        console.error('Preview folder error:', error);
    }
}