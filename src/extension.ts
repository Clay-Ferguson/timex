import * as vscode from 'vscode';
import * as path from 'path';
import { TaskProvider } from './model';
import {
	getIncludeGlobPattern,
	TIMESTAMP_REGEX,
	ws_exists,
	ws_read_file,
} from './utils';
import { ViewFilter, PriorityTag } from './constants';
import { TimexFilterPanel } from './filter-panel/filterPanel';
import { MarkdownFolderPreviewProvider } from './markdownFolderPreviewProvider';
import { renumberFiles, insertOrdinalFile, cutByOrdinal, pasteByOrdinal, OrdinalClipboardItem, moveOrdinal, moveFileToFolder } from './ordinals';
import { fixAttachmentLinks, insertAttachment, insertImageFromClipboard, insertFileLink } from './attachment';
import { generateMarkdown, previewFolderAsMarkdown } from './gen-markdown';
import { deleteTask, newTask, renameTask } from './task';
import { addTimeToTask, insertDate, insertTimestamp } from './date-time';
import { mergeSentences } from './text-merge';

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

	const insertTimestampCommand = vscode.commands.registerCommand('timex.insertTimestamp', insertTimestamp);

	const insertDateCommand = vscode.commands.registerCommand('timex.insertDate', insertDate);

	const insertAttachmentCommand = vscode.commands.registerCommand('timex.insertAttachment', insertAttachment);

	const insertFileLinkCommand = vscode.commands.registerCommand('timex.insertFileLink', insertFileLink);

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

	const openFilterPanelCommand = vscode.commands.registerCommand('timex.openFilterPanel', async () => {
		try {
			const currentPriority = taskProvider.getCurrentPriorityFilter();
			const currentViewFilter = taskProvider.getCurrentViewFilter();
			const currentSearchQuery = taskProvider.getCurrentSearchQuery();
			
			await TimexFilterPanel.show(
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
			if (!await ws_exists(readmePath)) {
				readmePath = path.join(extensionPath, 'readme.md');
			}
			
			// Verify the README file exists
			if (!await ws_exists(readmePath)) {
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

	const fixAttachmentLinksCommand = vscode.commands.registerCommand('timex.fixAttachmentLinks', fixAttachmentLinks);

	const previewFolderAsMarkdownCommand = vscode.commands.registerCommand('timex.previewFolderAsMarkdown', previewFolderAsMarkdown);

	const mergeSentencesCommand = vscode.commands.registerCommand('timex.mergeSentences', mergeSentences);

	// Add to subscriptions
	context.subscriptions.push(treeView);
	context.subscriptions.push(insertTimestampCommand);
	context.subscriptions.push(insertDateCommand);
	context.subscriptions.push(insertAttachmentCommand);
	context.subscriptions.push(insertFileLinkCommand);
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
	context.subscriptions.push(moveFileToFolderCommand);
	context.subscriptions.push(fixAttachmentLinksCommand);
	context.subscriptions.push(previewFolderAsMarkdownCommand);
	context.subscriptions.push(mergeSentencesCommand);
}

// This method is called when your extension is deactivated
export function deactivate() { }
