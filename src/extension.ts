// The module 'vscode' contains the VS Code extensibility API 
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { TaskProvider } from './model';
import {
	containsAnyConfiguredHashtag,
	getIncludeGlobPattern,
	scanForNumberedItems,
	renumberItems,
	verifyNamesAreUnique,
	generateNextOrdinalFilename,
	extractOrdinalFromFilename,
	generateNumberPrefix,
	stripOrdinalPrefix,
	NumberedItem,
	isImageFileName,
	generateFileHash,
	buildAttachmentIndex,
	extractHashFromTimexFilename,
	TIMEX_LINK_REGEX,
	TIMESTAMP_REGEX
} from './utils';
import { formatTimestamp } from './utils';
import { parseTimestamp } from './utils';
import { ViewFilter, PriorityTag } from './constants';
import { TimexFilterPanel } from './filterPanel';

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
 * Sets up file system watcher for markdown files to automatically update task view
 */
function setupFileWatcher(context: vscode.ExtensionContext, taskProvider: TaskProvider): void {
	// Create a file system watcher for configured markdown include globs
	const watcherPattern = getIncludeGlobPattern();
	const watcher = vscode.workspace.createFileSystemWatcher(watcherPattern);

	// Handle file saves/changes
	const onChangeDisposable = watcher.onDidChange(async (uri) => {
		try {
			// Small delay to ensure file is fully written
			await new Promise(resolve => setTimeout(resolve, 100));

			const filePath = uri.fsPath;
			const content = await vscode.workspace.fs.readFile(uri);
			const contentString = Buffer.from(content).toString('utf8');

			// Check if it's a task file
			const primaryHashtag = taskProvider.getPrimaryHashtag();
			const hasTaskHashtag = primaryHashtag === 'all-tags'
				? containsAnyConfiguredHashtag(contentString)
				: contentString.includes(primaryHashtag);
			const isDoneTask = contentString.includes('#done');


			// Look for timestamp in the file
			// Only support new standard [MM/DD/YYYY] or [MM/DD/YYYY HH:MM:SS AM/PM]
			const timestampMatch = contentString.match(TIMESTAMP_REGEX);

			if (timestampMatch) {
				// File has timestamp - update it efficiently
				await taskProvider.updateSingleTask(filePath, timestampMatch[0]);
			} else {
				// File doesn't have timestamp - do full refresh (rare case)
				taskProvider.refresh();
			}

		} catch (error) {
			console.error('File watcher error:', error);
			// On error, just ignore - user can manually refresh if needed
		}
	});

	// Add to subscriptions for proper cleanup
	context.subscriptions.push(watcher, onChangeDisposable);
}

/**
 * Adds time to a task's timestamp
 * @param item The tree item containing the task
 * @param amount The amount to add (e.g., 1)
 * @param unit The unit of time ('day', 'week', 'month', 'year')
 * @param taskProvider The task provider instance to refresh after update
 */
async function addTimeToTask(item: any, amount: number, unit: 'day' | 'week' | 'month' | 'year', taskProvider: TaskProvider): Promise<void> {
	if (!item || !item.resourceUri) {
		vscode.window.showErrorMessage('No task selected');
		return;
	}

	const filePath = item.resourceUri.fsPath;

	try {
		// Read the file content
		const content = fs.readFileSync(filePath, 'utf8');

		// Find existing timestamp
		const timestampMatch = content.match(TIMESTAMP_REGEX);

		if (!timestampMatch) {
			vscode.window.showErrorMessage('No timestamp found in task file');
			return;
		}

		const currentTimestampString = timestampMatch[0];

		// Detect if the original timestamp was in long format (with time) or short format (date-only)
		const cleanTimestamp = currentTimestampString.replace(/[\[\]]/g, '');
		const isLongFormat = cleanTimestamp.includes(' ') && cleanTimestamp.includes(':');

		// Parse the current timestamp
		const parsedDate = parseTimestamp(currentTimestampString);
		if (!parsedDate) {
			vscode.window.showErrorMessage('Unable to parse timestamp');
			return;
		}

		// Add the specified amount of time
		const newDate = new Date(parsedDate);
		switch (unit) {
			case 'day':
				newDate.setDate(newDate.getDate() + amount);
				break;
			case 'week':
				newDate.setDate(newDate.getDate() + (amount * 7));
				break;
			case 'month':
				newDate.setMonth(newDate.getMonth() + amount);
				break;
			case 'year':
				newDate.setFullYear(newDate.getFullYear() + amount);
				break;
		}

		// Format the new timestamp based on original format
		const newTimestampString = formatTimestamp(newDate, isLongFormat);

		// Replace the timestamp in the file content
		const newContent = content.replace(currentTimestampString, newTimestampString);

		// Write the updated content back to the file
		fs.writeFileSync(filePath, newContent, 'utf8');

		// Update just this single task instead of refreshing the entire view
		await taskProvider.updateSingleTask(filePath, newTimestampString);

		vscode.window.showInformationMessage(`Added ${amount} ${unit}${amount > 1 ? 's' : ''} to task due date`);

	} catch (error) {
		vscode.window.showErrorMessage(`Failed to update task: ${error}`);
	}
}

