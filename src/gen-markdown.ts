import * as vscode from 'vscode';
import * as path from 'path';
import { getTitleFromFile, IMAGE_EXTENSIONS, NumberedItem, scanForNumberedItems, stripOrdinalPrefix } from './utils';
import { ws_stat } from './ws-file-util';
import { ws_write_file } from './ws-file-util';
import { ws_read_file } from './ws-file-util';

/**
 * Context object passed through the recursive markdown generation process.
 * Contains shared state and configuration for the generation operation.
 */
interface GenerateContext {
    /** The workspace folder that contains the target directory being processed */
    owningWorkspace: vscode.WorkspaceFolder;
    /** Accumulator array that collects paths of all created _index.md files */
    createdIndexes: string[];
    /** VS Code progress reporter for displaying scan status in the notification area */
    progress: vscode.Progress<{ message?: string }>;
    /** When true, generates a single flattened _index.md; when false, creates recursive index files */
    singleFileMode: boolean;
    /** The root directory where markdown generation starts (used for relative path calculations) */
    targetDirectory: string;
}

/**
 * Extracts the title from markdown content by finding the first H1 heading.
 * Looks for a line starting with "# " and returns the text after it.
 * 
 * @param content - The markdown content to search for a title
 * @returns The title text if an H1 heading is found, undefined otherwise
 * 
 * @example
 * getTitleFromContent("# My Document\n\nSome content") // Returns "My Document"
 * getTitleFromContent("No heading here") // Returns undefined
 */
function getTitleFromContent(content: string): string | undefined {
    const match = content.match(/^#\s+(.*)$/m);
    return match ? match[1].trim() : undefined;
}

/**
 * Recursively generates markdown content for a directory containing ordinal-prefixed files.
 * 
 * This function walks through a directory, processing ordinal files (e.g., "00010_intro.md")
 * in sorted order. It handles three types of content:
 * - **Subdirectories**: Recursively processed; in single-file mode their content is inlined,
 *   in multi-file mode a link to the child's _index.md is created
 * - **Images**: Embedded using markdown image syntax with alt text derived from filename
 * - **Markdown files**: Content is read and concatenated with "---" separators
 * 
 * @param directory - Absolute path to the directory to process
 * @param context - Shared generation context containing configuration and state
 * @returns The compiled markdown content for this directory, or null if no content was generated
 * 
 * @throws Error if the directory cannot be scanned (with descriptive message)
 * 
 * @remarks
 * - In single-file mode, image paths are adjusted to be relative to the target directory
 * - In multi-file mode, an _index.md file is written to each processed directory
 * - Empty directories or directories with no ordinal items return null
 * - Trailing "---" separators are removed from the final output
 */
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

/**
 * Main entry point for generating markdown index files from ordinal-structured directories.
 * 
 * This command provides two generation modes:
 * - **Multiple Index Files (Recursive)**: Creates an _index.md in each directory containing
 *   links to child indexes and concatenated markdown content
 * - **Single Index File (Flattened)**: Creates one _index.md at the root with all content
 *   from the entire directory tree flattened into a single document
 * 
 * @param resource - Optional URI or array of URIs from the explorer context menu.
 *                   If a folder is selected, generation starts there.
 *                   If a file is selected or nothing is selected, uses workspace root.
 * 
 * @remarks
 * - Displays a progress notification during generation
 * - Opens the generated root index in VS Code's markdown preview on completion
 * - Shows an information message with the count of generated index files
 * - Ordinal files are processed in numeric order (e.g., 00010_, 00020_, etc.)
 * - Images are embedded inline; markdown files are concatenated with separators
 * - Non-ordinal files and hidden files (starting with . or _) are ignored
 * 
 * @example
 * // Triggered via command palette or explorer context menu:
 * // Right-click folder → Timex → Generate Markdown → "Generate Index"
 */
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