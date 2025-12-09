import * as vscode from 'vscode';
import * as path from 'path';
import { renumberItems, scanForNumberedItems, verifyNamesAreUnique, stripOrdinalPrefix, extractOrdinalFromFilename, generateNumberPrefix, NumberedItem } from './utils';
import { ws_read_directory } from './ws-file-util';
import { ws_exists } from './ws-file-util';
import { ws_stat } from './ws-file-util';
import { ws_mkdir } from './ws-file-util';
import { ws_write_file } from './ws-file-util';
import { ws_rename } from './ws-file-util';
import { TaskProvider } from './model';

/**
 * Represents an item stored in the ordinal clipboard during cut/paste operations.
 * This interface captures all the necessary metadata about a file or folder that
 * has been "cut" and is ready to be pasted at a new ordinal position.
 */
export interface OrdinalClipboardItem {
    /** The absolute filesystem path to the source file or folder */
    sourcePath: string;
    /** The original filename including the ordinal prefix (e.g., "00020_my-file.md") */
    originalName: string;
    /** The filename with the ordinal prefix stripped (e.g., "my-file.md") */
    nameWithoutPrefix: string;
    /** Whether the item is a directory (true) or a file (false) */
    isDirectory: boolean;
}

/**
 * Recursively finds all directories in a given path, excluding common non-content directories.
 * 
 * This function performs a depth-first traversal of the directory tree starting from
 * the root path, collecting all directory paths that should be processed for ordinal
 * file renumbering operations.
 * 
 * @param rootPath - The absolute path to the root directory to start scanning from.
 *                   This directory is always included in the results.
 * @param excludePatterns - Optional array of additional directory names to exclude
 *                          from the scan (beyond the built-in defaults).
 * 
 * @returns A promise that resolves to an array of absolute directory paths,
 *          including the root directory and all non-excluded subdirectories.
 * 
 * @remarks
 * The following directories are excluded by default:
 * - `node_modules` - Node.js dependencies
 * - `.git` - Git version control
 * - `.vscode` - VS Code settings
 * - `out`, `dist`, `build` - Common build output directories
 * - `.next` - Next.js build directory
 * - `target` - Maven/Cargo build directory
 * 
 * Hidden directories (starting with `.` or `_`) are also automatically excluded.
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
            const entries = await ws_read_directory(dirPath);

            for (const [name, type] of entries) {
                if (type !== vscode.FileType.Directory) {
                    continue;
                }

                // Skip hidden directories and excluded directories
                if (name.startsWith('.') || name.startsWith('_')) {
                    continue;
                }

                if (allExcludes.includes(name)) {
                    continue;
                }

                const subDirPath = path.join(dirPath, name);
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

/**
 * Renumbers all ordinal-prefixed files and folders across the entire workspace.
 * 
 * This command scans all directories in the workspace (excluding common non-content
 * directories) and renumbers files/folders that have ordinal prefixes. The renumbering
 * maintains the existing sort order but normalizes the numbering sequence to start at
 * 00010 and increment by 10 (00010, 00020, 00030, etc.).
 * 
 * @remarks
 * **Workflow:**
 * 1. Scans all directories in the workspace recursively
 * 2. For each directory containing ordinal items:
 *    - Validates that names are unique (ignoring ordinal prefixes)
 *    - Sorts items by their current ordinal number (preserving existing order)
 *    - Renumbers starting at 00010 with increments of 10
 * 
 * **Gap Strategy:** The 10-increment spacing allows for easy manual insertion
 * of new items between existing ones without requiring a full renumber.
 * 
 * **Progress Reporting:** Shows a progress notification during the operation
 * with real-time updates on which directories are being processed.
 * 
 * **Error Handling:** If duplicate names are detected in a directory (after
 * removing ordinal prefixes), that directory is skipped and an error is reported.
 * 
 * @example
 * // Before renumbering:
 * // 001_intro.md, 005_chapter.md, 099_conclusion.md
 * // After renumbering:
 * // 00010_intro.md, 00020_chapter.md, 00030_conclusion.md
 */
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
                        dirStats = await ws_stat(directory);
                    } catch (statError) {
                        // Directory doesn't exist or isn't accessible - skip silently
                        console.log(`Skipping inaccessible directory: ${directory}`);
                        continue;
                    }

                    if ((dirStats.type & vscode.FileType.Directory) === 0) {
                        // Not a directory - skip silently
                        continue;
                    }

                    // Scan for numbered items in this directory
                    const numberedItems = await scanForNumberedItems(directory);

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

