import * as path from 'path';
import * as vscode from 'vscode';
import { ws_exists, ws_read_file, ws_write_file } from '../ws-file-util';
import { WriterContext } from './writer';

/**
 * Adds a file reference to the AI-WRITER-CONTEXT.md file for inclusion in AI Writer prompts.
 *
 * This command is triggered from the VS Code Explorer context menu (right-click on a file).
 * It creates a markdown link entry in AI-WRITER-CONTEXT.md that will be expanded into
 * the file's full content when the AI Writer processes prompts.
 *
 * **Workflow:**
 * 1. Validates the selection is a text file (not folder, not binary)
 * 2. Calculates the relative path from workspace root
 * 3. Creates `AI-WRITER-CONTEXT.md` if it doesn't exist (with header)
 * 4. Checks for duplicate entries (by path, not link text)
 * 5. Appends a markdown link: `[filename](relative/path/to/file.ext)`
 * 6. Opens the context file in the editor for review
 *
 * **Generated Entry Format:**
 * ```markdown
 * [myComponent](src/components/myComponent.ts)
 * ```
 *
 * @param uri - The VS Code URI of the file selected in the Explorer (from context menu)
 *
 * @remarks
 * - Only works with text files (validates UTF-8 decoding)
 * - Will not add duplicate entries (checks if path already exists)
 * - Creates context file with header if it doesn't exist
 * - Prevents adding if AI-WRITER-CONTEXT.md has unsaved changes
 * - Normalizes path separators to forward slashes for cross-platform compatibility
 *
 * @example
 * // User right-clicks on src/utils/helpers.ts in Explorer
 * // Selects: Timex > AI Writer > Add to Context
 * // Result: AI-WRITER-CONTEXT.md gets: [helpers](src/utils/helpers.ts)
 */
