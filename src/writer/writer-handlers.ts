import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { ws_exists, ws_read_file } from '../ws-file-util';
import { findWriterBlock, processContextFile } from './writer-utils';
import { WriterContext } from './writer';

/**
 * Handles normal conversational interactions with the @writer chat participant when no specific command is specified.
 *
 * This function processes free-form user messages sent to the @writer participant without using
 * slash commands like /draft, /outline, or /verify. It loads the conversation prompt template
 * (either from workspace override or default extension prompts) and sends the user's message
 * to the language model for a conversational response.
 *
 * Prompt Loading Priority:
 * 1. Checks for `AI-WRITER-CONVERSATION.md` in workspace root (custom override)
 * 2. Falls back to bundled default prompt in `out/writer/prompts/AI-WRITER-CONVERSATION.md`
 *
 * The prompt template should contain a `{USER_MESSAGE}` placeholder that gets replaced with
 * the actual user input.
 *
 * @param extensionContext - The VS Code extension context for accessing extension resources (prompt files)
 * @param request - The chat request containing the user's prompt message
 * @param _context - The chat context (unused but required by handler signature)
 * @param stream - The response stream for sending markdown content back to the chat UI
 * @param token - Cancellation token for aborting long-running operations
 *
 * @throws Displays error message in stream if prompt file cannot be loaded or LLM fails
 */