// This method is called when your extension is activated
export function activate(context: vscode.ExtensionContext) {
	console.log('Timex extension is now active!');

	// Create the tree data provider with context for state persistence
	const taskProvider = new TaskProvider(context);

	// Register the tree view
	const treeView = vscode.window.createTreeView('taskExplorer', {
		treeDataProvider: taskProvider
	});

	// Set the tree view reference in the provider
	taskProvider.setTreeView(treeView);
	taskProvider.clearCutIndicator();
	void vscode.commands.executeCommand('setContext', 'timex.hasOrdinalCutItem', false);

	interface OrdinalClipboardItem {
		sourcePath: string;
		originalName: string;
		nameWithoutPrefix: string;
		isDirectory: boolean;
	}

	let ordinalClipboard: OrdinalClipboardItem | null = null;

	const resetOrdinalClipboard = () => {
		ordinalClipboard = null;
		taskProvider.clearCutIndicator();
		void vscode.commands.executeCommand('setContext', 'timex.hasOrdinalCutItem', false);
	};

	// Set up file watcher for automatic updates
	setupFileWatcher(context, taskProvider);

	// Set up configuration change listener to clear primary hashtag cache
	const configChangeListener = vscode.workspace.onDidChangeConfiguration((event) => {
		if (event.affectsConfiguration('timex.primaryHashtag')) {
			taskProvider.clearPrimaryHashtagCache();
			// Refresh the task view to reflect the new primary hashtag
			taskProvider.refresh();
		}
	});
	context.subscriptions.push(configChangeListener);

	// Add visibility listener to trigger initial scan when user first opens the panel
	let hasScannedOnce = false;
	treeView.onDidChangeVisibility((e) => {
		if (e.visible && !hasScannedOnce) {
			hasScannedOnce = true;
			taskProvider.refresh();
		}
	});

	// Register commands

	const insertTimestampCommand = vscode.commands.registerCommand('timex.insertTimestamp', () => {
		const editor = vscode.window.activeTextEditor;
		if (!editor) {
			vscode.window.showErrorMessage('No active editor found');
			return;
		}

		// Generate current timestamp in the required format
		const now = new Date();
		const timestamp = formatTimestamp(now);

		// Insert timestamp at cursor position
		const position = editor.selection.active;
		editor.edit(editBuilder => {
			editBuilder.insert(position, timestamp);
		});

		vscode.window.showInformationMessage(`Timestamp inserted: ${timestamp}`);
	});

	const insertDateCommand = vscode.commands.registerCommand('timex.insertDate', () => {
		const editor = vscode.window.activeTextEditor;
		if (!editor) {
			vscode.window.showErrorMessage('No active editor found');
			return;
		}

		// Generate current date (date-only format, no time)
		const now = new Date();
		const dateOnly = formatTimestamp(now, false); // false = short format (date only)

		// Insert date at cursor position
		const position = editor.selection.active;
		editor.edit(editBuilder => {
			editBuilder.insert(position, dateOnly);
		});

		vscode.window.showInformationMessage(`Date inserted: ${dateOnly}`);
	});

	const insertAttachmentCommand = vscode.commands.registerCommand('timex.insertAttachment', async () => {
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

		const workspaceFolder = vscode.workspace.workspaceFolders[0];

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
				await fs.promises.rename(selectedFilePath, newFilePath);

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
	});

	const insertImageFromClipboardCommand = vscode.commands.registerCommand('timex.insertImageFromClipboard', async () => {
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
			// Read image data from clipboard
			const clipboardData = await vscode.env.clipboard.readText();
			
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
			await fs.promises.writeFile(filePath, imageBuffer);
			
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
	});

	const selectPrimaryHashtagCommand = vscode.commands.registerCommand('timex.selectPrimaryHashtag', async () => {
		// Get current primary hashtag from task provider (which handles runtime overrides)
		const currentPrimaryHashtag = taskProvider.getPrimaryHashtag();

		// Get configuration for available hashtags
		const config = vscode.workspace.getConfiguration('timex');
		const hashtagsConfig = config.get('hashtags', ['#todo', '#note']);
		
		// Handle both old string format and new array format for backward compatibility
		let hashtags: string[];
		if (Array.isArray(hashtagsConfig)) {
			hashtags = hashtagsConfig;
		} else if (typeof hashtagsConfig === 'string') {
			// Legacy format: comma-delimited string
			hashtags = (hashtagsConfig as string).split(',').map((tag: string) => tag.trim()).filter((tag: string) => tag.length > 0);
		} else {
			hashtags = ['#todo', '#note'];
		}
		hashtags = hashtags.map(tag => tag.trim()).filter(tag => tag.length > 0);

		// Sort hashtags alphabetically (case-insensitive)
		hashtags.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));

		// Create options with "all-tags" at the top, then individual hashtags
		const allHashtagsOption = {
			label: `${currentPrimaryHashtag === 'all-tags' ? '$(check)' : '$(circle-outline)'} Any Hashtag`,
			value: 'all-tags'
		};

		// Create options with checkmarks for current selection
		const hashtagOptions = hashtags.map(hashtag => ({
			label: `${hashtag === currentPrimaryHashtag ? '$(check)' : '$(circle-outline)'} ${hashtag}`,
			value: hashtag
		}));

		// Combine all options with "all-tags" first
		const options = [allHashtagsOption, ...hashtagOptions];

		const selected = await vscode.window.showQuickPick(options, {
			placeHolder: 'Select primary hashtag for task identification'
		});

		if (selected) {
			try {
				if (selected.value === 'all-tags') {
					// Set runtime override for all-tags mode
					taskProvider.setPrimaryHashtagOverride('all-tags');
				} else {
					// Clear runtime override and update user configuration for specific hashtag
					taskProvider.setPrimaryHashtagOverride(null);
					await config.update('primaryHashtag', selected.value, vscode.ConfigurationTarget.Global);

					// Clear the cached primary hashtag to force reload from config
					taskProvider.clearPrimaryHashtagCache();
				}

				// Refresh the task view to reflect the new primary hashtag
				taskProvider.refresh();

				// vscode.window.showInformationMessage(`Primary hashtag set to: ${selected.value}`);
			} catch (err) {
				vscode.window.showErrorMessage(`Failed to update primary hashtag: ${err}`);
			}
		}
	});

	const filterPriorityCommand = vscode.commands.registerCommand('timex.filterPriority', async () => {
		// Get current filter states to show checkmarks
		const currentPriority = taskProvider.getCurrentPriorityFilter();
		const currentView = taskProvider.getCurrentViewFilter();
		const div = '––––––––––'; // visual divider
		const options = [
			// Priority group
			{
				label: `${currentPriority === PriorityTag.Any ? `$(check) ${div} Any Priority ${div}` : `$(circle-outline) ${div} Any Priority ${div}`}`,
				value: `priority:${PriorityTag.Any}`
			},
			{
				label: `${currentPriority === PriorityTag.High ? '$(check) Priority 1' : '$(circle-outline) Priority 1'}`,
				value: `priority:${PriorityTag.High}`
			},
			{
				label: `${currentPriority === PriorityTag.Medium ? '$(check) Priority 2' : '$(circle-outline) Priority 2'}`,
				value: `priority:${PriorityTag.Medium}`
			},
			{
				label: `${currentPriority === PriorityTag.Low ? '$(check) Priority 3' : '$(circle-outline) Priority 3'}`,
				value: `priority:${PriorityTag.Low}`
			},
			{
				label: `${currentPriority === PriorityTag.None ? '$(check) No Priority' : '$(circle-outline) No Priority'}`,
				value: `priority:${PriorityTag.None}`
			},
			// Separator
			{ label: '', value: 'separator', kind: vscode.QuickPickItemKind.Separator } as any,
			// View group
			{
				label: `${currentView === ViewFilter.All ? `$(check) ${div} Any Time ${div}` : `$(circle-outline) ${div} Any Time ${div}`}`,
				value: `view:${ViewFilter.All}`
			},
			{
				label: `${currentView === ViewFilter.DueIn7Days ? `$(check) ${ViewFilter.DueIn7Days}` : `$(circle-outline) ${ViewFilter.DueIn7Days}`}`,
				value: `view:${ViewFilter.DueIn7Days}`
			},
			{
				label: `${currentView === ViewFilter.DueIn14Days ? `$(check) ${ViewFilter.DueIn14Days}` : `$(circle-outline) ${ViewFilter.DueIn14Days}`}`,
				value: `view:${ViewFilter.DueIn14Days}`
			},
			{
				label: `${currentView === ViewFilter.DueIn30Days ? `$(check) ${ViewFilter.DueIn30Days}` : `$(circle-outline) ${ViewFilter.DueIn30Days}`}`,
				value: `view:${ViewFilter.DueIn30Days}`
			},
			{
				label: `${currentView === ViewFilter.DueToday ? `$(check) ${ViewFilter.DueToday}` : `$(circle-outline) ${ViewFilter.DueToday}`}`,
				value: `view:${ViewFilter.DueToday}`
			},
			{
				label: `${currentView === ViewFilter.FutureDueDates ? `$(check) ${ViewFilter.FutureDueDates}` : `$(circle-outline) ${ViewFilter.FutureDueDates}`}`,
				value: `view:${ViewFilter.FutureDueDates}`
			},
			{
				label: `${currentView === ViewFilter.Overdue ? `$(check) ${ViewFilter.Overdue}` : `$(circle-outline) ${ViewFilter.Overdue}`}`,
				value: `view:${ViewFilter.Overdue}`
			},
		];

		const selected = await vscode.window.showQuickPick(options, {
			placeHolder: 'Select filter options'
		});

		if (selected && selected.value !== 'separator' && selected.value !== 'separator2') {
			const [type, value] = selected.value.split(':');
			if (type === 'priority') {
				taskProvider.filterByPriority(value as PriorityTag);
			} else if (type === 'view') {
				const viewValue = value as ViewFilter;
				switch (viewValue) {
					case ViewFilter.All:
						taskProvider.refresh();
						break;
					case ViewFilter.DueIn7Days:
						taskProvider.refreshDueIn7Days();
						break;
					case ViewFilter.DueIn14Days:
						taskProvider.refreshDueIn14Days();
						break;
					case ViewFilter.DueIn30Days:
						taskProvider.refreshDueIn30Days();
						break;
					case ViewFilter.DueToday:
						taskProvider.refreshDueToday();
						break;
					case ViewFilter.FutureDueDates:
						taskProvider.refreshFutureDueDates();
						break;
					case ViewFilter.Overdue:
						taskProvider.refreshOverdue();
						break;
					default:
						break;
				}
			}
		}
	});

	const openFilterPanelCommand = vscode.commands.registerCommand('timex.openFilterPanel', () => {
		try {
			const currentPriority = taskProvider.getCurrentPriorityFilter();
			
			TimexFilterPanel.show(
				context.extensionUri,
				(priority: PriorityTag) => {
					taskProvider.filterByPriority(priority);
				},
				currentPriority
			);
		} catch (error) {
			console.error('[Extension] Error in openFilterPanel command:', error);
			vscode.window.showErrorMessage(`Filter panel error: ${error}`);
		}
	});

	const searchTasksCommand = vscode.commands.registerCommand('timex.searchTasks', async () => {
		const searchQuery = await vscode.window.showInputBox({
			placeHolder: 'Enter search text...',
			prompt: 'Search task filenames and content',
			value: ''
		});

		if (searchQuery !== undefined) {
			if (searchQuery.trim() === '') {
				// Clear search if empty string
				taskProvider.clearSearch();
				vscode.window.showInformationMessage('Search cleared');
			} else {
				// Perform search
				taskProvider.searchTasks(searchQuery.trim());
				vscode.window.showInformationMessage(`Searching for: "${searchQuery.trim()}"`);
			}
		}
	});

	const newTaskCommand = vscode.commands.registerCommand('timex.newTask', async () => {
		// Get the workspace folder
		if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
			vscode.window.showErrorMessage('No workspace folder found');
			return;
		}

		const workspaceFolder = vscode.workspace.workspaceFolders[0];
		const rootPath = workspaceFolder.uri.fsPath;

		// Get configured task folder
		const config = vscode.workspace.getConfiguration('timex');
		const taskFolderSetting = config.get<string>('newTaskFolder', '');

		// Determine the target folder
		let targetPath = rootPath;
		if (taskFolderSetting && taskFolderSetting.trim() !== '') {
			const folderPath = taskFolderSetting.trim();

			// Check if it's an absolute path
			if (path.isAbsolute(folderPath)) {
				targetPath = folderPath;
			} else {
				// If relative path, join with workspace root (backward compatibility)
				targetPath = path.join(rootPath, folderPath);
			}

			// Create the folder if it doesn't exist
			if (!fs.existsSync(targetPath)) {
				try {
					fs.mkdirSync(targetPath, { recursive: true });
				} catch (error) {
					vscode.window.showErrorMessage(`Failed to create task folder: ${error}`);
					return;
				}
			}
		}

		// Prompt user for filename
		const userFileName = await vscode.window.showInputBox({
			placeHolder: 'Enter filename for new task',
			prompt: 'Filename (extension .md will be added automatically if not provided)',
			value: '',
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

		if (!userFileName) {
			// User cancelled the input
			return;
		}

		// Process the filename
		let fileName = userFileName.trim();
		// Add .md extension if not already present (case insensitive)
		if (!fileName.toLowerCase().endsWith('.md')) {
			fileName += '.md';
		}

		let filePath = path.join(targetPath, fileName);

		// Check if file already exists
		if (fs.existsSync(filePath)) {
			const overwrite = await vscode.window.showWarningMessage(
				`File "${fileName}" already exists. Do you want to overwrite it?`,
				{ modal: true },
				'Overwrite',
				'Cancel'
			);

			if (overwrite !== 'Overwrite') {
				return;
			}
		}

		// Generate timestamp
		const now = new Date();
		const timestamp = formatTimestamp(now);

		// Create task content, with two blank lines because user will want to start editing at beginning of file.
		const primaryHashtag = taskProvider.getPrimaryHashtag();
		// If in "all-tags" mode, use the first configured hashtag instead of "all-tags"
		let hashtagToUse = primaryHashtag;
		if (primaryHashtag === 'all-tags') {
			const config = vscode.workspace.getConfiguration('timex');
			const hashtagsConfig = config.get('hashtags', ['#todo', '#note']);
			
			// Handle both old string format and new array format for backward compatibility
			let hashtags: string[];
			if (Array.isArray(hashtagsConfig)) {
				hashtags = hashtagsConfig;
			} else if (typeof hashtagsConfig === 'string') {
				// Legacy format: comma-delimited string
				hashtags = (hashtagsConfig as string).split(',').map((tag: string) => tag.trim()).filter((tag: string) => tag.length > 0);
			} else {
				hashtags = ['#todo', '#note'];
			}
			hashtags = hashtags.map(tag => tag.trim()).filter(tag => tag.length > 0);
			
			hashtagToUse = hashtags.length > 0 ? hashtags[0] : '#todo'; // fallback to #todo if no hashtags configured
		}
		const taskContent = `\n\n${hashtagToUse} ${timestamp} #${PriorityTag.Low}`;

		try {
			// Write the file
			fs.writeFileSync(filePath, taskContent, 'utf8');

			// Open the file in the editor
			const fileUri = vscode.Uri.file(filePath);
			const document = await vscode.workspace.openTextDocument(fileUri);
			await vscode.window.showTextDocument(document);

			// Refresh the task view
			taskProvider.refresh();

			vscode.window.showInformationMessage(`New task created: ${fileName}`);
		} catch (error) {
			vscode.window.showErrorMessage(`Failed to create task file: ${error}`);
		}
	});

	const aboutCommand = vscode.commands.registerCommand('timex.about', async () => {
		try {
			// Get the path to the README.md in the extension's installation directory
			const extensionPath = context.extensionPath;
			
			// Try both uppercase and lowercase versions since vsce may lowercase the filename
			let readmePath = path.join(extensionPath, 'README.md');
			if (!fs.existsSync(readmePath)) {
				readmePath = path.join(extensionPath, 'readme.md');
			}
			
			// Verify the README file exists
			if (!fs.existsSync(readmePath)) {
				vscode.window.showErrorMessage(
					`README.md not found in extension directory. ` +
					`Checked: ${path.join(extensionPath, 'README.md')} and ${path.join(extensionPath, 'readme.md')}. ` +
					`This may indicate the extension was not packaged correctly.`
				);
				return;
			}

			const readmeUri = vscode.Uri.file(readmePath);
			// Open the README.md file in VS Code's markdown preview
			await vscode.commands.executeCommand('markdown.showPreview', readmeUri);
		} catch (error) {
			vscode.window.showErrorMessage(`Failed to open About page: ${error}`);
		}
	});

	const openSettingsCommand = vscode.commands.registerCommand('timex.openSettings', async () => {
		try {
			await vscode.commands.executeCommand('workbench.action.openSettings', '@ext:Clay-Ferguson.timex');
		} catch (err) {
			vscode.window.showErrorMessage(`Failed to open Timex settings: ${err}`);
		}
	});

	// Clear all filters command
	const clearFiltersCommand = vscode.commands.registerCommand('timex.clearFilters', async () => {
		taskProvider.clearFilters();
		vscode.window.showInformationMessage('All filters cleared');
	});

	// Date extension commands
	const addDayCommand = vscode.commands.registerCommand('timex.addDay', async (item) => {
		await addTimeToTask(item, 1, 'day', taskProvider);
	});

	const addWeekCommand = vscode.commands.registerCommand('timex.addWeek', async (item) => {
		await addTimeToTask(item, 1, 'week', taskProvider);
	});

	const addMonthCommand = vscode.commands.registerCommand('timex.addMonth', async (item) => {
		await addTimeToTask(item, 1, 'month', taskProvider);
	});

	const addYearCommand = vscode.commands.registerCommand('timex.addYear', async (item) => {
		await addTimeToTask(item, 1, 'year', taskProvider);
	});

	const deleteTaskCommand = vscode.commands.registerCommand('timex.deleteTask', async (item) => {
		if (!item || !item.resourceUri) {
			vscode.window.showErrorMessage('No task selected');
			return;
		}

		const filePath = item.resourceUri.fsPath;
		const fileName = path.basename(filePath);

		// Show confirmation dialog
		const answer = await vscode.window.showWarningMessage(
			`Are you sure you want to delete the task file "${fileName}"?`,
			{ modal: true },
			'Delete',
			'Cancel'
		);

		if (answer === 'Delete') {
			try {
				// Delete the file
				await fs.promises.unlink(filePath);

				// Refresh the task view to remove the deleted item
				taskProvider.refresh();

				vscode.window.showInformationMessage(`Task file "${fileName}" has been deleted.`);
			} catch (error) {
				vscode.window.showErrorMessage(`Failed to delete task file: ${error}`);
			}
		}
	});

	const revealInExplorerCommand = vscode.commands.registerCommand('timex.revealInExplorer', async (item) => {
		if (!item || !item.resourceUri) {
			vscode.window.showErrorMessage('No task selected');
			return;
		}

		try {
			await vscode.commands.executeCommand('revealInExplorer', item.resourceUri);
		} catch (error) {
			console.error('Failed to reveal task in Explorer:', error);
			vscode.window.showErrorMessage(`Failed to reveal task in Explorer: ${error}`);
		}
	});

	const renameTaskCommand = vscode.commands.registerCommand('timex.renameTask', async (item) => {
		if (!item || !item.resourceUri) {
			vscode.window.showErrorMessage('No task selected');
			return;
		}

		const fileUri = item.resourceUri;
		const filePath = fileUri.fsPath;
		const parentDir = path.dirname(filePath);
		const oldFileName = path.basename(filePath);
		const oldExtension = path.extname(oldFileName);

		const newName = await vscode.window.showInputBox({
			title: 'Rename Task File',
			prompt: 'Enter a new filename for the task',
			value: oldFileName,
			validateInput: (input) => {
				const trimmed = input.trim();
				if (!trimmed) {
					return 'Filename cannot be empty';
				}
				if (/[/\\?%*:|"<>]/.test(trimmed)) {
					return 'Filename contains invalid characters';
				}
				return null;
			}
		});

		if (!newName) {
			return;
		}

		const trimmedName = newName.trim();
		// Ensure a markdown extension is preserved if none supplied
		let finalName = trimmedName;
		if (path.extname(trimmedName) === '') {
			finalName = `${trimmedName}${oldExtension || '.md'}`;
		}

		if (finalName === oldFileName) {
			return;
		}

		const targetPath = path.join(parentDir, finalName);
		const targetUri = vscode.Uri.file(targetPath);

		try {
			await vscode.workspace.fs.rename(fileUri, targetUri, { overwrite: false });
			taskProvider.queueReveal(targetPath);
			taskProvider.refresh();
			vscode.window.showInformationMessage(`Renamed task to "${finalName}".`);
		} catch (error: any) {
			const message = error instanceof Error ? error.message : String(error);
			if (/Exists/i.test(message)) {
				vscode.window.showErrorMessage(`A file named "${finalName}" already exists.`);
			} else {
				console.error('Failed to rename task file:', error);
				vscode.window.showErrorMessage(`Failed to rename task file: ${message}`);
			}
		}
	});

	const renumberFilesCommand = vscode.commands.registerCommand('timex.renumberFiles', async () => {
		// Get the workspace folder
		if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
			vscode.window.showErrorMessage('No workspace folder found');
			return;
		}

		const workspaceFolder = vscode.workspace.workspaceFolders[0];
		const rootPath = workspaceFolder.uri.fsPath;

		try {
			// Show progress indicator
			await vscode.window.withProgress({
				location: vscode.ProgressLocation.Notification,
				title: 'Renumbering Files',
				cancellable: false
			}, async (progress) => {
				progress.report({ increment: 0, message: 'Scanning for numbered files...' });

				// Scan for numbered items
				const numberedItems = scanForNumberedItems(rootPath);

				if (numberedItems.length === 0) {
					vscode.window.showInformationMessage('No numbered files or folders found in workspace root. Files must start with digits followed by underscore (e.g., "001_file.md")');
					return;
				}

				progress.report({ increment: 20, message: `Found ${numberedItems.length} numbered items...` });

				// Verify that all names (after ordinal prefix) are unique
				const duplicateError = verifyNamesAreUnique(numberedItems);
				if (duplicateError) {
					vscode.window.showErrorMessage(duplicateError);
					return;
				}

				progress.report({ increment: 10, message: 'Validating unique names...' });

				// Perform the renumbering
				await renumberItems(numberedItems);

				progress.report({ increment: 50, message: 'Complete!' });

				vscode.window.showInformationMessage(`Successfully renumbered ${numberedItems.length} files and folders.`);
			});

		} catch (error) {
			vscode.window.showErrorMessage(`Failed to renumber files: ${error}`);
			console.error('Renumber files error:', error);
		}
	});

	const insertOrdinalFileCommand = vscode.commands.registerCommand('timex.insertOrdinalFile', async (uri: vscode.Uri) => {
		if (!uri) {
			vscode.window.showErrorMessage('No file selected');
			return;
		}

		const selectedFilePath = uri.fsPath;

		try {
			// Generate the next ordinal filename
			const nextOrdinalInfo = generateNextOrdinalFilename(selectedFilePath);

			if (!nextOrdinalInfo) {
				vscode.window.showErrorMessage('Selected file does not have an ordinal prefix (e.g., "001_filename.md")');
				return;
			}

			// Check if the new file already exists
			if (fs.existsSync(nextOrdinalInfo.fullPath)) {
				const overwrite = await vscode.window.showWarningMessage(
					`File "${nextOrdinalInfo.filename}" already exists. Do you want to overwrite it?`,
					{ modal: true },
					'Overwrite',
					'Cancel'
				);

				if (overwrite !== 'Overwrite') {
					return;
				}
			}

			// Create the new empty file
			fs.writeFileSync(nextOrdinalInfo.fullPath, '', 'utf8');

			// Open the file in the editor
			const fileUri = vscode.Uri.file(nextOrdinalInfo.fullPath);
			const document = await vscode.workspace.openTextDocument(fileUri);
			await vscode.window.showTextDocument(document);

			vscode.window.showInformationMessage(`Created and opened: ${nextOrdinalInfo.filename}`);

		} catch (error) {
			vscode.window.showErrorMessage(`Failed to create ordinal file: ${error}`);
			console.error('Insert ordinal file error:', error);
		}
	});

	const generateMarkdownCommand = vscode.commands.registerCommand('timex.generateMarkdown', async (resource?: vscode.Uri | vscode.Uri[]) => {
		const workspaceFolders = vscode.workspace.workspaceFolders;
		if (!workspaceFolders || workspaceFolders.length === 0) {
			vscode.window.showErrorMessage('No workspace folder found');
			return;
		}

		const candidateUri = Array.isArray(resource) ? resource[0] : resource;
		const workspace = candidateUri ? vscode.workspace.getWorkspaceFolder(candidateUri) ?? workspaceFolders[0] : workspaceFolders[0];
		const targetDirectory = workspace.uri.fsPath;
		const owningWorkspace = workspace;

		const createdIndexes: string[] = [];

		const generateMarkdownForDirectory = async (directory: string, progress: vscode.Progress<{ message?: string }>): Promise<boolean> => {
			const relativePath = path.relative(owningWorkspace.uri.fsPath, directory) || path.basename(directory) || '.';
			progress.report({ message: `Scanning ${relativePath}` });

			let numberedItems: NumberedItem[];
			try {
				numberedItems = scanForNumberedItems(directory);
			} catch (error: any) {
				throw new Error(`Failed to scan ${relativePath}: ${error instanceof Error ? error.message : String(error)}`);
			}

			if (numberedItems.length === 0) {
				return false;
			}

			const sections: string[] = [];
			let addedContent = false;

			for (const item of numberedItems) {
				if (item.isDirectory) {
					const childCreated = await generateMarkdownForDirectory(item.fullPath, progress);
					if (childCreated) {
						const childIndexPath = path.join(item.fullPath, '_index.md');
						const derivedTitle = await getTitleFromFile(childIndexPath);
						const folderLabel = derivedTitle ?? (stripOrdinalPrefix(item.originalName) || item.originalName);
						const linkTarget = encodeURI(path.posix.join(item.originalName, '_index.md'));
						sections.push(`# [${folderLabel}](${linkTarget})`);
						addedContent = true;
					}
				} else {
					const extension = path.extname(item.originalName).toLowerCase();
					if (IMAGE_EXTENSIONS.has(extension)) {
						const strippedName = stripOrdinalPrefix(item.originalName) || item.originalName;
						const altText = path.basename(strippedName, extension);
						const encodedSource = encodeURI(item.originalName);
						sections.push(`![${altText}](${encodedSource})`);
						addedContent = true;
					} else if (extension === '.md') {
						const contents = await fs.promises.readFile(item.fullPath, 'utf8');
						sections.push(contents.trimEnd());
						sections.push('---');
						addedContent = true;
					}
				}
			}

			if (!addedContent) {
				return false;
			}

			if (sections.length > 0 && sections[sections.length - 1] === '---') {
				sections.pop();
			}

			const indexPath = path.join(directory, '_index.md');
			const compiled = sections.join('\n\n').trimEnd() + '\n';
			await fs.promises.writeFile(indexPath, compiled, 'utf8');
			createdIndexes.push(indexPath);
			return true;
		};

		let rootCreated = false;

		try {
			await vscode.window.withProgress({
				location: vscode.ProgressLocation.Notification,
				title: 'Generating Markdown Indexes',
				cancellable: false
			}, async (progress) => {
				rootCreated = await generateMarkdownForDirectory(targetDirectory, progress);
			});

			if (createdIndexes.length === 0) {
				return;
			}

			const previewTarget = rootCreated
				? vscode.Uri.file(path.join(targetDirectory, '_index.md'))
				: vscode.Uri.file(createdIndexes[0]);
			await vscode.commands.executeCommand('markdown.showPreview', previewTarget);

			const relativeDir = path.relative(owningWorkspace.uri.fsPath, targetDirectory) || owningWorkspace.name;
			vscode.window.showInformationMessage(`Generated ${createdIndexes.length} index file(s) starting at ${relativeDir}`);
		} catch (error: any) {
			const message = error instanceof Error ? error.message : String(error);
			vscode.window.showErrorMessage(`Failed to generate markdown index: ${message}`);
		}
	});

	const cutByOrdinalCommand = vscode.commands.registerCommand('timex.cutByOrdinal', async (uri: vscode.Uri) => {
		if (!uri) {
			vscode.window.showErrorMessage('No file or folder selected');
			return;
		}

		const filePath = uri.fsPath;

		try {
			const stats = await fs.promises.lstat(filePath);
			const baseName = path.basename(filePath);
			const nameWithoutPrefix = stripOrdinalPrefix(baseName);

			ordinalClipboard = {
				sourcePath: filePath,
				originalName: baseName,
				nameWithoutPrefix,
				isDirectory: stats.isDirectory()
			};

			taskProvider.setCutIndicator(baseName);
			void vscode.commands.executeCommand('setContext', 'timex.hasOrdinalCutItem', true);
			vscode.window.showInformationMessage(`Cut ready: ${baseName}`);
		} catch (error: any) {
			const message = error instanceof Error ? error.message : String(error);
			vscode.window.showErrorMessage(`Failed to cut item: ${message}`);
			resetOrdinalClipboard();
		}
	});

	const pasteByOrdinalCommand = vscode.commands.registerCommand('timex.pasteByOrdinal', async (uri: vscode.Uri) => {
		if (!ordinalClipboard) {
			vscode.window.showErrorMessage('Cut an ordinal item before pasting.');
			return;
		}

		if (!uri) {
			vscode.window.showErrorMessage('No destination selected');
			return;
		}

		const targetPath = uri.fsPath;
		const targetBaseName = path.basename(targetPath);
		const targetOrdinal = extractOrdinalFromFilename(targetBaseName);

		if (targetOrdinal === null) {
			vscode.window.showErrorMessage('Select a target that includes an ordinal prefix (e.g., "00020_filename").');
			return;
		}

		const clipboardItem = ordinalClipboard;
		const targetDirectory = path.dirname(targetPath);

		try {
			await fs.promises.lstat(clipboardItem.sourcePath);
		} catch {
			vscode.window.showErrorMessage('The original item can no longer be found.');
			resetOrdinalClipboard();
			return;
		}

		try {
			await vscode.window.withProgress({
				location: vscode.ProgressLocation.Notification,
				title: 'Moving ordinal item',
				cancellable: false
			}, async (progress) => {
				progress.report({ message: 'Preparing...' });

				const performedRenames: Array<{ from: string; to: string }> = [];
				const sourceDirectory = path.dirname(clipboardItem.sourcePath);
				const uniqueSuffix = Math.random().toString(36).slice(2, 8);
				const extension = clipboardItem.isDirectory ? '' : path.extname(clipboardItem.nameWithoutPrefix);
				const tempName = `_timex_cut_${Date.now()}_${uniqueSuffix}${extension}`;
				const tempPath = path.join(sourceDirectory, tempName);

				let success = false;

				try {
					// Move the cut item to a temporary name so we can freely shift ordinals
					await fs.promises.rename(clipboardItem.sourcePath, tempPath);
					performedRenames.push({ from: tempPath, to: clipboardItem.sourcePath });

					progress.report({ message: 'Shifting existing ordinals...' });
					const numberedItems = scanForNumberedItems(targetDirectory);
					const itemsToShift = numberedItems
						.filter(item => {
							const ordinal = extractOrdinalFromFilename(item.originalName);
							return ordinal !== null && ordinal >= targetOrdinal;
						})
						.sort((a, b) => {
							const aOrdinal = extractOrdinalFromFilename(a.originalName) ?? 0;
							const bOrdinal = extractOrdinalFromFilename(b.originalName) ?? 0;
							return bOrdinal - aOrdinal; // Rename from the bottom up to avoid collisions
						});

					for (const item of itemsToShift) {
						const currentOrdinal = extractOrdinalFromFilename(item.originalName)!;
						const newOrdinal = currentOrdinal + 10;
						const newName = generateNumberPrefix(newOrdinal) + item.nameWithoutPrefix;
						const newPath = path.join(targetDirectory, newName);

						await fs.promises.rename(item.fullPath, newPath);
						performedRenames.push({ from: newPath, to: item.fullPath });
					}

					progress.report({ message: 'Placing cut item...' });
					const finalName = generateNumberPrefix(targetOrdinal) + clipboardItem.nameWithoutPrefix;
					const finalPath = path.join(targetDirectory, finalName);

					await fs.promises.rename(tempPath, finalPath);
					success = true;
				} catch (innerError) {
					for (const op of performedRenames.reverse()) {
						try {
							await fs.promises.rename(op.from, op.to);
						} catch (revertError) {
							console.error('Failed to revert ordinal rename:', revertError);
						}
					}
					throw innerError;
				}

				if (!success) {
					throw new Error('Unable to finalize ordinal move.');
				}
			});

			const destinationOrdinal = generateNumberPrefix(targetOrdinal).slice(0, -1);
			const destinationName = `${generateNumberPrefix(targetOrdinal)}${clipboardItem.nameWithoutPrefix}`;
			resetOrdinalClipboard();
			taskProvider.refresh();
			vscode.window.showInformationMessage(`Moved to ordinal ${destinationOrdinal}: ${destinationName}`);
		} catch (error: any) {
			const message = error instanceof Error ? error.message : String(error);
			vscode.window.showErrorMessage(`Failed to paste ordinal item: ${message}`);
		}
	});

	const moveOrdinal = async (uri: vscode.Uri | undefined, direction: 'up' | 'down') => {
		if (!uri) {
			vscode.window.showErrorMessage('No file or folder selected');
			return;
		}

		const selectedPath = uri.fsPath;
		const selectedName = path.basename(selectedPath);
		const selectedOrdinal = extractOrdinalFromFilename(selectedName);
		if (selectedOrdinal === null) {
			vscode.window.showErrorMessage('Selected item does not have an ordinal prefix (e.g., "00010_file.md").');
			return;
		}

		const directory = path.dirname(selectedPath);
		let numberedItems: NumberedItem[];
		try {
			numberedItems = scanForNumberedItems(directory);
		} catch (error: any) {
			const message = error instanceof Error ? error.message : String(error);
			vscode.window.showErrorMessage(`Failed to scan directory: ${message}`);
			return;
		}

		if (numberedItems.length === 0) {
			vscode.window.showInformationMessage('No ordinal items found to reorder.');
			return;
		}

		const currentIndex = numberedItems.findIndex(item => item.originalName === selectedName);
		if (currentIndex === -1) {
			vscode.window.showErrorMessage('Could not locate selected ordinal item in its directory.');
			return;
		}

		const neighborIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
		if (neighborIndex < 0 || neighborIndex >= numberedItems.length) {
			const positionText = direction === 'up' ? 'first' : 'last';
			vscode.window.showInformationMessage(`"${selectedName}" is already the ${positionText} item.`);
			return;
		}

		const neighbor = numberedItems[neighborIndex];
		const neighborOrdinal = extractOrdinalFromFilename(neighbor.originalName);
		if (neighborOrdinal === null) {
			vscode.window.showErrorMessage('Neighboring item lacks a valid ordinal prefix.');
			return;
		}

		const selectedSuffix = stripOrdinalPrefix(selectedName);
		const neighborSuffix = stripOrdinalPrefix(neighbor.originalName);
		const selectedNewName = generateNumberPrefix(neighborOrdinal) + selectedSuffix;
		const neighborNewName = generateNumberPrefix(selectedOrdinal) + neighborSuffix;

		const neighborPath = path.join(directory, neighbor.originalName);
		const neighborNewPath = path.join(directory, neighborNewName);
		const selectedNewPath = path.join(directory, selectedNewName);
		const tempName = `_timex_swap_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
		const tempPath = path.join(directory, tempName);

		const performedRenames: Array<{ from: string; to: string }> = [];

		try {
			await fs.promises.rename(selectedPath, tempPath);
			performedRenames.push({ from: tempPath, to: selectedPath });

			await fs.promises.rename(neighborPath, neighborNewPath);
			performedRenames.push({ from: neighborNewPath, to: neighborPath });

			await fs.promises.rename(tempPath, selectedNewPath);
		} catch (error: any) {
			for (const operation of performedRenames.reverse()) {
				try {
					if (fs.existsSync(operation.from)) {
						await fs.promises.rename(operation.from, operation.to);
					}
				} catch (revertError) {
					console.error('Failed to revert ordinal move:', revertError);
				}
			}

			const message = error instanceof Error ? error.message : String(error);
			vscode.window.showErrorMessage(`Failed to move ordinal item: ${message}`);
			return;
		}

		taskProvider.refresh();

		const directionLabel = direction === 'up' ? 'up' : 'down';
		const newOrdinalDisplay = String(neighborOrdinal).padStart(5, '0');
		const displayName = selectedSuffix || selectedName;
		vscode.window.showInformationMessage(`Moved "${displayName}" ${directionLabel}. New ordinal: ${newOrdinalDisplay}`);
	};

	const moveOrdinalUpCommand = vscode.commands.registerCommand('timex.moveOrdinalUp', async (uri: vscode.Uri) => {
		await moveOrdinal(uri, 'up');
	});

	const moveOrdinalDownCommand = vscode.commands.registerCommand('timex.moveOrdinalDown', async (uri: vscode.Uri) => {
		await moveOrdinal(uri, 'down');
	});

	const fixAttachmentLinksCommand = vscode.commands.registerCommand('timex.fixAttachmentLinks', async (uri: vscode.Uri) => {
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
					
					let content = await fs.promises.readFile(mdFilePath, 'utf8');
					let modified = false;
					let linksFixedInFile = 0;

					// Find all TIMEX- pattern links in the file
					const newContent = content.replace(TIMEX_LINK_REGEX, (fullMatch, _fullLink, linkText, linkUrl) => {
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
						if (fs.existsSync(absoluteLinkPath)) {
							// Link is not broken, leave it as-is
							return fullMatch;
						}

						// Link is broken - try to fix it using hash
						if (!hash) {
							// Can't extract hash, skip
							console.warn(`Could not extract hash from link: ${linkUrl}`);
							return fullMatch;
						}

						// Look up the hash in our attachment index
						const attachmentInfo = attachmentIndex.get(hash.toLowerCase());
						if (!attachmentInfo) {
							// Attachment not found anywhere in the folder
							if (!missingAttachments.includes(decodedUrl)) {
								missingAttachments.push(decodedUrl);
								console.warn(`Missing attachment: ${decodedUrl} (hash: ${hash})`);
							}
							return fullMatch;
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
						
						modified = true;
						linksFixedInFile++;
						
						return newLink;
					});

					// Write back if modified
					if (modified) {
						await fs.promises.writeFile(mdFilePath, newContent, 'utf8');
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
								await fs.promises.rename(attachmentInfo.fullPath, newFilePath);
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
	});

	// Add to subscriptions
	context.subscriptions.push(treeView);
	context.subscriptions.push(insertTimestampCommand);
	context.subscriptions.push(insertDateCommand);
	context.subscriptions.push(insertAttachmentCommand);
	context.subscriptions.push(insertImageFromClipboardCommand);
	context.subscriptions.push(selectPrimaryHashtagCommand);
	context.subscriptions.push(filterPriorityCommand);
	context.subscriptions.push(openFilterPanelCommand);
	context.subscriptions.push(searchTasksCommand);
	context.subscriptions.push(newTaskCommand);
	context.subscriptions.push(aboutCommand);
	context.subscriptions.push(openSettingsCommand);
	context.subscriptions.push(clearFiltersCommand);
	context.subscriptions.push(addDayCommand);
	context.subscriptions.push(addWeekCommand);
	context.subscriptions.push(addMonthCommand);
	context.subscriptions.push(addYearCommand);
	context.subscriptions.push(deleteTaskCommand);
	context.subscriptions.push(revealInExplorerCommand);
	context.subscriptions.push(renameTaskCommand);
	context.subscriptions.push(renumberFilesCommand);
	context.subscriptions.push(insertOrdinalFileCommand);
	context.subscriptions.push(generateMarkdownCommand);
	context.subscriptions.push(cutByOrdinalCommand);
	context.subscriptions.push(pasteByOrdinalCommand);
	context.subscriptions.push(moveOrdinalUpCommand);
	context.subscriptions.push(moveOrdinalDownCommand);
	context.subscriptions.push(fixAttachmentLinksCommand);
}

// This method is called when your extension is deactivated
export function deactivate() { }
