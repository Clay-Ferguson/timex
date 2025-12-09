import * as vscode from 'vscode';
import * as path from 'path';
import * as crypto from 'crypto';
import { buildAttachmentIndex, editorHasOpenFiles, extractHashFromTimexFilename, generateFileHash, isImageFileName, TIMEX_LINK_REGEX } from './utils';
import { ws_exists } from './ws-file-util';
import { ws_write_file } from './ws-file-util';
import { ws_read_file } from './ws-file-util';
import { ws_rename } from './ws-file-util';

/**
 * Inserts an attachment (image or file) into the current markdown document at the cursor position.
 * 
 * This function implements a hash-based attachment management system that:
 * 1. Opens a file picker dialog for the user to select a file
 * 2. Generates a SHA-256 hash of the file content (first 128 bits as hex)
 * 3. Renames the file to include the TIMEX hash pattern: `name.TIMEX-{hash}.ext`
 * 4. Inserts a markdown link at the cursor position with the relative path
 * 
 * The hash-based naming allows the `fixLinks` command to repair broken links
 * when files are moved, as the hash serves as a unique identifier.
 * 
 * For image files (detected via extension), uses inline image syntax `![alt](path)`.
 * For other files, uses standard link syntax `[name](path)`.
 * 
 * @remarks
 * - Only works in markdown files
 * - Requires an active workspace folder
 * - If the file already has a TIMEX pattern in its name, it is used as-is
 * - The relative path is URL-encoded to handle spaces and special characters
 * - File paths are calculated relative to the markdown file's directory
 * 
 * @example
 * // User selects "screenshot.png"
 * // File is renamed to "screenshot.TIMEX-a3f5b2c8d9e1f4a7.png"
 * // Inserts: ![screenshot](screenshot.TIMEX-a3f5b2c8d9e1f4a7.png)
 * 
 * @returns {Promise<void>} Resolves when the attachment is inserted, or early returns on cancellation/error
 */
export async function insertAttachment() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showErrorMessage('No active editor found');
        return;
    }

    // Check if we're in a markdown file
    if (editor.document.languageId !== 'markdown') {
        vscode.window.showErrorMessage('This command only works in markdown files');
        return;
    }

    // Get the workspace folder
    if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
        vscode.window.showErrorMessage('No workspace folder found');
        return;
    }

    // Show file picker dialog
    const fileUris = await vscode.window.showOpenDialog({
        canSelectFiles: true,
        canSelectFolders: false,
        canSelectMany: false,
        openLabel: 'Select Attachment',
        title: 'Select File to Attach'
    });

    if (!fileUris || fileUris.length === 0) {
        // User cancelled
        return;
    }

    const selectedFileUri = fileUris[0];
    const selectedFilePath = selectedFileUri.fsPath;

    try {
        // Get the current markdown file's directory
        const markdownFilePath = editor.document.uri.fsPath;
        const markdownDir = path.dirname(markdownFilePath);

        // Get the filename
        const fileName = path.basename(selectedFilePath);
        const fileNameWithoutExt = path.parse(fileName).name;
        const fileExt = path.parse(fileName).ext;

        // Check if the file already has the TIMEX- pattern (name.TIMEX-hash.ext)
        let finalFilePath: string;
        let finalFileName: string;
        let displayName: string;

        // Check if filename matches pattern: *.TIMEX-{32 hex chars}.ext
        const hasTimexPattern = /\.TIMEX-[a-f0-9]{32}$/i.test(fileNameWithoutExt);

        if (hasTimexPattern) {
            // File already has TIMEX- pattern, use it as-is (hash is already correct)
            finalFilePath = selectedFilePath;
            finalFileName = fileName;
            // Remove .TIMEX-hash from display name
            displayName = fileNameWithoutExt.replace(/\.TIMEX-[a-f0-9]{32}$/i, '');
        } else {
            // File doesn't have TIMEX- pattern, generate hash and rename it
            const hash = await generateFileHash(selectedFilePath);
            // New format: name.TIMEX-hash.ext
            const newFileName = `${fileNameWithoutExt}.TIMEX-${hash}${fileExt}`;
            const newFilePath = path.join(path.dirname(selectedFilePath), newFileName);

            // Rename the file with the new naming convention
            await ws_rename(selectedFilePath, newFilePath);

            finalFilePath = newFilePath;
            finalFileName = newFileName;
            displayName = fileNameWithoutExt;
        }

        // Calculate relative path from markdown file to attachment
        const relativePath = path.relative(markdownDir, finalFilePath);
        const relativePathMarkdown = relativePath.split(path.sep).join('/');

        // URL-encode the path to handle spaces and special characters
        // Split by '/' to encode each segment separately, then rejoin
        const encodedPath = relativePathMarkdown.split('/').map(segment => encodeURIComponent(segment)).join('/');

        // Check if this is an image file to use inline image syntax
        const isImage = isImageFileName(finalFileName);
        const linkPrefix = isImage ? '!' : '';

        // Create markdown link with encoded URL (add ! prefix for images)
        const markdownLink = `${linkPrefix}[${displayName}](${encodedPath})`;

        // Insert link at cursor position
        const position = editor.selection.active;
        await editor.edit(editBuilder => {
            editBuilder.insert(position, markdownLink);
        });

        vscode.window.showInformationMessage(`Attachment inserted: ${finalFileName}`);

    } catch (error) {
        vscode.window.showErrorMessage(`Failed to insert image attachment: ${error}`);
    }
}

