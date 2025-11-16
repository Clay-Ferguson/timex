// The module 'vscode' contains the VS Code extensibility API 
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { TaskProvider } from './model';
import {
	containsAnyConfiguredHashtag,
	getIncludeGlobPattern,
	TIMESTAMP_REGEX,
} from './utils';
import { formatTimestamp } from './utils';
import { parseTimestamp } from './utils';
import { ViewFilter, PriorityTag } from './constants';
import { TimexFilterPanel } from './filter-panel/filterPanel';
import { MarkdownFolderPreviewProvider } from './markdownFolderPreviewProvider';
import { renumberFiles, insertOrdinalFile, cutByOrdinal, pasteByOrdinal, OrdinalClipboardItem, moveOrdinal } from './ordinals';
import { fixAttachmentLinks, insertAttachment, insertImageFromClipboard } from './attachment';
import { generateMarkdown, previewFolderAsMarkdown } from './gen-markdown';
import { newTask } from './task';

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

	// Register the MarkdownFolderPreviewProvider for virtual folder preview documents
	const markdownFolderPreviewProvider = new MarkdownFolderPreviewProvider();
	const previewProviderDisposable = vscode.workspace.registerTextDocumentContentProvider(
		'timex-preview',
		markdownFolderPreviewProvider
	);
	context.subscriptions.push(previewProviderDisposable);

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

	const insertAttachmentCommand = vscode.commands.registerCommand('timex.insertAttachment', insertAttachment);

	const insertImageFromClipboardCommand = vscode.commands.registerCommand('timex.insertImageFromClipboard', insertImageFromClipboard);

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

	const openFilterPanelCommand = vscode.commands.registerCommand('timex.openFilterPanel', () => {
		try {
			const currentPriority = taskProvider.getCurrentPriorityFilter();
			const currentViewFilter = taskProvider.getCurrentViewFilter();
			const currentSearchQuery = taskProvider.getCurrentSearchQuery();
			
			TimexFilterPanel.show(
				context.extensionUri,
				(priority: PriorityTag, viewFilter: ViewFilter, searchQuery: string) => {
					// Apply all filters at once to avoid side effects of clearing other filters
					taskProvider.applyAllFilters(priority, viewFilter, searchQuery.trim());
				},
				currentPriority,
				currentViewFilter,
				currentSearchQuery
			);
		} catch (error) {
			console.error('[Extension] Error in openFilterPanel command:', error);
			vscode.window.showErrorMessage(`Filter panel error: ${error}`);
		}
	});

	const newTaskCommand = vscode.commands.registerCommand('timex.newTask', async () => {
		await newTask(taskProvider);
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

	const renumberFilesCommand = vscode.commands.registerCommand('timex.renumberFiles', renumberFiles);

	const insertOrdinalFileCommand = vscode.commands.registerCommand('timex.insertOrdinalFile', insertOrdinalFile);

	const generateMarkdownCommand = vscode.commands.registerCommand('timex.generateMarkdown', generateMarkdown);

	const cutByOrdinalCommand = vscode.commands.registerCommand(
		'timex.cutByOrdinal',
		(uri: vscode.Uri) => cutByOrdinal(
			uri,
			taskProvider,
			(item) => { ordinalClipboard = item; },
			resetOrdinalClipboard
		)
	);

	const pasteByOrdinalCommand = vscode.commands.registerCommand(
		'timex.pasteByOrdinal',
		(uri: vscode.Uri) => pasteByOrdinal(
			uri,
			() => ordinalClipboard,
			resetOrdinalClipboard,
			taskProvider
		)
	);

	const moveOrdinalUpCommand = vscode.commands.registerCommand('timex.moveOrdinalUp', async (uri: vscode.Uri) => {
		await moveOrdinal(uri, 'up', taskProvider);
	});

	const moveOrdinalDownCommand = vscode.commands.registerCommand('timex.moveOrdinalDown', async (uri: vscode.Uri) => {
		await moveOrdinal(uri, 'down', taskProvider);
	});

	const fixAttachmentLinksCommand = vscode.commands.registerCommand('timex.fixAttachmentLinks', fixAttachmentLinks);

	const previewFolderAsMarkdownCommand = vscode.commands.registerCommand('timex.previewFolderAsMarkdown', previewFolderAsMarkdown);

	// Add to subscriptions
	context.subscriptions.push(treeView);
	context.subscriptions.push(insertTimestampCommand);
	context.subscriptions.push(insertDateCommand);
	context.subscriptions.push(insertAttachmentCommand);
	context.subscriptions.push(insertImageFromClipboardCommand);
	context.subscriptions.push(selectPrimaryHashtagCommand);
	context.subscriptions.push(openFilterPanelCommand);
	context.subscriptions.push(newTaskCommand);
	context.subscriptions.push(aboutCommand);
	context.subscriptions.push(openSettingsCommand);
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
	context.subscriptions.push(previewFolderAsMarkdownCommand);
}

// This method is called when your extension is deactivated
export function deactivate() { }
