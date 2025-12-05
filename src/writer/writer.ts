import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { ws_exists, ws_read_file, ws_write_file } from '../ws-file-util';

const PARTICIPANT_ID = 'timex.writer';

interface WriterContext {
    pContent: string;
    fullBlock: string;
    range: vscode.Range;
}

/**
 * Activates the AI Writer functionality within Timex extension
 */
export function activateWriter(context: vscode.ExtensionContext) {
    console.log('AI Writer is active');

    // 1. Register the Chat Participant
    const handler: vscode.ChatRequestHandler = async (request: vscode.ChatRequest, chatContext: vscode.ChatContext, stream: vscode.ChatResponseStream, token: vscode.CancellationToken) => {
        // Handle /verify command
        if (request.command === 'verify') {
            await handleVerifyCommand(stream, token);
            return;
        }

        // Handle /fill command (generate from draft)
        if (request.command === 'fill') {
            await handleFillCommand('draft', context, request, stream, token);
            return;
        }

        // Handle /fill-outline command (generate from outline)
        if (request.command === 'fill-outline') {
            await handleFillCommand('outline', context, request, stream, token);
            return;
        }

        // No command specified - handle as normal conversation
        await handleConversation(request, chatContext, stream, token);
    };

    const writer = vscode.chat.createChatParticipant(PARTICIPANT_ID, handler);
    writer.iconPath = new vscode.ThemeIcon('pencil');
    context.subscriptions.push(writer);

    // 2. Register the Insert Command (triggered by the button)
    context.subscriptions.push(
        vscode.commands.registerCommand('timex.writerInsertResponse', async (range: vscode.Range, text: string) => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                return;
            }

            // Re-find the block based on the start position. 
            // This handles cases where the block content has changed (e.g. expanded) since the request was made.
            const writerContext = findWriterBlock(editor, range.start);

            if (writerContext) {
                const { fullBlock, range: currentRange } = writerContext;

                // Replace the content between <!-- a --> and <!-- e -->
                // We use a function replacer to avoid issues with special characters in 'text'
                const newBlockContent = fullBlock.replace(
                    /(<!--\s*a\s*-->)([^]*?)(<!--\s*e\s*-->)/,
                    (_match, startTag, _content, endTag) => {
                        return startTag + '\n' + text + '\n' + endTag;
                    }
                );

                if (newBlockContent !== fullBlock) {
                    await editor.edit(editBuilder => {
                        editBuilder.replace(currentRange, newBlockContent);
                    });
                }
            } else {
                // Fallback: If we can't find the block, try to insert at the cursor or warn
                vscode.window.showWarningMessage('Could not locate the Writer block. Content inserted at cursor.');
                editor.edit(b => b.insert(editor.selection.active, text));
            }
        })
    );

    // 3. Register Command to Insert Template
    context.subscriptions.push(
        vscode.commands.registerCommand('timex.writerInsertTemplate', () => {
            const editor = vscode.window.activeTextEditor;
            if (editor) {
                const snippet = new vscode.SnippetString(
                    '<!-- p -->\n$1\n<!-- a -->\n\n<!-- e -->'
                );
                editor.insertSnippet(snippet);
            }
        })
    );

    // 4. Register Command to Generate from Draft (Trigger Chat with /fill command)
    context.subscriptions.push(
        vscode.commands.registerCommand('timex.writerGenerateFromDraft', () => {
            vscode.commands.executeCommand('workbench.action.chat.open', { query: '@writer /fill' });
        })
    );

    // 5. Register Command to Generate from Outline (Trigger Chat with fill-outline command)
    context.subscriptions.push(
        vscode.commands.registerCommand('timex.writerGenerateFromOutline', () => {
            vscode.commands.executeCommand('workbench.action.chat.open', { query: '@writer /fill-outline' });
        })
    );

    // 6. Register Command to Verify
    context.subscriptions.push(
        vscode.commands.registerCommand('timex.writerVerify', () => {
            vscode.commands.executeCommand('workbench.action.chat.open', { query: '@writer /verify' });
        })
    );

    // 7. Register Commands to Remove Sections
    context.subscriptions.push(
        vscode.commands.registerCommand('timex.writerRemovePSections', () => removeSections('P'))
    );
    context.subscriptions.push(
        vscode.commands.registerCommand('timex.writerRemoveASections', () => removeSections('A'))
    );

    // 8. Register Commands to Hide Sections
    context.subscriptions.push(
        vscode.commands.registerCommand('timex.writerHidePSections', () => hideSections('P'))
    );
    context.subscriptions.push(
        vscode.commands.registerCommand('timex.writerHideASections', () => hideSections('A'))
    );

    // 9. Register Command to Add File to Context
    context.subscriptions.push(
        vscode.commands.registerCommand('timex.writerAddToContext', addFileToContext)
    );
}