/**
 * Extracts ordinal information from a selected file or folder for insertion operations.
 * 
 * This is a utility function used by `insertOrdinalFile` and `insertOrdinalFolder`
 * to determine where a new item should be inserted and what ordinal prefix it should have.
 * 
 * @param uri - The VS Code URI of the currently selected file or folder in the explorer.
 *              The selected item must have an ordinal prefix (e.g., "00020_filename.md").
 * 
 * @returns A promise that resolves to an object containing:
 *          - `nextPrefix`: The generated prefix for the new item (current ordinal + 1)
 *          - `directory`: The parent directory path where the new item should be created
 *          Returns `null` if no valid selection or the selection lacks an ordinal prefix.
 * 
 * @remarks
 * The next ordinal is calculated by adding 1 to the current item's ordinal.
 * This allows insertion immediately after the selected item.
 * 
 * @example
 * // If user selects "00020_chapter-two.md"
 * // Returns: { nextPrefix: "00021_", directory: "/path/to/parent" }
 */
async function getOrdinalInsertInfo(uri: vscode.Uri): Promise<{ nextPrefix: string; directory: string } | null> {
    if (!uri) {
        vscode.window.showErrorMessage('No file or folder selected');
        return null;
    }

    const selectedPath = uri.fsPath;
    const name = path.basename(selectedPath);
    const currentOrdinal = extractOrdinalFromFilename(name);

    if (currentOrdinal === null) {
        vscode.window.showErrorMessage('Selected item does not have an ordinal prefix (e.g., "001_filename")');
        return null;
    }

    const nextOrdinal = currentOrdinal + 1;
    const nextPrefix = generateNumberPrefix(nextOrdinal);
    const directory = path.dirname(selectedPath);

    return { nextPrefix, directory };
}

/**
 * Creates a new markdown file with an ordinal prefix immediately after the selected item.
 * 
 * This command is available from the VS Code explorer context menu when right-clicking
 * on an ordinal file or folder (Timex → Insert... → New File).
 * 
 * @param uri - The VS Code URI of the currently selected file or folder in the explorer.
 *              The selection must have an ordinal prefix to determine the new file's ordinal.
 * 
 * @remarks
 * **Workflow:**
 * 1. Extracts the ordinal number from the selected item
 * 2. Prompts the user for a filename (without ordinal prefix or .md extension)
 * 3. Creates a new empty `.md` file with ordinal = selected ordinal + 1
 * 4. Opens the new file in the editor
 * 
 * **Filename Handling:**
 * - The `.md` extension is automatically added
 * - If the user includes `.md` in their input, it's stripped and re-added
 * - The ordinal prefix is automatically prepended
 * 
 * **Overwrite Protection:** If a file with the same name already exists,
 * the user is prompted to confirm overwriting.
 * 
 * @example
 * // User right-clicks on "00020_chapter-two.md" and enters "chapter-three"
 * // Creates: "00021_chapter-three.md" in the same directory
 */
export async function insertOrdinalFile(uri: vscode.Uri) {
    const info = await getOrdinalInsertInfo(uri);
    if (!info) {
        return;
    }

    const { nextPrefix, directory } = info;

    // Ask user for the file name
    const userInput = await vscode.window.showInputBox({
        prompt: `Enter name for new file (will be prefixed with ${nextPrefix})`,
        placeHolder: 'my-new-file',
        value: 'new'
    });

    if (!userInput) {
        return; // User cancelled
    }

    // Strip .md extension if user entered it
    const cleanName = userInput.replace(/\.md$/i, '');
    const newFilename = `${nextPrefix}${cleanName}.md`;
    const fullPath = path.join(directory, newFilename);

    try {
        // Check if the new file already exists
        if (await ws_exists(fullPath)) {
            const overwrite = await vscode.window.showWarningMessage(
                `File "${newFilename}" already exists. Do you want to overwrite it?`,
                { modal: true },
                'Overwrite',
                'Cancel'
            );

            if (overwrite !== 'Overwrite') {
                return;
            }
        }

        // Create the new empty file
        await ws_write_file(fullPath, '');

        // Open the file in the editor
        const fileUri = vscode.Uri.file(fullPath);
        const document = await vscode.workspace.openTextDocument(fileUri);
        await vscode.window.showTextDocument(document);

        vscode.window.showInformationMessage(`Created and opened: ${newFilename}`);

    } catch (error) {
        vscode.window.showErrorMessage(`Failed to create ordinal file: ${error}`);
        console.error('Insert ordinal file error:', error);
    }
}

