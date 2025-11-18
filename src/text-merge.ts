import * as vscode from 'vscode';

/**
 * Merges sentences using double-period delimiters (.. or . . or .  . or .   .).
 * Splits text on double periods, capitalizes first letter of each sentence,
 * lowercases other words, removes internal periods, and adds single period at end.
 * 
 * Example: "I like to. shop at. the mall.. This is. another. sentence.."
 *          becomes "I like to shop at the mall. This is another sentence."
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
	
	// Pattern: two periods with 0-3 spaces between them
	// Matches: "..", ". .", ".  .", ".   ."
	const doublePeriodPattern = /\.\s{0,3}\./g;
	
	// Split on double periods
	const sentences = selectedText.split(doublePeriodPattern);
	
	// Process each sentence
	const processedSentences = sentences
		.map(sentence => {
			// Remove all periods from the sentence
			let cleaned = sentence.replace(/\./g, '');
			
			// Trim whitespace
			cleaned = cleaned.trim();
			
			// Skip empty sentences
			if (!cleaned) {
				return '';
			}
			
			// Split into words
			const words = cleaned.split(/\s+/);
			
			// Capitalize first word, lowercase the rest
			const processedWords = words.map((word, index) => {
				if (index === 0) {
					// Capitalize first letter of first word
					return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
				} else {
					// Lowercase all other words
					return word.toLowerCase();
				}
			});
			
			// Join words and add period at end
			return processedWords.join(' ');
		})
		.filter(s => s.length > 0); // Remove empty sentences
	
	// Join sentences with ". " and add final period
	let mergedText = processedSentences.join('. ');
	if (mergedText && !mergedText.endsWith('.')) {
		mergedText += '.';
	}

	// Only make the edit if something actually changed
	if (mergedText !== selectedText && mergedText.length > 0) {
		await editor.edit(editBuilder => {
			editBuilder.replace(selection, mergedText);
		});
		
		// Show a subtle confirmation
		const sentenceCount = processedSentences.length;
		vscode.window.setStatusBarMessage(
			`✓ Processed ${sentenceCount} sentence${sentenceCount !== 1 ? 's' : ''}`,
			3000
		);
	} else {
		vscode.window.showInformationMessage('No sentences found to process');
	}
}