// Handler for normal conversation (no command)
async function handleConversation(
    request: vscode.ChatRequest,
    _context: vscode.ChatContext,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken
) {
    // Simple conversational response using the LLM
    const messages = [
        vscode.LanguageModelChatMessage.User(
            `You are AI Writer, a collaborative AI writing assistant. You help users with their writing tasks using a special HTML comment syntax (<!-- p --> for human input, <!-- a --> for AI output, <!-- e --> for block end). Answer the user's question conversationally and helpfully. If they ask about your capabilities, explain that you can help generate content using the /fill command (for drafts) or /fill-outline command (for outlines), and /verify to check AI output against the original draft.\n\nUser's message: ${request.prompt}`
        )
    ];

    try {
        const models = await vscode.lm.selectChatModels({ family: 'gpt-4' });
        const model = models[0] || (await vscode.lm.selectChatModels({}))[0];

        if (!model) {
            stream.markdown('Error: No Language Model available.');
            return;
        }

        const chatResponse = await model.sendRequest(messages, {}, token);

        for await (const fragment of chatResponse.text) {
            stream.markdown(fragment);
        }
    } catch (err) {
        if (err instanceof Error) {
            stream.markdown(`Error: ${err.message}`);
        }
    }
}

// Handler for /fill and /fill-outline commands
async function handleFillCommand(
    promptType: 'draft' | 'outline',
    extensionContext: vscode.ExtensionContext,
    request: vscode.ChatRequest,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken
) {
    const promptFileName = promptType === 'outline'
        ? 'AI-WRITER-GEN-FROM-OUTLINE.md'
        : 'AI-WRITER-GEN-FROM-DRAFT.md';

    // 1. Determine System Prompt
    // Check for prompt file in the workspace root (Override)
    let systemPrompt = '';
    const workspaceFolders = vscode.workspace.workspaceFolders;
    let rootPath = '';
    if (workspaceFolders && workspaceFolders.length > 0) {
        rootPath = workspaceFolders[0].uri.fsPath;
        const customPromptPath = path.join(rootPath, promptFileName);
        if (await ws_exists(customPromptPath)) {
            try {
                systemPrompt = await ws_read_file(customPromptPath);
                stream.markdown(`*Loaded custom system prompt from ${promptFileName}*\n\n`);
            } catch (err) {
                console.error('Error reading custom prompt file:', err);
                stream.markdown(`*Warning: Found ${promptFileName} but could not read it. Falling back to default.*\n\n`);
            }
        }
    }

    // If no custom prompt loaded, load the default
    if (!systemPrompt) {
        const promptPath = path.join(extensionContext.extensionPath, 'out', 'writer', 'prompts', promptFileName);
        try {
            systemPrompt = fs.readFileSync(promptPath, 'utf-8');
        } catch (err) {
            console.error('Error reading prompt file:', err);
            stream.markdown(`Error: Could not load system prompt (${promptFileName}).`);
            return;
        }
    }

    // Check for AI-WRITER-CONTEXT.md in the workspace root (Append)
    if (rootPath) {
        const contextFilePath = path.join(rootPath, 'AI-WRITER-CONTEXT.md');

        if (await ws_exists(contextFilePath)) {
            try {
                const contextContent = await processContextFile(contextFilePath, rootPath);
                if (contextContent.trim()) {
                    systemPrompt += `\n\n**Additional Context:**\n${contextContent}`;
                    stream.markdown(`*Loaded custom context from AI-WRITER-CONTEXT.md*\n\n`);
                }
            } catch (err) {
                if (err instanceof Error) {
                    stream.markdown(`Error processing AI-WRITER-CONTEXT.md: ${err.message}`);
                } else {
                    stream.markdown(`Error processing AI-WRITER-CONTEXT.md`);
                }
                return; // Stop execution if context processing fails
            }
        }
    }

    // Check for AI-WRITER-ROLE.md in the workspace root (Append)
    if (rootPath) {
        const roleFilePath = path.join(rootPath, 'AI-WRITER-ROLE.md');

        if (await ws_exists(roleFilePath)) {
            try {
                const roleContent = await ws_read_file(roleFilePath);
                if (roleContent.trim()) {
                    systemPrompt += `\n\n**Additional Role/Persona Instructions:**\n${roleContent}`;
                    stream.markdown(`*Loaded custom role from AI-WRITER-ROLE.md*\n\n`);
                }
            } catch (err) {
                console.error('Error reading role file:', err);
                stream.markdown(`*Warning: Found AI-WRITER-ROLE.md but could not read it.*\n\n`);
            }
        }
    }

    // Determine the user content (from chat or editor)
    let promptContent = "";
    let editorContext: WriterContext | undefined;

    // If the user didn't type much, or explicitly asked to read the file, check the editor
    const editor = vscode.window.activeTextEditor;
    if (editor) {
        editorContext = findWriterBlock(editor);

        // If no block found, check if we can create one from selection
        if (!editorContext) {
            const selection = editor.selection;
            const selectedText = editor.document.getText(selection);

            if (selectedText.trim()) {
                const replacement = `<!-- p -->\n${selectedText}\n<!-- a -->\n<!-- e -->`;

                await editor.edit(editBuilder => {
                    editBuilder.replace(selection, replacement);
                });

                // Re-scan for the block (it should be where the cursor is now)
                editorContext = findWriterBlock(editor);
            }
        }

        if (editorContext) {
            // If we found a block, we append it to the user's prompt (or use it as the prompt)
            promptContent = `${promptContent}\n${editorContext.pContent}`;
            stream.markdown(`*Processing block at line ${editorContext.range.start.line + 1}...*\n\n`);
        }
    }

    if (!promptContent.trim()) {
        stream.markdown('Please provide a prompt or place your cursor inside a `<!-- p --> ... <!-- e -->` block.');
        return;
    }

    let prompt = systemPrompt;

    // If the user entered something in the chat window as a chat message to the '@writer' participant, we can include that as well
    if (request.prompt && request.prompt.trim()) {
        prompt += `\nHere is some initial meta-prompt text for you to consider which the user included to help you with your draft:\n<meta-prompt>${request.prompt.trim()}</meta-prompt>\n`;
    }
    prompt += "\n<content>\n" + promptContent + "\n</content>\n";

    console.log('Final Prompt Sent to LM:', prompt);

    // Construct the messages with system prompt properly integrated
    const messages = [
        vscode.LanguageModelChatMessage.User(prompt)
    ];

    try {
        const models = await vscode.lm.selectChatModels({ family: 'gpt-4' });
        const model = models[0] || (await vscode.lm.selectChatModels({}))[0];

        if (!model) {
            stream.markdown('Error: No Language Model available.');
            return;
        }

        const chatResponse = await model.sendRequest(messages, {}, token);

        let fullResponse = '';
        for await (const fragment of chatResponse.text) {
            fullResponse += fragment;
            stream.markdown(fragment);
        }

        // If we have editor context, offer to insert the result
        if (editorContext) {
            stream.markdown('\n\n');
            const button = {
                title: 'Insert into Document',
                command: 'timex.writerInsertResponse',
                arguments: [editorContext.range, fullResponse]
            };
            stream.button(button);
        }

    } catch (err) {
        if (err instanceof Error) {
            stream.markdown(`Error: ${err.message}`);
        }
    }
}