/**
 * Creates a new folder with an ordinal prefix immediately after the selected item.
 * 
 * This command is available from the VS Code explorer context menu when right-clicking
 * on an ordinal file or folder (Timex → Insert... → New Folder).
 * 
 * @param uri - The VS Code URI of the currently selected file or folder in the explorer.
 *              The selection must have an ordinal prefix to determine the new folder's ordinal.
 * 
 * @remarks
 * **Workflow:**
 * 1. Extracts the ordinal number from the selected item
 * 2. Prompts the user for a folder name (without ordinal prefix)
 * 3. Creates a new empty folder with ordinal = selected ordinal + 1
 * 4. Reveals the new folder in the VS Code explorer
 * 
 * **Error Handling:** If a folder with the same name already exists,
 * an error message is displayed and no action is taken.
 * 
 * @example
 * // User right-clicks on "00020_chapter-two" folder and enters "chapter-three"
 * // Creates: "00021_chapter-three/" folder in the same directory
 */
export async function insertOrdinalFolder(uri: vscode.Uri) {
    const info = await getOrdinalInsertInfo(uri);
    if (!info) {
        return;
    }

    const { nextPrefix, directory } = info;

    // Ask user for the folder name
    const userInput = await vscode.window.showInputBox({
        prompt: `Enter name for new folder (will be prefixed with ${nextPrefix})`,
        placeHolder: 'my-new-folder',
        value: 'new-folder'
    });

    if (!userInput) {
        return; // User cancelled
    }

    const newFolderName = `${nextPrefix}${userInput}`;
    const fullPath = path.join(directory, newFolderName);

    try {
        // Check if the folder already exists
        if (await ws_exists(fullPath)) {
            vscode.window.showErrorMessage(`Folder "${newFolderName}" already exists.`);
            return;
        }

        // Create the new folder
        await ws_mkdir(fullPath);

        // Reveal the new folder in the explorer
        const folderUri = vscode.Uri.file(fullPath);
        await vscode.commands.executeCommand('revealInExplorer', folderUri);

        vscode.window.showInformationMessage(`Created folder: ${newFolderName}`);

    } catch (error) {
        vscode.window.showErrorMessage(`Failed to create ordinal folder: ${error}`);
        console.error('Insert ordinal folder error:', error);
    }
}

