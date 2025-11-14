import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { scanForNumberedItems, stripOrdinalPrefix, NumberedItem } from './utils';

const IMAGE_EXTENSIONS = new Set<string>([
	'.png',
	'.jpg',
	'.jpeg',
	'.gif',
	'.bmp',
	'.svg',
	'.webp',
	'.tif',
	'.tiff',
	'.avif'
]);

/**
 * Extracts the first meaningful line from a file to use as a title
 */
async function getTitleFromFile(filePath: string): Promise<string | null> {
	try {
		const data = await fs.promises.readFile(filePath, 'utf8');
		const lines = data.split(/\r?\n/);
		for (const rawLine of lines) {
			const line = rawLine.trim();
			if (!line) {
				continue;
			}
			// Strip a leading UTF-8 BOM so headings render correctly
			let title = line.replace(/^\uFEFF/, '');
			// Normalize markdown headings by stripping "#" prefixes before using as title
			if (/^#+\s/.test(title)) {
				title = title.replace(/^#+\s+/, '').trim();
			}
			if (!title) {
				continue;
			}
			if (title.length > 60) {
				title = title.slice(0, 60).trimEnd() + '...';
			}
			return title;
		}
	} catch (error) {
		console.error(`Failed to extract title from ${filePath}:`, error);
	}
	return null;
}

/**
 * Generates markdown content for a directory by concatenating all ordinal items
 */
async function generateMarkdownForDirectory(directory: string): Promise<string> {
	let numberedItems: NumberedItem[];
	try {
		numberedItems = scanForNumberedItems(directory);
	} catch (error: any) {
		throw new Error(`Failed to scan directory: ${error instanceof Error ? error.message : String(error)}`);
	}

	if (numberedItems.length === 0) {
		return `# ${path.basename(directory)}\n\n*This folder contains no ordinal items (files or folders starting with digits followed by underscore).*\n`;
	}

	const sections: string[] = [];
	let addedContent = false;

	for (const item of numberedItems) {
		if (item.isDirectory) {
			// For subdirectories, recursively generate their markdown
			const childMarkdown = await generateMarkdownForDirectory(item.fullPath);
			if (childMarkdown) {
				// Extract title from the child markdown content
				const firstLine = childMarkdown.split('\n')[0];
				const folderLabel = firstLine.startsWith('# ')
					? firstLine.substring(2).trim()
					: (stripOrdinalPrefix(item.originalName) || item.originalName);
				
				sections.push(`# ${folderLabel}`);
				sections.push('');
				// Include the child content (skip the first heading since we already added it)
				const childLines = childMarkdown.split('\n');
				const contentWithoutFirstHeading = childLines.slice(1).join('\n').trim();
				if (contentWithoutFirstHeading) {
					sections.push(contentWithoutFirstHeading);
				}
				addedContent = true;
			}
		} else {
			const extension = path.extname(item.originalName).toLowerCase();
			if (IMAGE_EXTENSIONS.has(extension)) {
				// For images, create an image embed
				const strippedName = stripOrdinalPrefix(item.originalName) || item.originalName;
				const altText = path.basename(strippedName, extension);
				// Use absolute file path for the image
				const imageUri = vscode.Uri.file(item.fullPath).toString();
				sections.push(`![${altText}](${imageUri})`);
				addedContent = true;
			} else if (extension === '.md') {
				// For markdown files, include their content
				try {
					const contents = await fs.promises.readFile(item.fullPath, 'utf8');
					sections.push(contents.trimEnd());
					sections.push('---');
					addedContent = true;
				} catch (error) {
					console.error(`Failed to read ${item.fullPath}:`, error);
				}
			}
		}
	}

	if (!addedContent) {
		return `# ${path.basename(directory)}\n\n*This folder contains no markdown files or images.*\n`;
	}

	// Remove trailing separator if present
	if (sections.length > 0 && sections[sections.length - 1] === '---') {
		sections.pop();
	}

	return sections.join('\n\n').trimEnd() + '\n';
}

/**
 * TextDocumentContentProvider that generates virtual markdown documents for folder previews.
 * Uses the URI scheme 'timex-preview' with the folder path encoded in the URI.
 */
export class MarkdownFolderPreviewProvider implements vscode.TextDocumentContentProvider {
	private _onDidChange = new vscode.EventEmitter<vscode.Uri>();
	
	/**
	 * Event that fires when the content of a virtual document changes.
	 * This allows VS Code to refresh the preview when we notify it.
	 */
	public readonly onDidChange = this._onDidChange.event;

	/**
	 * Generates the markdown content for a folder preview.
	 * Called by VS Code when the virtual document needs to be displayed.
	 */
	async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
		try {
			// Extract the folder path from the URI
			// URI format: timex-preview:/path/to/folder
			const folderPath = uri.fsPath;

			// Verify the folder exists
			try {
				const stat = await fs.promises.stat(folderPath);
				if (!stat.isDirectory()) {
					return `# Error\n\nThe path "${folderPath}" is not a directory.`;
				}
			} catch (error) {
				return `# Error\n\nFolder not found: "${folderPath}"`;
			}

			// Generate the markdown content
			const folderName = path.basename(folderPath);
			const markdown = await generateMarkdownForDirectory(folderPath);
			
			// Add a header with the folder name
			return `# Preview: ${folderName}\n\n${markdown}`;
			
		} catch (error: any) {
			const message = error instanceof Error ? error.message : String(error);
			return `# Error Generating Preview\n\n${message}`;
		}
	}

	/**
	 * Triggers a refresh of the preview for a specific folder.
	 * This will cause VS Code to call provideTextDocumentContent again.
	 */
	public refresh(uri: vscode.Uri): void {
		this._onDidChange.fire(uri);
	}

	/**
	 * Cleanup resources when the provider is disposed.
	 */
	public dispose(): void {
		this._onDidChange.dispose();
	}
}
