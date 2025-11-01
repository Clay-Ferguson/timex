// The module 'vscode' contains the VS Code extensibility API 
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
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
	NumberedItem
} from './utils';
import { parseTimestamp, formatTimestamp, TIMESTAMP_REGEX } from './pure-utils';
import { ViewFilter, PriorityTag, CompletionFilter } from './constants';

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
			let title = line.replace(/^\uFEFF/, '');
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

			// Check if task should be included based on completion filter
			let includeTask = false;
			if (hasTaskHashtag) {
				const completionFilter = taskProvider.getCompletionFilter();
				if (completionFilter === CompletionFilter.Any) {
					includeTask = true;
				} else if (completionFilter === CompletionFilter.Completed) {
					includeTask = isDoneTask;
				} else if (completionFilter === CompletionFilter.NotCompleted) {
					includeTask = !isDoneTask;
				}
			}

			if (includeTask) {
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
			} else {
				// File is no longer a task - do full refresh to remove it
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

	const selectPrimaryHashtagCommand = vscode.commands.registerCommand('timex.selectPrimaryHashtag', async () => {
		// Get current primary hashtag from task provider (which handles runtime overrides)
		const currentPrimaryHashtag = taskProvider.getPrimaryHashtag();

		// Get configuration for available hashtags
		const config = vscode.workspace.getConfiguration('timex');
		const hashtagsString = config.get<string>('hashtags', '#todo, #note');

		// Parse hashtags from comma-delimited string
		const hashtags = hashtagsString.split(',').map(tag => tag.trim()).filter(tag => tag.length > 0);

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
					// Clear runtime override and update workspace configuration for specific hashtag
					taskProvider.setPrimaryHashtagOverride(null);
					await config.update('primaryHashtag', selected.value, vscode.ConfigurationTarget.Workspace);

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
		const completionFilter = taskProvider.getCompletionFilter();
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
			// Separator
			{ label: '', value: 'separator', kind: vscode.QuickPickItemKind.Separator } as any,
			// View group
			{
				label: `${currentView === ViewFilter.All ? `$(check) ${div} Any Time ${div}` : `$(circle-outline) ${div} Any Time ${div}`}`,
				value: `view:${ViewFilter.All}`
			},
			{
				label: `${currentView === ViewFilter.DueSoon ? `$(check) ${ViewFilter.DueSoon}` : `$(circle-outline) ${ViewFilter.DueSoon}`}`,
				value: `view:${ViewFilter.DueSoon}`
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
			// Second separator
			{ label: '', value: 'separator2', kind: vscode.QuickPickItemKind.Separator } as any,
			// Completion group
			{
				label: `${completionFilter === CompletionFilter.Any ? `$(check) ${div} Any Completion ${div}` : `$(circle-outline) ${div} Any Completion ${div}`}`,
				value: `completion:${CompletionFilter.Any}`
			},
			{
				label: `${completionFilter === CompletionFilter.Completed ? '$(check) Done' : '$(circle-outline) Done'}`,
				value: `completion:${CompletionFilter.Completed}`
			},
			{
				label: `${completionFilter === CompletionFilter.NotCompleted ? '$(check) Not Done' : '$(circle-outline) Not Done'}`,
				value: `completion:${CompletionFilter.NotCompleted}`
			}
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
					case ViewFilter.DueSoon:
						taskProvider.refreshDueSoon();
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
			} else if (type === 'completion') {
				if (value === CompletionFilter.Any || value === CompletionFilter.Completed || value === CompletionFilter.NotCompleted) {
					taskProvider.setCompletionFilter(value as CompletionFilter);
				}
			}
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
			const hashtagsString = config.get<string>('hashtags', '#todo, #note');
			const hashtags = hashtagsString.split(',').map(tag => tag.trim()).filter(tag => tag.length > 0);
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
			const readmePath = vscode.Uri.file(path.join(extensionPath, 'README.md'));

			// Open the README.md file in VS Code's markdown preview
			await vscode.commands.executeCommand('markdown.showPreview', readmePath);
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

	// Add to subscriptions
	context.subscriptions.push(treeView);
	context.subscriptions.push(insertTimestampCommand);
	context.subscriptions.push(selectPrimaryHashtagCommand);
	context.subscriptions.push(filterPriorityCommand);
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
}

// This method is called when your extension is deactivated
export function deactivate() { }