/**
 * Marks a file or folder for ordinal-aware cut operation.
 * 
 * This is the first step of a cut/paste workflow that allows moving files or folders
 * to a new ordinal position while automatically adjusting the numbering of other items.
 * The cut item is stored in a clipboard until `pasteByOrdinal` is called.
 * 
 * @param uri - The VS Code URI of the file or folder to cut. Must be provided.
 * @param taskProvider - The TaskProvider instance, used to set visual cut indicator in the tree view.
 * @param setClipboard - Callback function to store the clipboard item in the extension's state.
 * @param resetClipboard - Callback function to clear the clipboard if an error occurs.
 * 
 * @remarks
 * **Side Effects:**
 * - Sets `timex.hasOrdinalCutItem` context to `true` (enables paste menu visibility)
 * - Updates the task tree view to show a visual indicator on the cut item
 * - Stores item metadata (path, name, type) in the extension's clipboard state
 * 
 * **Note:** The file is not actually moved or modified during the cut operation.
 * It remains in place until `pasteByOrdinal` is executed.
 * 
 * @example
 * // User right-clicks "00030_section-c.md" and selects "Cut by Ordinal"
 * // The file is marked for cutting and awaits paste destination
 */
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
        const stats = await ws_stat(filePath);
        const baseName = path.basename(filePath);
        const nameWithoutPrefix = stripOrdinalPrefix(baseName);

        const clipboardItem: OrdinalClipboardItem = {
            sourcePath: filePath,
            originalName: baseName,
            nameWithoutPrefix,
            isDirectory: (stats.type & vscode.FileType.Directory) !== 0
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

/**
 * Pastes a previously cut item at the ordinal position of the selected target.
 * 
 * This completes the cut/paste workflow started by `cutByOrdinal`. The cut item
 * is moved to take the ordinal position of the selected target, and all existing
 * items at or after that position are shifted down (their ordinals increased by 10).
 * 
 * @param uri - The VS Code URI of the target file or folder. The cut item will be
 *              placed at this item's ordinal position.
 * @param getClipboard - Callback function to retrieve the previously cut item from state.
 * @param resetClipboard - Callback function to clear the clipboard after successful paste.
 * @param taskProvider - The TaskProvider instance, used to refresh the tree view after the move.
 * 
 * @remarks
 * **Workflow:**
 * 1. Validates that a cut item exists and the target has an ordinal prefix
 * 2. Moves the cut item to a temporary name (to avoid conflicts during renaming)
 * 3. Shifts all items at or after the target ordinal up by 10
 * 4. Places the cut item at the target's original ordinal
 * 
 * **Atomic Operation:** If any step fails, all renames are rolled back to restore
 * the original state. This ensures no files are lost or corrupted.
 * 
 * **Cross-Directory Support:** The cut item can be pasted into a different directory
 * than its source location.
 * 
 * @example
 * // Cut item: "00050_section-e.md" from /docs/
 * // Target: "00020_section-b.md" in /chapters/
 * // Result: "00020_section-e.md" in /chapters/
 * //         Original "00020_section-b.md" becomes "00030_section-b.md"
 * //         All subsequent items shift by 10
 */
export async function pasteByOrdinal(
    uri: vscode.Uri | undefined,
    getClipboard: () => OrdinalClipboardItem | null,
    resetClipboard: () => void,
    taskProvider: TaskProvider
): Promise<void> {
    const ordinalClipboard = getClipboard();

    if (!ordinalClipboard) {
        vscode.window.showErrorMessage('Cut an ordinal item before pasting.');
        return;
    }

    if (!uri) {
        vscode.window.showErrorMessage('No destination selected');
        return;
    }

    const targetPath = uri.fsPath;
    const targetBaseName = path.basename(targetPath);
    const targetOrdinal = extractOrdinalFromFilename(targetBaseName);

    if (targetOrdinal === null) {
        vscode.window.showErrorMessage('Select a target that includes an ordinal prefix (e.g., "00020_filename").');
        return;
    }

    const clipboardItem = ordinalClipboard;
    const targetDirectory = path.dirname(targetPath);

    try {
        await ws_stat(clipboardItem.sourcePath);
    } catch {
        vscode.window.showErrorMessage('The original item can no longer be found.');
        resetClipboard();
        return;
    }

    try {
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'Moving ordinal item',
            cancellable: false
        }, async (progress) => {
            progress.report({ message: 'Preparing...' });

            const performedRenames: Array<{ from: string; to: string }> = [];
            const sourceDirectory = path.dirname(clipboardItem.sourcePath);
            const uniqueSuffix = Math.random().toString(36).slice(2, 8);
            const extension = clipboardItem.isDirectory ? '' : path.extname(clipboardItem.nameWithoutPrefix);
            const tempName = `_timex_cut_${Date.now()}_${uniqueSuffix}${extension}`;
            const tempPath = path.join(sourceDirectory, tempName);

            let success = false;

            try {
                // Move the cut item to a temporary name so we can freely shift ordinals
                await ws_rename(clipboardItem.sourcePath, tempPath);
                performedRenames.push({ from: tempPath, to: clipboardItem.sourcePath });

                progress.report({ message: 'Shifting existing ordinals...' });
                const numberedItems = await scanForNumberedItems(targetDirectory);
                const itemsToShift = numberedItems
                    .filter(item => {
                        const ordinal = extractOrdinalFromFilename(item.originalName);
                        return ordinal !== null && ordinal >= targetOrdinal;
                    })
                    .sort((a, b) => {
                        const aOrdinal = extractOrdinalFromFilename(a.originalName) ?? 0;
                        const bOrdinal = extractOrdinalFromFilename(b.originalName) ?? 0;
                        return bOrdinal - aOrdinal; // Rename from the bottom up to avoid collisions
                    });

                for (const item of itemsToShift) {
                    const currentOrdinal = extractOrdinalFromFilename(item.originalName)!;
                    const newOrdinal = currentOrdinal + 10;
                    const newName = generateNumberPrefix(newOrdinal) + item.nameWithoutPrefix;
                    const newPath = path.join(targetDirectory, newName);

                    await ws_rename(item.fullPath, newPath);
                    performedRenames.push({ from: newPath, to: item.fullPath });
                }

                progress.report({ message: 'Placing cut item...' });
                const finalName = generateNumberPrefix(targetOrdinal) + clipboardItem.nameWithoutPrefix;
                const finalPath = path.join(targetDirectory, finalName);

                await ws_rename(tempPath, finalPath);
                success = true;
            } catch (innerError) {
                for (const op of performedRenames.reverse()) {
                    try {
                        await ws_rename(op.from, op.to);
                    } catch (revertError) {
                        console.error('Failed to revert ordinal rename:', revertError);
                    }
                }
                throw innerError;
            }

            if (!success) {
                throw new Error('Unable to finalize ordinal move.');
            }
        });

        const destinationOrdinal = generateNumberPrefix(targetOrdinal).slice(0, -1);
        const destinationName = `${generateNumberPrefix(targetOrdinal)}${clipboardItem.nameWithoutPrefix}`;
        resetClipboard();
        taskProvider.refresh();
        vscode.window.showInformationMessage(`Moved to ordinal ${destinationOrdinal}: ${destinationName}`);
    } catch (error: any) {
        const message = error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage(`Failed to paste ordinal item: ${message}`);
    }
}