async function handleVerifyCommand(stream: vscode.ChatResponseStream, token: vscode.CancellationToken) {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        stream.markdown('Please open a file to verify.');
        return;
    }

    const editorContext = findWriterBlock(editor);
    if (!editorContext) {
        stream.markdown('Please place your cursor inside a `<!-- p --> ... <!-- e -->` block to verify.');
        return;
    }

    const verifyPrompt = `
You are a verification assistant. Your task is to compare the "P" (Paragraph/Draft) section and the "A" (AI Generated) section in the provided text block.
Check if any important details, concepts, items, statements, or facts present in the "P" section were omitted from the "A" section.

If the "A" section contains all relevant information from the "P" section, simply state: "A section is complete. No missing details were found."
Otherwise, provide a bulleted list of the missing details.

Here is the content to verify:
${editorContext.fullBlock}
`;
    const messages = [vscode.LanguageModelChatMessage.User(verifyPrompt)];

    try {
        const models = await vscode.lm.selectChatModels({ family: 'gpt-4' });
        const model = models[0] || (await vscode.lm.selectChatModels({}))[0];
        if (!model) {
            stream.markdown('Error: No Language Model available.');
            return;
        }
        const chatResponse = await model.sendRequest(messages, {}, token);
        for await (const fragment of chatResponse.text) {
            stream.markdown(fragment);
        }
    } catch (err) {
        if (err instanceof Error) {
            stream.markdown(`Error: ${err.message}`);
        }
    }
}

async function hideSections(type: 'P' | 'A') {
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

async function removeSections(type: 'P' | 'A') {
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

function findWriterBlock(editor: vscode.TextEditor, position?: vscode.Position): WriterContext | undefined {
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

async function processContextFile(filePath: string, rootPath: string): Promise<string> {
    const content = await ws_read_file(filePath);
    // Match [text](link) but not ![text](link)
    // Negative lookbehind for ! is (?<!\!)
    const linkRegex = /(?<!\!)\[([^\]]+)\]\(([^)]+)\)/g;

    // Collect all matches first since we need async operations
    const matches: { fullMatch: string; linkPath: string; targetPath: string }[] = [];
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
        const replacement = `\n<context_file path="${m.linkPath}">\n${fileContent}\n</context_file>\n`;
        result = result.replace(m.fullMatch, replacement);
    }

    return result;
}

async function addFileToContext(uri: vscode.Uri) {
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
}