export async function handleConversation(
    extensionContext: vscode.ExtensionContext,
    request: vscode.ChatRequest,
    _context: vscode.ChatContext,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken) {
    // Load prompt from file
    const promptFileName = 'AI-WRITER-CONVERSATION.md';
    let systemPrompt = '';

    // Check for prompt file in the workspace root (Override)
    const workspaceFolders = vscode.workspace.workspaceFolders;
    let rootPath = '';
    if (workspaceFolders && workspaceFolders.length > 0) {
        rootPath = workspaceFolders[0].uri.fsPath;
        const customPromptPath = path.join(rootPath, promptFileName);
        if (await ws_exists(customPromptPath)) {
            try {
                systemPrompt = await ws_read_file(customPromptPath);
            } catch (err) {
                console.error('Error reading custom prompt file:', err);
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
                    stream.markdown(`*Loaded custom context from AI-WRITER-CONTEXT.md (embedding any linked files inline)*\n\n`);
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

    // Inject Workspace Root Information
    if (rootPath) {
        systemPrompt += `\n\n**Workspace Information:**\nWorkspace Root: ${rootPath}\nIMPORTANT: When using tools to read or edit files, ALWAYS use the absolute path. You can construct it by joining the Workspace Root with the relative path.`;
    }

    // Prepare the messages array
    const messages: vscode.LanguageModelChatMessage[] = [];

    // 1. Add System Prompt (Instructions)
    // We replace the placeholder with a generic instruction since we are appending the actual conversation
    const instructions = systemPrompt.replace('{USER_MESSAGE}', 'Please engage in the following conversation.');
    messages.push(vscode.LanguageModelChatMessage.User(instructions));

    // 2. Append Conversation History
    for (const turn of _context.history) {
        if (turn instanceof vscode.ChatRequestTurn) {
            messages.push(vscode.LanguageModelChatMessage.User(turn.prompt));
        } else if (turn instanceof vscode.ChatResponseTurn) {
            // Extract text content from response parts
            const textParts = turn.response
                .filter(part => part instanceof vscode.ChatResponseMarkdownPart)
                .map(part => (part as vscode.ChatResponseMarkdownPart).value.value)
                .join('');

            if (textParts) {
                messages.push(vscode.LanguageModelChatMessage.Assistant(textParts));
            }
        }
    }

    // 3. Add Current User Message
    messages.push(vscode.LanguageModelChatMessage.User(request.prompt));

    try {
        const models = await vscode.lm.selectChatModels({ family: 'gpt-4' });
        const model = models[0] || (await vscode.lm.selectChatModels({}))[0];

        if (!model) {
            stream.markdown('Error: No Language Model available.');
            return;
        }

        // Fetch available tools and filter for file operations to avoid hitting tool limits
        const tools = vscode.lm.tools.filter(tool => {
            const name = tool.name.toLowerCase();
            return name.includes('read') || name.includes('write') || name.includes('edit') || name.includes('file');
        }).map(tool => ({
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema
        }));

        console.log('Tools available for AI Writer:', tools.map(t => t.name).join(', '));

        // Tool calling loop
        const maxTurns = 5;
        let turn = 0;

        while (turn < maxTurns) {
            turn++;

            const chatResponse = await model.sendRequest(messages, { tools }, token);

            let responseParts: (vscode.LanguageModelTextPart | vscode.LanguageModelToolCallPart)[] = [];

            for await (const part of chatResponse.stream) {
                if (part instanceof vscode.LanguageModelTextPart || part instanceof vscode.LanguageModelToolCallPart) {
                    responseParts.push(part);
                }
                if (part instanceof vscode.LanguageModelTextPart) {
                    stream.markdown(part.value);
                }
            }

            // Add assistant response to history
            messages.push(vscode.LanguageModelChatMessage.Assistant(responseParts));

            // Check for tool calls
            const toolCalls = responseParts.filter(part => part instanceof vscode.LanguageModelToolCallPart) as vscode.LanguageModelToolCallPart[];

            if (toolCalls.length > 0) {
                // Execute each tool
                for (const toolCall of toolCalls) {
                    try {
                        const result = await vscode.lm.invokeTool(toolCall.name, {
                            input: toolCall.input,
                            toolInvocationToken: request.toolInvocationToken
                        }, token);

                        // Add tool result to history
                        messages.push(vscode.LanguageModelChatMessage.User([
                            new vscode.LanguageModelToolResultPart(toolCall.callId, result.content)
                        ]));
                    } catch (err) {
                        const errorMessage = err instanceof Error ? err.message : String(err);
                        messages.push(vscode.LanguageModelChatMessage.User([
                            new vscode.LanguageModelToolResultPart(toolCall.callId, [new vscode.LanguageModelTextPart(`Error: ${errorMessage}`)])
                        ]));
                    }
                }
            } else {
                // No tool calls, conversation turn complete
                break;
            }
        }

    } catch (err) {
        if (err instanceof Error) {
            stream.markdown(`Error: ${err.message}`);
        }
    }
}/* This is the old version of handleConversation before tool support was added.

DO NOT DELETE yet - we may want to to back.
*/

async function handleConversation_OLD(
    extensionContext: vscode.ExtensionContext,
    request: vscode.ChatRequest,
    _context: vscode.ChatContext,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken
) {
    // Load prompt from file
    const promptFileName = 'AI-WRITER-CONVERSATION.md';
    let systemPrompt = '';

    // Check for prompt file in the workspace root (Override)
    const workspaceFolders = vscode.workspace.workspaceFolders;
    let rootPath = '';
    if (workspaceFolders && workspaceFolders.length > 0) {
        rootPath = workspaceFolders[0].uri.fsPath;
        const customPromptPath = path.join(rootPath, promptFileName);
        if (await ws_exists(customPromptPath)) {
            try {
                systemPrompt = await ws_read_file(customPromptPath);
            } catch (err) {
                console.error('Error reading custom prompt file:', err);
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
                    stream.markdown(`*Loaded custom context from AI-WRITER-CONTEXT.md (embedding any linked files inline)*\n\n`);
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

    // Replace placeholder with user's message
    const prompt = systemPrompt.replace('{USER_MESSAGE}', request.prompt);

    // Simple conversational response using the LLM
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

        for await (const fragment of chatResponse.text) {
            stream.markdown(fragment);
        }
    } catch (err) {
        if (err instanceof Error) {
            stream.markdown(`Error: ${err.message}`);
        }
    }
}
/**
 * Handles the /draft and /outline slash commands for the @writer chat participant.
 *
 * This function processes content generation requests by:
 * 1. Loading the appropriate system prompt (draft or outline mode)
 * 2. Optionally loading additional context from `AI-WRITER-CONTEXT.md` and role from `AI-WRITER-ROLE.md`
 * 3. Finding or creating a writer block at the cursor position in the active editor
 * 4. Sending the P (human) section content to the language model
 * 5. Streaming the AI response back to the chat UI
 * 6. Offering an "Insert into Document" button to place the result in the A section
 *
 * **Draft Mode** (`/draft`): Uses `AI-WRITER-GEN-FROM-DRAFT.md` prompt for paraphrasing/expanding
 * existing prose content.
 *
 * **Outline Mode** (`/outline`): Uses `AI-WRITER-GEN-FROM-OUTLINE.md` prompt for expanding
 * bullet-point outlines into full prose.
 *
 * If no writer block exists but text is selected, the function automatically wraps the selection
 * in a new `<!-- p --> ... <!-- a --> <!-- e -->` block.
 *
 * Prompt Loading Priority:
 * 1. Workspace root custom prompt file (override)
 * 2. Bundled default prompt in `out/writer/prompts/`
 * 3. Appends `AI-WRITER-CONTEXT.md` content (with link expansion)
 * 4. Appends `AI-WRITER-ROLE.md` content
 *
 * @param promptType - Either 'draft' for paraphrasing mode or 'outline' for outline expansion mode
 * @param extensionContext - The VS Code extension context for accessing extension resources
 * @param request - The chat request containing any additional user prompt text
 * @param stream - The response stream for sending markdown content and buttons to the chat UI
 * @param token - Cancellation token for aborting long-running operations
 *
 * @throws Displays error message in stream if prompt file cannot be loaded, no content is found, or LLM fails
 */
export async function handleFillCommand(
    promptType: 'draft' | 'outline',
    extensionContext: vscode.ExtensionContext,
    request: vscode.ChatRequest,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken) {
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
                    stream.markdown(`*Loaded custom context from AI-WRITER-CONTEXT.md (embedding any linked files inline)*\n\n`);
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

    // Inject Workspace Root Information
    if (rootPath) {
        systemPrompt += `\n\n**Workspace Information:**\nWorkspace Root: ${rootPath}\nIMPORTANT: When using tools to read or edit files, ALWAYS use the absolute path. You can construct it by joining the Workspace Root with the relative path.`;
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
/**
 * Handles the /verify slash command for the @writer chat participant.
 *
 * This function verifies that the AI-generated content (A section) accurately captures
 * all the details from the human-written content (P section). It's useful for ensuring
 * no important information was lost during the AI generation process.
 *
 * The verification process:
 * 1. Locates the writer block at the current cursor position
 * 2. Loads the verify prompt template (with `{CONTENT}` placeholder)
 * 3. Sends the full block content to the language model for analysis
 * 4. Streams the verification results (missing details, discrepancies, etc.) to the chat UI
 *
 * Prompt Loading Priority:
 * 1. Workspace root `AI-WRITER-VERIFY.md` (custom override)
 * 2. Bundled default prompt in `out/writer/prompts/AI-WRITER-VERIFY.md`
 *
 * @param extensionContext - The VS Code extension context for accessing extension resources
 * @param stream - The response stream for sending verification results to the chat UI
 * @param token - Cancellation token for aborting long-running operations
 *
 * @throws Displays error message in stream if no editor is open, no block is found, or LLM fails
 */
export async function handleVerifyCommand(extensionContext: vscode.ExtensionContext, stream: vscode.ChatResponseStream, token: vscode.CancellationToken) {
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

    // Load prompt from file
    const promptFileName = 'AI-WRITER-VERIFY.md';
    let systemPrompt = '';

    // Check for prompt file in the workspace root (Override)
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders && workspaceFolders.length > 0) {
        const rootPath = workspaceFolders[0].uri.fsPath;
        const customPromptPath = path.join(rootPath, promptFileName);
        if (await ws_exists(customPromptPath)) {
            try {
                systemPrompt = await ws_read_file(customPromptPath);
            } catch (err) {
                console.error('Error reading custom prompt file:', err);
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

    // Replace placeholder with the content to verify
    const verifyPrompt = systemPrompt.replace('{CONTENT}', editorContext.fullBlock);

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