/**
 * Moves an ordinal file or folder up or down by swapping it with its neighbor.
 * 
 * This command swaps the ordinal prefixes of two adjacent items, effectively
 * moving the selected item up or down in the sorted order without affecting
 * any other items in the directory.
 * 
 * @param uri - The VS Code URI of the file or folder to move.
 * @param direction - The direction to move: `'up'` swaps with the previous item,
 *                    `'down'` swaps with the next item.
 * @param taskProvider - The TaskProvider instance, used to refresh the tree view after the swap.
 * 
 * @remarks
 * **Swap Mechanism:** Only the ordinal prefixes are exchanged between the two items.
 * The base filenames (without prefixes) remain unchanged.
 * 
 * **Edge Cases:**
 * - If the item is already first and direction is `'up'`, shows an informational message
 * - If the item is already last and direction is `'down'`, shows an informational message
 * - If the neighbor lacks a valid ordinal prefix, shows an error
 * 
 * **Atomic Operation:** Uses a temporary file during the swap to prevent collisions.
 * If any rename fails, all operations are rolled back.
 * 
 * @example
 * // Before: 00010_intro.md, 00020_chapter.md, 00030_conclusion.md
 * // User moves "00020_chapter.md" up
 * // After:  00010_chapter.md, 00020_intro.md, 00030_conclusion.md
 */