export async function addFileToContext(uri: vscode.Uri) {
    // Get the workspace root
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
        vscode.window.showErrorMessage('No workspace folder is open.');
        return;
    }
    const rootPath = workspaceFolders[0].uri.fsPath;

    // Path to the context file
    const contextFilePath = path.join(rootPath, 'AI-WRITER-CONTEXT.md');

    // Check if context file is open and has unsaved changes
    const contextFileUri = vscode.Uri.file(contextFilePath);
    const openDocument = vscode.workspace.textDocuments.find(
        doc => doc.uri.fsPath === contextFileUri.fsPath
    );
    if (openDocument && openDocument.isDirty) {
        vscode.window.showErrorMessage(
            'AI-WRITER-CONTEXT.md has unsaved changes. Please save or close the file and try again.'
        );
        return;
    }

    // Check if a file was selected (uri comes from explorer context menu)
    if (!uri) {
        vscode.window.showErrorMessage('No file selected. Please right-click on a file in the Explorer.');
        return;
    }

    // Check if it's a file (not a directory)
    try {
        const stat = await vscode.workspace.fs.stat(uri);
        if (stat.type !== vscode.FileType.File) {
            vscode.window.showErrorMessage('Please select a file, not a folder.');
            return;
        }
    } catch (_err) {
        vscode.window.showErrorMessage('Could not access the selected item.');
        return;
    }

    // Try to read the file to verify it's a text file
    try {
        const fileContent = await vscode.workspace.fs.readFile(uri);
        // Try to decode as UTF-8 - this will work for text files
        const decoder = new TextDecoder('utf-8', { fatal: true });
        decoder.decode(fileContent);
    } catch (_err) {
        vscode.window.showErrorMessage('The selected file does not appear to be a text file.');
        return;
    }

    // Calculate the relative path from workspace root
    const absolutePath = uri.fsPath;
    const relativePath = path.relative(rootPath, absolutePath);

    // Normalize path separators to forward slashes for Markdown links
    const normalizedRelativePath = relativePath.split(path.sep).join('/');

    // Generate the filename without extension for the link text
    const fileName = path.basename(absolutePath, path.extname(absolutePath));

    // Create the markdown link
    const markdownLink = `[${fileName}](${normalizedRelativePath})`;

    // Check if context file exists
    let existingContent = '';
    if (await ws_exists(contextFilePath)) {
        existingContent = await ws_read_file(contextFilePath);

        // Check if the link already exists (check for the path specifically)
        // We look for the path in parentheses to match markdown link format
        if (existingContent.includes(`(${normalizedRelativePath})`)) {
            vscode.window.showInformationMessage(`File is already in context: ${normalizedRelativePath}`);
            // Open the context file in the editor
            await vscode.window.showTextDocument(contextFileUri);
            return;
        }
    } else {
        // Create the file with a header
        existingContent = '# Custom Context\n\n';
    }

    // Append the new link
    const newContent = existingContent.trimEnd() + '\n' + markdownLink + '\n';

    // Write the file
    try {
        await ws_write_file(contextFilePath, newContent);
        vscode.window.showInformationMessage(`Added to context: ${normalizedRelativePath}`);
    } catch (err) {
        vscode.window.showErrorMessage(`Failed to update AI-WRITER-CONTEXT.md: ${err}`);
        return;
    }

    // Open the context file in the editor
    await vscode.window.showTextDocument(contextFileUri);
}/**
 * Processes the AI-WRITER-CONTEXT.md file by expanding markdown links into inline file content.
 *
 * This function reads the context file and replaces any markdown links `[text](path)` with
 * the actual content of the referenced files, wrapped in `<context_file>` XML tags.
 * This allows users to maintain a simple list of reference files that get automatically
 * expanded when the AI Writer processes prompts.
 *
 * **Input Format** (AI-WRITER-CONTEXT.md):
 * ```markdown
 * # Custom Context
 * [config](src/config.ts)
 * [readme](docs/README.md)
 * ```
 *
 * **Output Format** (after processing):
 * ```markdown
 * # Custom Context
 * <context_file path="src/config.ts">
 * // file contents here...
 * </context_file>
 * <context_file path="docs/README.md">
 * // file contents here...
 * </context_file>
 * ```
 *
 * @param filePath - Absolute path to the AI-WRITER-CONTEXT.md file
 * @param rootPath - Workspace root path for resolving relative file references
 *
 * @returns The processed content with all links expanded to file contents
 *
 * @throws Error if any referenced file does not exist
 *
 * @remarks
 * - Uses negative lookbehind to avoid matching image links `![text](path)`
 * - File paths in links are relative to workspace root
 * - All referenced files must exist or the function throws an error
 */
export async function processContextFile(filePath: string, rootPath: string): Promise<string> {
    const content = await ws_read_file(filePath);
    // Match [text](link) but not ![text](link)
    // Negative lookbehind for ! is (?<!\!)
    const linkRegex = /(?<!\!)\[([^\]]+)\]\(([^)]+)\)/g;

    // Collect all matches first since we need async operations
    const matches: { fullMatch: string; linkPath: string; targetPath: string; }[] = [];
    let match;
    while ((match = linkRegex.exec(content)) !== null) {
        const linkPath = match[2];
        const targetPath = path.join(rootPath, linkPath);
        matches.push({ fullMatch: match[0], linkPath, targetPath });
    }

    // Process all matches and build replacements
    let result = content;
    for (const m of matches) {
        if (!await ws_exists(m.targetPath)) {
            throw new Error(`Referenced file not found: ${m.linkPath}`);
        }
        const fileContent = await ws_read_file(m.targetPath);
        const replacement = `\n<context_file path="${m.targetPath}" relative_path="${m.linkPath}">\n${fileContent}\n</context_file>\n`;
        result = result.replace(m.fullMatch, replacement);
    }

    return result;
}
/**
 * Finds the writer block (`<!-- p --> ... <!-- e -->`) containing the cursor position.
 *
 * This function scans the document for writer blocks and returns the one that contains
 * the specified position (or the current cursor position if not specified). Writer blocks
 * use the following structure:
 *
 * ```markdown
 * <!-- p -->
 * Human-written content (P section)
 * <!-- a -->
 * AI-generated content (A section)
 * <!-- e -->
 * ```
 *
 * The function extracts:
 * - **pContent**: The trimmed text between `<!-- p -->` and `<!-- a -->` tags
 * - **fullBlock**: The complete block text including all markers
 * - **range**: The VS Code Range covering the entire block for editing
 *
 * @param editor - The VS Code text editor containing the document to search
 * @param position - Optional specific position to check; defaults to current cursor position
 *
 * @returns A WriterContext object if a block is found at the position, undefined otherwise
 *
 * @example
 * const context = findWriterBlock(editor);
 * if (context) {
 *     console.log('P content:', context.pContent);
 *     console.log('Block range:', context.range.start.line, '-', context.range.end.line);
 * }
 */
