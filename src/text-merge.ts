import * as vscode from 'vscode';

/**
 * Merges incorrectly split sentences that have periods followed by spaces and capital letters.
 * This is useful for fixing text from speech-to-text that incorrectly splits single sentences.
 * 
 * Example: "I like to. Shop at. The mall." becomes "I like to shop at the mall."
 * 
 * @returns Promise that resolves when the operation is complete
 */
export async function mergeSentences(): Promise<void> {
	const editor = vscode.window.activeTextEditor;
	
	if (!editor) {
		vscode.window.showWarningMessage('No active text editor');
		return;
	}

	const selection = editor.selection;
	
	// Check if there's actually selected text
	if (selection.isEmpty) {
		vscode.window.showWarningMessage('Please select text to merge sentences');
		return;
	}

	const selectedText = editor.document.getText(selection);
	
	// Pattern: period followed by space followed by capital letter
	// We'll replace ". A" with " a", ". B" with " b", etc.
	const mergedText = selectedText.replace(/\.\s+([A-Z])/g, (match, capitalLetter) => {
		// Remove the period, keep the space, lowercase the capital letter
		return ' ' + capitalLetter.toLowerCase();
	});

	// Only make the edit if something actually changed
	if (mergedText !== selectedText) {
		await editor.edit(editBuilder => {
			editBuilder.replace(selection, mergedText);
		});
		
		// Show a subtle confirmation
		const changeCount = (selectedText.match(/\.\s+[A-Z]/g) || []).length;
		vscode.window.setStatusBarMessage(
			`✓ Merged ${changeCount} sentence break${changeCount !== 1 ? 's' : ''}`,
			3000
		);
	} else {
		vscode.window.showInformationMessage('No sentence breaks found to merge');
	}
}