export async function moveOrdinal(uri: vscode.Uri | undefined, direction: 'up' | 'down', taskProvider: TaskProvider): Promise<void> {
    if (!uri) {
        vscode.window.showErrorMessage('No file or folder selected');
        return;
    }

    const selectedPath = uri.fsPath;
    const selectedName = path.basename(selectedPath);
    const selectedOrdinal = extractOrdinalFromFilename(selectedName);
    if (selectedOrdinal === null) {
        vscode.window.showErrorMessage('Selected item does not have an ordinal prefix (e.g., "00010_file.md").');
        return;
    }

    const directory = path.dirname(selectedPath);
    let numberedItems: NumberedItem[];
    try {
        numberedItems = await scanForNumberedItems(directory);
    } catch (error: any) {
        const message = error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage(`Failed to scan directory: ${message}`);
        return;
    }

    if (numberedItems.length === 0) {
        vscode.window.showInformationMessage('No ordinal items found to reorder.');
        return;
    }

    const currentIndex = numberedItems.findIndex(item => item.originalName === selectedName);
    if (currentIndex === -1) {
        vscode.window.showErrorMessage('Could not locate selected ordinal item in its directory.');
        return;
    }

    const neighborIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
    if (neighborIndex < 0 || neighborIndex >= numberedItems.length) {
        const positionText = direction === 'up' ? 'first' : 'last';
        vscode.window.showInformationMessage(`"${selectedName}" is already the ${positionText} item.`);
        return;
    }

    const neighbor = numberedItems[neighborIndex];
    const neighborOrdinal = extractOrdinalFromFilename(neighbor.originalName);
    if (neighborOrdinal === null) {
        vscode.window.showErrorMessage('Neighboring item lacks a valid ordinal prefix.');
        return;
    }

    const selectedSuffix = stripOrdinalPrefix(selectedName);
    const neighborSuffix = stripOrdinalPrefix(neighbor.originalName);
    const selectedNewName = generateNumberPrefix(neighborOrdinal) + selectedSuffix;
    const neighborNewName = generateNumberPrefix(selectedOrdinal) + neighborSuffix;

    const neighborPath = path.join(directory, neighbor.originalName);
    const neighborNewPath = path.join(directory, neighborNewName);
    const selectedNewPath = path.join(directory, selectedNewName);
    const tempName = `_timex_swap_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const tempPath = path.join(directory, tempName);

    const performedRenames: Array<{ from: string; to: string }> = [];

    try {
        await ws_rename(selectedPath, tempPath);
        performedRenames.push({ from: tempPath, to: selectedPath });

        await ws_rename(neighborPath, neighborNewPath);
        performedRenames.push({ from: neighborNewPath, to: neighborPath });

        await ws_rename(tempPath, selectedNewPath);
    } catch (error: any) {
        for (const operation of performedRenames.reverse()) {
            try {
                if (await ws_exists(operation.from)) {
                    await ws_rename(operation.from, operation.to);
                }
            } catch (revertError) {
                console.error('Failed to revert ordinal move:', revertError);
            }
        }

        const message = error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage(`Failed to move ordinal item: ${message}`);
        return;
    }

    taskProvider.refresh();
    const directionLabel = direction === 'up' ? 'up' : 'down';
    const newOrdinalDisplay = String(neighborOrdinal).padStart(5, '0');
    const displayName = selectedSuffix || selectedName;
    vscode.window.showInformationMessage(`Moved "${displayName}" ${directionLabel}. New ordinal: ${newOrdinalDisplay}`);
}

/**
 * Wraps a markdown file into its own folder, preserving the ordinal structure.
 * 
 * This command creates a new folder with the same name as the file (minus extension),
 * then moves the file into that folder. If the file has an ordinal prefix, the file
 * is renumbered to 00010 within its new folder, establishing a clean starting point
 * for additional content.
 * 
 * @param uri - The VS Code URI of the markdown file to wrap into a folder.
 *              Must be a file (not a folder).
 * 
 * @remarks
 * **Use Case:** This is useful when a single markdown file grows in scope and needs
 * to be expanded into a multi-file section. Instead of manually creating the folder
 * and moving the file, this command automates the process.
 * 
 * **Naming Convention:**
 * - Folder name = filename without extension (preserving ordinal prefix)
 * - Moved file = renumbered to start at 00010 (if it had an ordinal prefix)
 * 
 * **File Watcher Integration:** The VS Code file watcher automatically detects
 * the move operation, so no manual task provider refresh is needed.
 * 
 * @example
 * // Before: /docs/00030_my-test-file.md
 * // After:  /docs/00030_my-test-file/00010_my-test-file.md
 * 
 * @example
 * // File without ordinal: /docs/readme.md
 * // After: /docs/readme/readme.md (no ordinal added)
 */
export async function moveFileToFolder(uri: vscode.Uri | undefined): Promise<void> {
    if (!uri) {
        vscode.window.showErrorMessage('No file selected');
        return;
    }

    const filePath = uri.fsPath;
    const dirName = path.dirname(filePath);
    const fileName = path.basename(filePath);
    const ext = path.extname(fileName);
    
    // Determine folder name (strip extension)
    // If file is "00030_my-test-file.md", folder will be "00030_my-test-file"
    const folderName = path.basename(fileName, ext);
    const newFolderPath = path.join(dirName, folderName);

    try {
        // Check if folder already exists
        if (await ws_exists(newFolderPath)) {
            const stats = await ws_stat(newFolderPath);
            if ((stats.type & vscode.FileType.Directory) !== 0) {
                vscode.window.showErrorMessage(`Folder "${folderName}" already exists.`);
                return;
            }
        }

        // Create the new folder
        await ws_mkdir(newFolderPath);

        // Determine new file name
        // If file has ordinal prefix, rename to start with 00010_
        let newFileName = fileName;
        const ordinal = extractOrdinalFromFilename(fileName);
        if (ordinal !== null) {
            const nameWithoutPrefix = stripOrdinalPrefix(fileName);
            newFileName = generateNumberPrefix(10) + nameWithoutPrefix;
        }

        // Move the file into the new folder
        const newFilePath = path.join(newFolderPath, newFileName);
        await ws_rename(filePath, newFilePath);

        // No need to refresh task provider explicitly as the file watcher should pick it up,
        // but if we want to be sure we can. However, TaskProvider isn't passed here.
        // The file watcher in extension.ts watches **/*.md, so it should handle the move (delete + create).

    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage(`Failed to move file to folder: ${message}`);
        console.error('Move to folder error:', error);
    }
}