export function findWriterBlock(editor: vscode.TextEditor, position?: vscode.Position): WriterContext | undefined {
    const text = editor.document.getText();
    const pos = position || editor.selection.active;
    const cursorOffset = editor.document.offsetAt(pos);

    // Regex to find blocks: <!-- p --> ... <!-- e -->
    // We use [^]*? to match across newlines non-greedily
    const regex = /<!--\s*p\s*-->([^]*?)<!--\s*e\s*-->/g;

    let match;
    while ((match = regex.exec(text)) !== null) {
        const start = match.index;
        const end = match.index + match[0].length;

        // Check if cursor is inside this block
        if (cursorOffset >= start && cursorOffset <= end) {
            const fullBlock = match[0];
            // Extract p content: from start to <!-- a -->
            const aTagMatch = /<!--\s*a\s*-->/.exec(fullBlock);
            if (aTagMatch) {
                // We want the text AFTER the p tag and BEFORE the a tag
                // The fullBlock starts with the p tag.
                // Let's find the end of the p tag.
                const pTagMatch = /^<!--\s*p\s*-->/.exec(fullBlock);
                if (pTagMatch) {
                    const pContent = fullBlock.substring(
                        pTagMatch[0].length,
                        aTagMatch.index
                    );

                    return {
                        pContent: pContent.trim(),
                        fullBlock,
                        range: new vscode.Range(
                            editor.document.positionAt(start),
                            editor.document.positionAt(end)
                        )
                    };
                }
            }
        }
    }
    return undefined;
}
/**
 * Permanently removes either P (human) or A (AI) sections from all markdown files in the workspace.
 *
 * This is a **destructive operation** that:
 * - Removes the specified section content entirely
 * - Removes all writer block markers (`<!-- p -->`, `<!-- a -->`, `<!-- e -->`)
 * - Keeps only the content from the opposite section type
 *
 * **WARNING**: This operation cannot be undone (except through version control).
 * A modal confirmation dialog is shown before proceeding.
 *
 * Use Cases:
 * - **Remove P, Keep A**: Finalize documents by discarding drafts and keeping polished AI output
 * - **Remove A, Keep P**: Revert to original human content, discarding all AI generations
 *
 * Block Structure Before:
 * ```markdown
 * <!-- p -->
 * Human draft content
 * <!-- a -->
 * AI generated content
 * <!-- e -->
 * ```
 *
 * After Remove P (Keep A): `AI generated content`
 * After Remove A (Keep P): `Human draft content`
 *
 * @param type - 'P' to remove human sections (keep AI), 'A' to remove AI sections (keep human)
 *
 * @remarks
 * - Processes all `.md` files in workspace (excluding node_modules)
 * - Shows progress notification during processing
 * - Auto-saves modified files
 * - Displays confirmation dialog before executing
 */
