import * as vscode from 'vscode';

/**
 * Merges sentences using double-period delimiters (.. or . . or .  . or .   .).
 * Splits text on double periods, capitalizes first letter of each sentence,
 * lowercases other words, removes internal periods/question marks/exclamation points, and adds single period at end.
 * 
 * Example: "I like to. shop at! the mall.. This is. another? sentence.."
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

	let NL = '---nl---';
	let selectedText = editor.document.getText(selection);

	// It's tricky to explain this, but in order to not have this algorithm end up wiping out the periods that appear at the end of a paragraph
	// that ends with a space right before the new line but we compensate for that by replacing that with just simply a new line character. And it's worth noting
	// that the only reason we end up in this situation is because the TTS we use adds that space silently as we dictate, so they do appear often. 

	selectedText = selectedText.replace(/  \n/g, NL);
    selectedText = selectedText.replace(/ \n/g, NL);

	selectedText = selectedText.replace(/\n/g, NL);

	// This ensures that: 
	// 1) sentences separated by a period followed by a newline are also treated as separate sentences, and
	// 2) "?." is replaced with ".." to avoid losing sentence boundaries, and
	// 3) "!." is replaced with ".." to avoid losing sentence boundaries.
	selectedText = selectedText.replace(/\.---nl---/g, '..---nl---');
	selectedText = selectedText.replace(/\?\./g, '..');
	selectedText = selectedText.replace(/!\./g, '..');

	// Finally if the above had any unwanted effects of too many periods, fix it. Any three
	// or more periods in a row should be reduced to just two.
	selectedText = selectedText.replace(/\.{3,}/g, '..');
	// also replace multiple spaces with a single space
	selectedText = selectedText.replace(/\s{2,}/g, ' ');

	// Pattern: two periods with 0-3 spaces between them
	// Matches: "..", ". .", ".  .", ".   ."
	const doublePeriodPattern = /\.\s{0,3}\./g;

	// Split on double periods
	const sentences = selectedText.split(doublePeriodPattern);

	// Process each sentence
	const processedSentences = sentences
		.map(sentence => {
			// Remove all periods, question marks, and exclamation points from the sentence
			let cleaned = sentence.replace(/[.?!]/g, '');

			// Remove spaces before commas. Spaces before commas are just a common sequence that pops up during 
			// the use of narration so we simply want to remove those spaces.
			cleaned = cleaned.replace(/\s+,/g, ',');

			// Trim whitespace
			cleaned = cleaned.trim();

			// Skip empty sentences
			if (!cleaned) {
				return '';
			}

			// Split by words but preserve the whitespace (including newlines) between them
			const tokens = cleaned.split(/(\s+)/);

			let isFirstWord = true;
			const processedTokens = tokens.map(token => {
				// If it's whitespace (including newlines), preserve it as-is
				if (/^\s+$/.test(token)) {
					return token;
				}

				// It's a word - capitalize first word, lowercase the rest
				if (isFirstWord) {
					isFirstWord = false;
					return token.charAt(0).toUpperCase() + token.slice(1).toLowerCase();
				} else {
					return token.toLowerCase();
				}
			});

			// Join tokens (words and whitespace are already interleaved) and add period at end
			return processedTokens.join('');
		})
		.filter(s => s.length > 0); // Remove empty sentences

	// Join sentences with ". " and add final period
	let mergedText = processedSentences.join('. ');
	if (mergedText && !mergedText.endsWith('.')) {
		mergedText += '.';
	}

	// Restore newlines
	mergedText = mergedText.replace(/---nl---/g, '\n');

	// finally ensure the first character of each line is capitalized
	mergedText = mergedText.split('\n').map(line => {
		line = line.trim();
		if (line.length === 0) {
			return line;
		}
		return line.charAt(0).toUpperCase() + line.slice(1);
	}).join('\n');

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
