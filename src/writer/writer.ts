import * as vscode from 'vscode';
import { addFileToContext, findWriterBlock, hideSections, removeSections } from './writer-utils';
import { handleConversation, handleFillCommand, handleVerifyCommand } from './writer-handlers';

/**
 * The unique identifier for the AI Writer chat participant.
 * Used when registering with VS Code's chat API as `@writer`.
 */
const PARTICIPANT_ID = 'timex.writer';

/**
 * Represents the context of a writer block found in a markdown document.
 * 
 * A writer block uses the following HTML comment structure:
 * ```markdown
 * <!-- p -->
 * Human-written content (P section)
 * <!-- a -->
 * AI-generated content (A section)
 * <!-- e -->
 * ```
 * 
 * This interface captures the parsed components of such a block for processing.
 */
export interface WriterContext {
    /** The trimmed content between the `<!-- p -->` and `<!-- a -->` tags (human input section) */
    pContent: string;
    /** The complete block text including all markers from `<!-- p -->` to `<!-- e -->` */
    fullBlock: string;
    /** The VS Code Range covering the entire block in the document, used for replacements */
    range: vscode.Range;
}

/**
 * Activates the AI Writer functionality within the Timex extension.
 * 
 * This function initializes the complete AI Writer subsystem, including:
 * - A VS Code chat participant (`@writer`) with slash commands for draft, outline, and verify operations
 * - Editor commands for inserting AI-generated content and templates
 * - File management commands for removing/hiding P (human) and A (AI) sections
 * - Context file management for adding reference files to the AI's knowledge base
 * 
 * The AI Writer uses a block-based syntax with HTML comments to separate human input from AI output:
 * ```markdown
 * <!-- p -->
 * Human-written content (P section)
 * <!-- a -->
 * AI-generated content (A section)
 * <!-- e -->
 * ```
 * 
 * @param context - The VS Code extension context used for registering disposables and accessing extension resources
 * 
 * @example
 * // In extension.ts activate function:
 * activateWriter(context);
 */
export function activateWriter(context: vscode.ExtensionContext) {
    console.log('AI Writer is active');

    // 1. Register the Chat Participant
    const handler: vscode.ChatRequestHandler = async (request: vscode.ChatRequest, chatContext: vscode.ChatContext, stream: vscode.ChatResponseStream, token: vscode.CancellationToken) => {
        // Handle /verify command
        if (request.command === 'verify') {
            await handleVerifyCommand(context, stream, token);
            return;
        }

        // Handle /draft command (Gen. from Draft)
        if (request.command === 'draft') {
            await handleFillCommand('draft', context, request, stream, token);
            return;
        }

        // Handle /outline command (Gen. from Outline)
        if (request.command === 'outline') {
            await handleFillCommand('outline', context, request, stream, token);
            return;
        }

        // No command specified - handle as normal conversation
        await handleConversation(context, request, chatContext, stream, token);
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

    // 4. Register Command to Gen. from Draft (Trigger Chat with /draft command)
    context.subscriptions.push(
        vscode.commands.registerCommand('timex.writerGenerateFromDraft', () => {
            vscode.commands.executeCommand('workbench.action.chat.open', { query: '@writer /draft' });
        })
    );

    // 5. Register Command to Gen. from Outline (Trigger Chat with outline command)
    context.subscriptions.push(
        vscode.commands.registerCommand('timex.writerGenerateFromOutline', () => {
            vscode.commands.executeCommand('workbench.action.chat.open', { query: '@writer /outline' });
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