export async function removeSections(type: 'P' | 'A') {
    const action = type === 'P' ? 'Human (P)' : 'AI (A)';
    const keep = type === 'P' ? 'AI (A)' : 'Human (P)';

    const result = await vscode.window.showErrorMessage(
        `Are you sure you want to remove all ${action} content? This will keep only the ${keep} content and remove the markers. This cannot be undone.`,
        { modal: true },
        'Yes'
    );

    if (result !== 'Yes') {
        return;
    }

    const files = await vscode.workspace.findFiles('**/*.md', '**/node_modules/**');

    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: `Removing ${action} sections...`,
        cancellable: false
    }, async (progress) => {
        let processedCount = 0;
        for (const file of files) {
            try {
                const document = await vscode.workspace.openTextDocument(file);
                const text = document.getText();

                // Regex to find blocks: <!-- p --> ... <!-- a --> ... <!-- e -->
                const regex = /<!--\s*p\s*-->([^]*?)<!--\s*a\s*-->([^]*?)<!--\s*e\s*-->/g;

                let hasChanges = false;
                const newText = text.replace(regex, (_match, pContent, aContent) => {
                    hasChanges = true;
                    if (type === 'P') {
                        // Remove P, keep A
                        return aContent;
                    } else {
                        // Remove A, keep P
                        return pContent;
                    }
                });

                if (hasChanges) {
                    const edit = new vscode.WorkspaceEdit();
                    const fullRange = new vscode.Range(
                        document.positionAt(0),
                        document.positionAt(text.length)
                    );
                    edit.replace(file, fullRange, newText);
                    await vscode.workspace.applyEdit(edit);
                    await document.save();
                }
                processedCount++;
                progress.report({ message: `${processedCount}/${files.length}` });
            } catch (e) {
                console.error(`Failed to process ${file.fsPath}`, e);
            }
        }
    });
}
/**
 * Toggles the visibility of P (human) or A (AI) sections across all markdown files in the workspace.
 *
 * This function modifies HTML comment syntax to control how markdown renderers display sections:
 * - **Visible**: `<!-- p -->` or `<!-- a -->` (standard HTML comment tags)
 * - **Hidden**: `<!-- p -- >` or `<!-- a -- >` (broken tag syntax, rendered as visible text)
 *
 * When hiding one section type, the opposite section type is restored to visible.
 * This allows users to quickly toggle between viewing only human content or only AI content
 * in their markdown preview.
 *
 * **Hide P (Human) Sections:**
 * - `<!-- p -->` → `<!-- p -- >` (hidden)
 * - `<!-- a -- >` → `<!-- a -->` (restored)
 *
 * **Hide A (AI) Sections:**
 * - `<!-- a -->` → `<!-- a -- >` (hidden)
 * - `<!-- p -- >` → `<!-- p -->` (restored)
 *
 * @param type - 'P' to hide human sections (and show AI), 'A' to hide AI sections (and show human)
 *
 * @remarks
 * - Processes all `.md` files in workspace (excluding node_modules)
 * - Shows progress notification during processing
 * - Auto-saves modified files
 */
export async function hideSections(type: 'P' | 'A') {
    const action = type === 'P' ? 'Hide Human (P)' : 'Hide AI (A)';

    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: `${action} sections...`,
        cancellable: false
    }, async (progress) => {
        const files = await vscode.workspace.findFiles('**/*.md', '**/node_modules/**');
        let processedCount = 0;

        for (const file of files) {
            try {
                const document = await vscode.workspace.openTextDocument(file);
                const text = document.getText();
                let newText = text;

                if (type === 'P') {
                    // Hide P: <!-- p --> -> <!-- p -- >
                    // Restore A: <!-- a -- > -> <!-- a -->
                    newText = newText.replace(/<!--\s*p\s*-->/g, '<!-- p -- >');
                    newText = newText.replace(/<!--\s*a\s*--\s*>/g, '<!-- a -->');
                } else {
                    // Hide A: <!-- a --> -> <!-- a -- >
                    // Restore P: <!-- p -- > -> <!-- p -->
                    newText = newText.replace(/<!--\s*a\s*-->/g, '<!-- a -- >');
                    newText = newText.replace(/<!--\s*p\s*--\s*>/g, '<!-- p -->');
                }

                if (newText !== text) {
                    const edit = new vscode.WorkspaceEdit();
                    const fullRange = new vscode.Range(
                        document.positionAt(0),
                        document.positionAt(text.length)
                    );
                    edit.replace(file, fullRange, newText);
                    await vscode.workspace.applyEdit(edit);
                    await document.save();
                }
                processedCount++;
                progress.report({ message: `${processedCount}/${files.length}` });
            } catch (e) {
                console.error(`Failed to process ${file.fsPath}`, e);
            }
        }
    });
}