/**
 * Inserts a GUID-tracked link to another file in the workspace at the cursor position.
 * 
 * This function creates a special link format that allows the `fixLinks` command
 * to repair broken links when the target file is moved. The mechanism works by:
 * 1. Checking if the target file already has a GUID comment at the top
 * 2. If not, generating a new random GUID and prepending `<!-- GUID:{guid} -->` to the file
 * 3. Inserting a link with a TARGET-GUID comment: `<!-- TARGET-GUID:{guid} -->\n[filename](path)`
 * 
 * When files are moved, `fixLinks` can match the TARGET-GUID in the markdown file
 * with the GUID in the target file to update the path.
 * 
 * @remarks
 * - Only works in markdown files
 * - Requires an active workspace folder
 * - Modifies the target file to add a GUID comment if one doesn't exist
 * - The GUID is a 32-character hex string (128 bits of randomness)
 * - The link path is URL-encoded and relative to the markdown file's directory
 * 
 * @example
 * // User links to "docs/README.md"
 * // If README.md doesn't have a GUID, one is added: <!-- GUID:a1b2c3d4e5f6... -->
 * // Inserts into current file:
 * // <!-- TARGET-GUID:a1b2c3d4e5f6... -->
 * // [README.md](docs/README.md)
 * 
 * @returns {Promise<void>} Resolves when the link is inserted, or early returns on cancellation/error
 */
