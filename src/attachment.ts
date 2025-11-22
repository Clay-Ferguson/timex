import * as vscode from 'vscode';
import * as path from 'path';
import * as crypto from 'crypto';
import { buildAttachmentIndex, extractHashFromTimexFilename, generateFileHash, isImageFileName, TIMEX_LINK_REGEX, ws_rename, ws_read_file, ws_write_file, ws_exists } from './utils';

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
        vscode.window.showErrorMessage(`Failed to insert attachment: ${error}`);
    }
}

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

export async function fixAttachmentLinks(uri: vscode.Uri) {
    if (!uri) {
        vscode.window.showErrorMessage('No file or folder selected');
        return;
    }

    if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
        vscode.window.showErrorMessage('No workspace folder found');
        return;
    }
    let folderPath = vscode.workspace.workspaceFolders[0].uri.fsPath;

    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'Fixing Attachment Links',
        cancellable: false
    }, async (progress) => {
        try {
            progress.report({ increment: 0, message: 'Building attachment index...' });

            // Build index of all TIMEX- pattern files in the folder
            const config = vscode.workspace.getConfiguration('timex');
            const excludeGlobsArray = config.get<string[]>('excludeGlobs', []);
            const excludePattern = excludeGlobsArray.length > 0 ? `{${excludeGlobsArray.join(',')}}` : undefined;

            const attachmentIndex = await buildAttachmentIndex(folderPath, excludePattern);

            progress.report({ increment: 20, message: `Found ${attachmentIndex.size} attachments. Scanning markdown files...` });

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

                // Find all TIMEX- pattern links in the file
                const replacements: { start: number, end: number, newText: string }[] = [];
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

                // Apply replacements from end to start to avoid index shifting
                if (replacements.length > 0) {
                    replacements.sort((a, b) => b.start - a.start);
                    
                    for (const rep of replacements) {
                        content = content.substring(0, rep.start) + rep.newText + content.substring(rep.end);
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
            let message = `Fixed ${totalLinksFixed} attachment link(s) in ${totalFilesModified} file(s)`;
            if (orphansFound > 0) {
                message += `\nFound ${orphansFound} orphaned attachment(s)`;
            }

            if (missingAttachments.length > 0) {
                message += `\n\nWarning: ${missingAttachments.length} attachment(s) could not be found:`;
                missingAttachments.forEach(att => {
                    message += `\n  - ${att}`;
                    console.warn(`Missing attachment: ${att}`);
                });
                vscode.window.showWarningMessage(message, { modal: false });
            } else if (totalLinksFixed > 0) {
                vscode.window.showInformationMessage(message);
            } else {
                vscode.window.showInformationMessage('No broken attachment links found');
            }

        } catch (error: any) {
            const message = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Failed to fix attachment links: ${message}`);
            console.error('Fix attachment links error:', error);
        }
    });
}