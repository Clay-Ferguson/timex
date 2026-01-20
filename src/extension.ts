import * as vscode from 'vscode';
import * as path from 'path';
import { TaskProvider } from './task-model';
import {
	getIncludeGlobPattern,
	TIMESTAMP_REGEX,
	closeMarkdownPreviews,
} from './utils';
import { ws_read_file } from './ws-file-util';
import { ViewFilter, PriorityTag } from './constants';
import { TimexFilterPanel } from './filter-panel/filterPanel';
import { renumberFiles, insertOrdinalFile, insertOrdinalFolder, cutByOrdinal, pasteByOrdinal, OrdinalClipboardItem, moveOrdinal, moveFileToFolder } from './ordinals';
import { fixLinks, insertAttachment, insertImageFromClipboard, insertFileLink } from './attachment';
import { generateMarkdown } from './gen-markdown';
import { deleteTask, newTask, renameTask } from './task';
import { addTimeToTask, insertDate, insertTimestamp } from './date-time';
import { mergeSentences } from './text-merge';
import { activateWriter } from './writer/writer';
import { MarkdownExplorerProvider, openMarkdownPreview } from './markdown-explorer';

// todo-0: move non-trivial functions defined inline into a separate module file

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
			const contentString = await ws_read_file(filePath);

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

	// Create and register the Markdown Explorer tree view
	const markdownExplorerProvider = new MarkdownExplorerProvider();
	const markdownTreeView = vscode.window.createTreeView('markdownExplorer', {
		treeDataProvider: markdownExplorerProvider
	});
	context.subscriptions.push(markdownTreeView);

	// Register command for opening markdown preview
	const openMarkdownPreviewCommand = vscode.commands.registerCommand(
		'timex.openMarkdownPreview',
		openMarkdownPreview
	);
	context.subscriptions.push(openMarkdownPreviewCommand);

	// Register refresh command for markdown explorer
	const refreshMarkdownExplorerCommand = vscode.commands.registerCommand(
		'timex.refreshMarkdownExplorer',
		() => markdownExplorerProvider.refresh()
	);
	context.subscriptions.push(refreshMarkdownExplorerCommand);

	// Register command to open file in editor from markdown explorer
	const openInEditorCommand = vscode.commands.registerCommand(
		'timex.openInEditor',
		async (item: { resourceUri: vscode.Uri }) => {
			if (item?.resourceUri) {
				// Close any open markdown preview tabs first for a cleaner experience
				await closeMarkdownPreviews();
				// Now open the file in the editor
				await vscode.commands.executeCommand('vscode.open', item.resourceUri);
			}
		}
	);
	context.subscriptions.push(openInEditorCommand);

	// Register command to reveal file in Explorer view from markdown explorer
	const revealInExplorerFromMarkdownCommand = vscode.commands.registerCommand(
		'timex.revealInExplorerFromMarkdown',
		async (item: { resourceUri: vscode.Uri }) => {
			if (item?.resourceUri) {
				await vscode.commands.executeCommand('revealInExplorer', item.resourceUri);
			}
		}
	);
	context.subscriptions.push(revealInExplorerFromMarkdownCommand);

	let ordinalClipboard: OrdinalClipboardItem | null = null;

	const resetOrdinalClipboard = () => {
		ordinalClipboard = null;
		taskProvider.clearCutIndicator();
		void vscode.commands.executeCommand('setContext', 'timex.hasOrdinalCutItem', false);
	};

	// Set up file watcher for automatic updates
	setupFileWatcher(context, taskProvider);

	// Activate the AI Writer functionality
	activateWriter(context);

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

	const insertTimestampCommand = vscode.commands.registerCommand('timex.insertTimestamp', insertTimestamp);

	const insertDateCommand = vscode.commands.registerCommand('timex.insertDate', insertDate);

	const insertAttachmentCommand = vscode.commands.registerCommand('timex.insertAttachment', insertAttachment);

	const insertFileLinkCommand = vscode.commands.registerCommand('timex.insertFileLink', insertFileLink);

	const insertImageFromClipboardCommand = vscode.commands.registerCommand('timex.insertImageFromClipboard', insertImageFromClipboard);

	const openFilterPanelCommand = vscode.commands.registerCommand('timex.openFilterPanel', async () => {
		try {
			const currentPriority = taskProvider.getCurrentPriorityFilter();
			const currentViewFilter = taskProvider.getCurrentViewFilter();
			const currentSearchQuery = taskProvider.getCurrentSearchQuery();
			const currentHashtag = taskProvider.getPrimaryHashtag();
			
			// Get available hashtags from configuration
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
			
			await TimexFilterPanel.show(
				context.extensionUri,
				(priority: PriorityTag, viewFilter: ViewFilter, searchQuery: string, hashtag: string) => {
					// Handle hashtag selection
					if (hashtag === 'all-tags') {
						// Set runtime override for all-tags mode
						taskProvider.setPrimaryHashtagOverride('all-tags');
					} else {
						// Clear runtime override and update user configuration for specific hashtag
						taskProvider.setPrimaryHashtagOverride(null);
						config.update('primaryHashtag', hashtag, vscode.ConfigurationTarget.Global);
						// Clear the cached primary hashtag to force reload from config
						taskProvider.clearPrimaryHashtagCache();
					}
					
					// Apply all filters at once to avoid side effects of clearing other filters
					taskProvider.applyAllFilters(priority, viewFilter, searchQuery.trim());
				},
				currentPriority,
				currentViewFilter,
				currentSearchQuery,
				currentHashtag,
				hashtags
			);
		} catch (error) {
			console.error('[Extension] Error in openFilterPanel command:', error);
			vscode.window.showErrorMessage(`Filter panel error: ${error}`);
		}
	});

	const newTaskCommand = vscode.commands.registerCommand('timex.newTask', async () => {
		await newTask(taskProvider);
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
		await deleteTask(item, taskProvider);
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
		await renameTask(item, taskProvider);
	});

	const renumberFilesCommand = vscode.commands.registerCommand('timex.renumberFiles', renumberFiles);

	const insertOrdinalFileCommand = vscode.commands.registerCommand('timex.insertOrdinalFile', insertOrdinalFile);

	const insertOrdinalFolderCommand = vscode.commands.registerCommand('timex.insertOrdinalFolder', insertOrdinalFolder);

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

	const moveFileToFolderCommand = vscode.commands.registerCommand('timex.moveFileToFolder', moveFileToFolder);

	const fixLinksCommand = vscode.commands.registerCommand('timex.fixLinks', fixLinks);

	const mergeSentencesCommand = vscode.commands.registerCommand('timex.mergeSentences', mergeSentences);

	// Add to subscriptions
	context.subscriptions.push(treeView);
	context.subscriptions.push(insertTimestampCommand);
	context.subscriptions.push(insertDateCommand);
	context.subscriptions.push(insertAttachmentCommand);
	context.subscriptions.push(insertFileLinkCommand);
	context.subscriptions.push(insertImageFromClipboardCommand);
	context.subscriptions.push(openFilterPanelCommand);
	context.subscriptions.push(newTaskCommand);
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
	context.subscriptions.push(insertOrdinalFolderCommand);
	context.subscriptions.push(generateMarkdownCommand);
	context.subscriptions.push(cutByOrdinalCommand);
	context.subscriptions.push(pasteByOrdinalCommand);
	context.subscriptions.push(moveOrdinalUpCommand);
	context.subscriptions.push(moveOrdinalDownCommand);
	context.subscriptions.push(moveFileToFolderCommand);
	context.subscriptions.push(fixLinksCommand);
	context.subscriptions.push(mergeSentencesCommand);
}

// This method is called when your extension is deactivated
export function deactivate() { }