export async function insertFileLink() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showErrorMessage('No active editor found');
        return;
    }

    // Check if we're in a markdown file
    if (editor.document.languageId !== 'markdown') {
        vscode.window.showErrorMessage('This command only works in markdown files');
        return;
    }

    // Get the workspace folder
    if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
        vscode.window.showErrorMessage('No workspace folder found');
        return;
    }

    // Show file picker dialog
    const fileUris = await vscode.window.showOpenDialog({
        canSelectFiles: true,
        canSelectFolders: false,
        canSelectMany: false,
        openLabel: 'Select File to Link',
        title: 'Select File to Link'
    });

    if (!fileUris || fileUris.length === 0) {
        // User cancelled
        return;
    }

    const selectedFileUri = fileUris[0];
    const selectedFilePath = selectedFileUri.fsPath;

    try {
        // Get the current markdown file's directory
        const markdownFilePath = editor.document.uri.fsPath;
        const markdownDir = path.dirname(markdownFilePath);

        // Read the target file content
        let targetFileContent = await ws_read_file(selectedFilePath);
        
        // Check if the file already has a GUID
        // Format: <!-- GUID:<guid> -->
        const guidRegex = /<!-- GUID:([a-f0-9]{32}) -->/i;
        let match = targetFileContent.match(guidRegex);
        let guid: string;

        if (match) {
            // Found existing GUID
            guid = match[1];
        } else {
            // Generate new random GUID (32 hex chars)
            guid = crypto.randomBytes(16).toString('hex');
            
            // Prepend GUID to the file content
            const guidComment = `<!-- GUID:${guid} -->\n`;
            targetFileContent = guidComment + targetFileContent;
            
            // Write the updated content back to the file
            await ws_write_file(selectedFilePath, targetFileContent);
        }

        // Calculate relative path from markdown file to target file
        const relativePath = path.relative(markdownDir, selectedFilePath);
        const relativePathMarkdown = relativePath.split(path.sep).join('/');

        // URL-encode the path to handle spaces and special characters
        const encodedPath = relativePathMarkdown.split('/').map(segment => encodeURIComponent(segment)).join('/');

        // Get display name (filename without extension)
        const fileName = path.basename(selectedFilePath);
        // const displayName = path.parse(fileName).name; // User might prefer full filename or just name. Let's use full filename for clarity or name? 
        // The prompt example showed: [My Cool Markdown File](some/folder/my_cool_file.md)
        // I'll use the filename as the default display text.
        const displayName = fileName;

        // Create the link text with the TARGET-GUID comment
        // <!-- TARGET-GUID:<guid> -->
        // [Display Name](path)
        const linkText = `<!-- TARGET-GUID:${guid} -->\n[${displayName}](${encodedPath})`;

        // Insert link at cursor position
        const position = editor.selection.active;
        await editor.edit(editBuilder => {
            editBuilder.insert(position, linkText);
        });

        vscode.window.showInformationMessage(`File link inserted: ${fileName}`);

    } catch (error) {
        vscode.window.showErrorMessage(`Failed to insert file link: ${error}`);
        console.error('Insert file link error:', error);
    }
}

/**
 * Inserts an image directly from the system clipboard into the current markdown document.
 * 
 * This function reads binary image data from the clipboard using platform-specific
 * tools, saves it as a PNG file with a TIMEX hash in the filename, and inserts
 * a markdown image link at the cursor position.
 * 
 * The workflow is:
 * 1. Validates the editor is in a markdown file
 * 2. Reads image data from clipboard using platform-specific commands:
 *    - Linux: Uses `xclip -selection clipboard -t image/png -o`
 *    - macOS: Uses `pngpaste` (not currently implemented)
 *    - Windows: Not currently supported
 * 3. Prompts the user for a filename (without extension)
 * 4. Generates a SHA-256 hash of the image data
 * 5. Saves the image as `{userFilename}.TIMEX-{hash}.png` in the same directory
 * 6. Inserts `![](encoded-filename.png)` at the cursor position
 * 
 * @remarks
 * - Only works in markdown files
 * - Currently only supports Linux with xclip installed
 * - The image is always saved as PNG format
 * - The hash-based naming integrates with the `fixLinks` repair system
 * - The filename is URL-encoded to handle special characters
 * 
 * @example
 * // User copies an image to clipboard, runs command, enters "diagram" as filename
 * // Creates: diagram.TIMEX-abc123def456.png
 * // Inserts: ![](diagram.TIMEX-abc123def456.png)
 * 
 * @throws Shows error message if:
 *   - No active editor or not in markdown file
 *   - No image data in clipboard
 *   - Platform not supported
 *   - xclip not installed (Linux)
 * 
 * @returns {Promise<void>} Resolves when the image is saved and link inserted
 */
export async function insertImageFromClipboard() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showErrorMessage('No active editor found');
        return;
    }

    // Check if we're in a markdown file
    if (editor.document.languageId !== 'markdown') {
        vscode.window.showErrorMessage('This command only works in markdown files');
        return;
    }

    try {
        // Try to read image from clipboard using VS Code's built-in API
        // Note: VS Code API doesn't directly support reading binary image data from clipboard
        // We need to use a workaround by executing a paste command and detecting the result

        // For now, let's try a different approach: use the clipboard API that's available
        // Unfortunately, VS Code's clipboard API only supports text
        // We'll need to use a shell command to extract image data

        const markdownFilePath = editor.document.uri.fsPath;
        const markdownDir = path.dirname(markdownFilePath);

        // Try to get image from clipboard using platform-specific commands
        let imageBuffer: Buffer | null = null;
        const platform = process.platform;

        if (platform === 'linux') {
            // Use xclip to get image from clipboard
            try {
                const { execSync } = require('child_process');
                imageBuffer = execSync('xclip -selection clipboard -t image/png -o', { encoding: null });
            } catch (error) {
                vscode.window.showErrorMessage('No image found in clipboard. Make sure xclip is installed (sudo apt install xclip)');
                return;
            }
        } else {
            vscode.window.showErrorMessage('Clipboard image paste is not supported on this platform');
            return;
        }

        if (!imageBuffer || imageBuffer.length === 0) {
            vscode.window.showErrorMessage('No image data found in clipboard');
            return;
        }

        // Prompt user for the filename (without extension)
        const userEnteredName = await vscode.window.showInputBox({
            placeHolder: 'Enter filename for the image',
            prompt: 'Filename (without extension - .TIMEX-hash.png will be added automatically)',
            value: 'img',
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

        if (!userEnteredName) {
            // User cancelled the input
            return;
        }

        // Generate hash of the image data
        const hash = crypto.createHash('sha256').update(imageBuffer).digest('hex').substring(0, 32);

        // Create filename with TIMEX pattern using user's input
        const fileName = `${userEnteredName.trim()}.TIMEX-${hash}.png`;
        const filePath = path.join(markdownDir, fileName);

        // Save the image file
        await ws_write_file(filePath, imageBuffer);

        // Calculate relative path (in this case, it's just the filename since it's in the same directory)
        const relativePath = fileName;

        // URL-encode the path to handle spaces and special characters
        const encodedPath = encodeURIComponent(relativePath);

        // Create markdown link for image (with ! prefix)
        const markdownLink = `![](${encodedPath})`;

        // Insert link at cursor position
        const position = editor.selection.active;
        await editor.edit(editBuilder => {
            editBuilder.insert(position, markdownLink);
        });

        vscode.window.showInformationMessage(`Image inserted from clipboard: ${fileName}`);

    } catch (error) {
        vscode.window.showErrorMessage(`Failed to insert image from clipboard: ${error}`);
        console.error('Insert image from clipboard error:', error);
    }
}

/**
 * Scans all markdown files in the workspace and repairs broken links to attachments and files.
 * 
 * This command is the repair mechanism for the hash-based attachment management system.
 * It handles two types of links:
 * 
 * **1. TIMEX Attachments (images/files)**
 * - Pattern: `![alt](path/file.TIMEX-{hash}.ext)` or `[text](path/file.TIMEX-{hash}.ext)`
 * - Repair: Extracts hash from broken link, searches for file with matching hash anywhere
 *   in the workspace, updates the path to the new location
 * 
 * **2. GUID-tracked File Links**
 * - Pattern: `<!-- TARGET-GUID:{guid} -->\n[text](path)`
 * - Repair: Finds the file containing `<!-- GUID:{guid} -->` and updates the link path
 * 
 * **Orphan Detection:**
 * After scanning, identifies TIMEX-pattern files that are not referenced by any markdown
 * file and renames them with an "ORPHAN-" prefix for easy cleanup.
 * 
 * @remarks
 * - Requires no open files with unsaved changes (to avoid conflicts with auto-save)
 * - Uses the configured `timex.excludeGlobs` setting to skip directories
 * - Processes files in chunks for performance (50 files at a time for GUID indexing)
 * - Shows progress notification during the operation
 * - Reports statistics: links fixed, files modified, orphans found, missing targets
 * 
 * **Algorithm:**
 * 1. Build attachment index: Map of hash → file path for all TIMEX-pattern files
 * 2. Build GUID index: Map of GUID → file path for all files with GUID comments
 * 3. Scan each markdown file for broken TIMEX and TARGET-GUID links
 * 4. Track all referenced hashes to identify orphans
 * 5. For each broken link, look up the hash/GUID in the index and update the path
 * 6. Rename unreferenced TIMEX files with "ORPHAN-" prefix
 * 7. Report results to user
 * 
 * @example
 * // File moved from "images/screenshot.TIMEX-abc123.png" to "assets/screenshot.TIMEX-abc123.png"
 * // Markdown has: ![](images/screenshot.TIMEX-abc123.png) (broken)
 * // After fixLinks: ![](assets/screenshot.TIMEX-abc123.png) (fixed)
 * 
 * @returns {Promise<void>} Resolves when all links are processed and results are shown
 */
export async function fixLinks() {

    // Check if user has any open files to avoid conflicts with auto-save
    if (editorHasOpenFiles('Fix Links')) {
        return;
    }

    if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
        vscode.window.showErrorMessage('No workspace folder found');
        return;
    }
    let folderPath = vscode.workspace.workspaceFolders[0].uri.fsPath;

    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'Fixing Links',
        cancellable: false
    }, async (progress) => {
        try {
            progress.report({ increment: 0, message: 'Building attachment index...' });

            // Build index of all TIMEX- pattern files in the folder
            const config = vscode.workspace.getConfiguration('timex');
            const excludeGlobsArray = config.get<string[]>('excludeGlobs', []);
            const excludePattern = excludeGlobsArray.length > 0 ? `{${excludeGlobsArray.join(',')}}` : undefined;

            const attachmentIndex = await buildAttachmentIndex(folderPath, excludePattern);

            progress.report({ increment: 10, message: 'Building file GUID index...' });
            
            // Build index of files with GUIDs
            const fileGuidIndex = new Map<string, string>(); // GUID -> Full Path
            // We need to scan all files (except excluded) for <!-- GUID:<guid> -->
            // Since we can't easily use findTextInFiles with regex capture in API, we'll iterate files
            // But iterating all files is slow. Let's try to use findFiles and read them.
            // To be safe, we'll scan files that are likely to be targets. 
            // Since the user can link ANY file, we should ideally scan everything not excluded.
            // However, for performance, let's start with a broad pattern but respect excludes.
            const allFiles = await vscode.workspace.findFiles('**/*', excludePattern);
            
            // We'll process files in chunks to avoid blocking too much
            const chunkSize = 50;
            for (let i = 0; i < allFiles.length; i += chunkSize) {
                const chunk = allFiles.slice(i, i + chunkSize);
                await Promise.all(chunk.map(async (fileUri) => {
                    try {
                        // Read first 1KB of file to check for GUID (it should be at the top)
                        // We don't need to read the whole file if the GUID is at the top
                        const fileData = await vscode.workspace.fs.readFile(fileUri);
                        // Decode only the beginning
                        const content = new TextDecoder().decode(fileData.slice(0, 1024));
                        const guidMatch = content.match(/<!-- GUID:([a-f0-9]{32}) -->/i);
                        if (guidMatch) {
                            const guid = guidMatch[1].toLowerCase();
                            fileGuidIndex.set(guid, fileUri.fsPath);
                        }
                    } catch (e) {
                        // Ignore read errors (e.g. binary files that might fail decoding or permission issues)
                    }
                }));
            }

            progress.report({ increment: 20, message: `Found ${attachmentIndex.size} attachments and ${fileGuidIndex.size} linked files. Scanning markdown files...` });

            // Find all markdown files in the folder
            const pattern = new vscode.RelativePattern(folderPath, '**/*.md');
            const mdFiles = await vscode.workspace.findFiles(pattern, excludePattern);

            progress.report({ increment: 10, message: `Processing ${mdFiles.length} markdown files...` });

            let totalLinksFixed = 0;
            let totalFilesModified = 0;
            const missingAttachments: string[] = [];
            const referencedHashes = new Set<string>(); // Track which attachments are referenced
            const progressIncrement = mdFiles.length > 0 ? 60 / mdFiles.length : 60;

            // Process each markdown file
            for (const mdFileUri of mdFiles) {
                const mdFilePath = mdFileUri.fsPath;
                const mdFileDir = path.dirname(mdFilePath);

                let content = await ws_read_file(mdFilePath);
                let modified = false;
                let linksFixedInFile = 0;

                const replacements: { start: number, end: number, newText: string }[] = [];

                // 1. Fix TIMEX- pattern links (Images/Attachments)
                const matches = Array.from(content.matchAll(TIMEX_LINK_REGEX));

                for (const match of matches) {
                    const fullMatch = match[0];
                    const linkUrl = match[3]; // Group 3 is the URL part in TIMEX_LINK_REGEX
                    
                    // Decode URL in case it's encoded
                    const decodedUrl = decodeURIComponent(linkUrl);

                    // Extract hash to track referenced attachments
                    const hash = extractHashFromTimexFilename(decodedUrl);
                    if (hash) {
                        referencedHashes.add(hash.toLowerCase());
                    }

                    // Resolve the link relative to the markdown file
                    const absoluteLinkPath = path.resolve(mdFileDir, decodedUrl);

                    // Check if file exists
                    if (await ws_exists(absoluteLinkPath)) {
                        // Link is not broken, leave it as-is
                        continue;
                    }

                    // Link is broken - try to fix it using hash
                    if (!hash) {
                        // Can't extract hash, skip
                        console.warn(`Could not extract hash from link: ${linkUrl}`);
                        continue;
                    }

                    // Look up the hash in our attachment index
                    const attachmentInfo = attachmentIndex.get(hash.toLowerCase());
                    if (!attachmentInfo) {
                        // Attachment not found anywhere in the folder
                        if (!missingAttachments.includes(decodedUrl)) {
                            missingAttachments.push(decodedUrl);
                            console.warn(`Missing attachment: ${decodedUrl} (hash: ${hash})`);
                        }
                        continue;
                    }

                    // Calculate new relative path
                    const newRelativePath = path.relative(mdFileDir, attachmentInfo.fullPath);
                    const newRelativePathMarkdown = newRelativePath.split(path.sep).join('/');

                    // URL-encode the path
                    const encodedPath = newRelativePathMarkdown.split('/').map(segment => encodeURIComponent(segment)).join('/');

                    // Preserve the ! prefix if it's an image
                    const isImage = fullMatch.startsWith('!');
                    const prefix = isImage ? '!' : '';

                    // Build the new link
                    const newLink = `${prefix}[](${encodedPath})`;

                    replacements.push({
                        start: match.index!,
                        end: match.index! + fullMatch.length,
                        newText: newLink
                    });
                }

                // 2. Fix TARGET-GUID pattern links (File Links)
                // Regex to find <!-- TARGET-GUID:<guid> --> followed by a link
                // We look for the comment, optional whitespace/newlines, then the link
                // Relaxed regex to allow spaces in comment
                const targetGuidRegex = /<!--\s*TARGET-GUID:([a-f0-9]{32})\s*-->(\s*)\[([^\]]*)\]\(([^)]*)\)/g;
                const guidMatches = Array.from(content.matchAll(targetGuidRegex));


                // Debug: Check if we have the tag but missed the full match
                if (guidMatches.length === 0 && content.includes('TARGET-GUID:')) {
                    const tagIndex = content.indexOf('TARGET-GUID:');
                    const start = Math.max(0, tagIndex - 20);
                    const end = Math.min(content.length, tagIndex + 100);
                }

                for (const match of guidMatches) {
                    const fullMatch = match[0];
                    const guid = match[1];
                    const whitespace = match[2];
                    const linkText = match[3];
                    const linkUrl = match[4];

                    const decodedUrl = decodeURIComponent(linkUrl);
                    const absoluteLinkPath = path.resolve(mdFileDir, decodedUrl);
                    const exists = await ws_exists(absoluteLinkPath);

                    // Check if file exists at current link path
                    if (exists) {
                        continue;
                    }

                    // Link is broken, look up GUID
                    const targetPath = fileGuidIndex.get(guid.toLowerCase());
                    
                    if (!targetPath) {
                        if (!missingAttachments.includes(decodedUrl)) {
                            missingAttachments.push(decodedUrl);
                            console.warn(`Missing target file for GUID: ${guid}`);
                        }
                        continue;
                    }

                    // Calculate new relative path
                    const newRelativePath = path.relative(mdFileDir, targetPath);
                    const newRelativePathMarkdown = newRelativePath.split(path.sep).join('/');
                    const encodedPath = newRelativePathMarkdown.split('/').map(segment => encodeURIComponent(segment)).join('/');

                    // Reconstruct the link
                    const newLinkBlock = `<!-- TARGET-GUID:${guid} -->${whitespace}[${linkText}](${encodedPath})`;

                    replacements.push({
                        start: match.index!,
                        end: match.index! + fullMatch.length,
                        newText: newLinkBlock
                    });
                }

                // Apply replacements from end to start to avoid index shifting
                if (replacements.length > 0) {
                    // Sort by start index descending
                    replacements.sort((a, b) => b.start - a.start);
                    
                    // Check for overlaps (shouldn't happen if regexes are distinct, but good practice)
                    let lastStart = content.length;
                    
                    for (const rep of replacements) {
                        if (rep.end <= lastStart) {
                            content = content.substring(0, rep.start) + rep.newText + content.substring(rep.end);
                            lastStart = rep.start;
                        }
                    }
                    
                    modified = true;
                    linksFixedInFile = replacements.length;
                }

                // Write back if modified
                if (modified) {
                    await ws_write_file(mdFilePath, content);
                    totalLinksFixed += linksFixedInFile;
                    totalFilesModified++;
                    console.log(`Fixed ${linksFixedInFile} link(s) in ${path.basename(mdFilePath)}`);
                }

                progress.report({ increment: progressIncrement });
            }

            progress.report({ increment: 10, message: 'Detecting orphaned attachments...' });

            // Identify and rename orphaned attachments
            let orphansFound = 0;
            for (const [hash, attachmentInfo] of attachmentIndex.entries()) {
                // If this hash was not referenced in any markdown file, it's an orphan
                if (!referencedHashes.has(hash)) {
                    const fileName = path.basename(attachmentInfo.fullPath);

                    // Check if file is already marked as orphan
                    if (!fileName.startsWith('ORPHAN-')) {
                        // Rename to add ORPHAN- prefix
                        const dirPath = path.dirname(attachmentInfo.fullPath);
                        const newFileName = `ORPHAN-${fileName}`;
                        const newFilePath = path.join(dirPath, newFileName);

                        try {
                            await ws_rename(attachmentInfo.fullPath, newFilePath);
                            orphansFound++;
                            console.log(`Marked as orphan: ${fileName} -> ${newFileName}`);
                        } catch (error) {
                            console.error(`Failed to rename orphan ${fileName}:`, error);
                        }
                    } else {
                        // Already marked as orphan, just count it
                        orphansFound++;
                    }
                }
            }

            progress.report({ increment: 10, message: 'Complete!' });

            // Show results to user
            let message = `Fixed ${totalLinksFixed} link(s) in ${totalFilesModified} file(s)`;
            if (orphansFound > 0) {
                message += `\nFound ${orphansFound} orphaned attachment(s)`;
            }

            if (missingAttachments.length > 0) {
                message += `\n\nWarning: ${missingAttachments.length} target(s) could not be found:`;
                missingAttachments.forEach(att => {
                    message += `\n  - ${att}`;
                    console.warn(`Missing target: ${att}`);
                });
                vscode.window.showWarningMessage(message, { modal: false });
            } else if (totalLinksFixed > 0) {
                vscode.window.showInformationMessage(message);
            } else {
                vscode.window.showInformationMessage('No broken links found');
            }

        } catch (error: any) {
            const message = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Failed to fix links: ${message}`);
            console.error('Fix links error:', error);
        }
    });
}