import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { PriorityTag, ViewFilter } from './constants';

export class TimexFilterPanel {
    private static currentPanel: TimexFilterPanel | undefined;
    private static cachedCss: string | undefined;
    private static cachedJs: string | undefined;
    private readonly panel: vscode.WebviewPanel;
    private disposables: vscode.Disposable[] = [];

    private constructor(
        panel: vscode.WebviewPanel,
        extensionPath: string,
        private readonly onFilterApplied: (priority: PriorityTag, viewFilter: ViewFilter) => void,
        private readonly currentPriority: PriorityTag,
        private readonly currentViewFilter: ViewFilter
    ) {
        this.panel = panel;

        try {
            // Load CSS if not already cached
            if (!TimexFilterPanel.cachedCss) {
                TimexFilterPanel.cachedCss = this.loadCss(extensionPath);
            }

            // Load JS if not already cached
            if (!TimexFilterPanel.cachedJs) {
                TimexFilterPanel.cachedJs = this.loadJs(extensionPath);
            }

            this.panel.webview.html = this.getHtmlContent();
        } catch (error) {
            console.error('[TimexFilterPanel] Error during initialization:', error);
            vscode.window.showErrorMessage(`Failed to initialize filter panel: ${error}`);
            throw error;
        }

        // Handle messages from the webview
        this.panel.webview.onDidReceiveMessage(
            message => {
                switch (message.command) {
                    case 'apply':
                        this.onFilterApplied(
                            message.priority as PriorityTag,
                            message.viewFilter as ViewFilter
                        );
                        this.panel.dispose();
                        break;
                    case 'cancel':
                        this.panel.dispose();
                        break;
                }
            },
            null,
            this.disposables
        );

        // Clean up when panel is closed
        this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    }

    public static show(
        extensionUri: vscode.Uri,
        onFilterApplied: (priority: PriorityTag, viewFilter: ViewFilter) => void,
        currentPriority: PriorityTag,
        currentViewFilter: ViewFilter
    ) {
        try {
            // If we already have a panel, show it
            if (TimexFilterPanel.currentPanel) {
                TimexFilterPanel.currentPanel.panel.reveal();
                return;
            }

            // Create a new panel
            const panel = vscode.window.createWebviewPanel(
                'timexFilterPanel',
                'Timex Filters',
                vscode.ViewColumn.One,
                {
                    enableScripts: true,
                    retainContextWhenHidden: true
                }
            );

            TimexFilterPanel.currentPanel = new TimexFilterPanel(
                panel,
                extensionUri.fsPath,
                onFilterApplied,
                currentPriority,
                currentViewFilter
            );
        } catch (error) {
            console.error('[TimexFilterPanel] Error in show():', error);
            vscode.window.showErrorMessage(`Failed to show filter panel: ${error}`);
            throw error;
        }
    }

    private loadCss(extensionPath: string): string {
        try {
            const cssPath = path.join(extensionPath, 'out', 'filterPanel.css');
            return fs.readFileSync(cssPath, 'utf8');
        } catch (error) {
            console.error('Failed to load filterPanel.css:', error);
            return '/* CSS file not found */';
        }
    }

    private loadJs(extensionPath: string): string {
        try {
            const jsPath = path.join(extensionPath, 'out', 'filterPanelWebview.js');
            return fs.readFileSync(jsPath, 'utf8');
        } catch (error) {
            console.error('Failed to load filterPanelWebview.js:', error);
            return '/* JS file not found */';
        }
    }

    private getPriorityFilterRadioGroup(): string {
        return `
            <div class="radio-option">
                <input type="radio" id="priority-any" name="priority" value="${PriorityTag.Any}" ${this.currentPriority === PriorityTag.Any ? 'checked' : ''}>
                <label for="priority-any">Any Priority</label>
            </div>
            <div class="radio-option">
                <input type="radio" id="priority-high" name="priority" value="${PriorityTag.High}" ${this.currentPriority === PriorityTag.High ? 'checked' : ''}>
                <label for="priority-high">Priority 1 (High)</label>
            </div>
            <div class="radio-option">
                <input type="radio" id="priority-medium" name="priority" value="${PriorityTag.Medium}" ${this.currentPriority === PriorityTag.Medium ? 'checked' : ''}>
                <label for="priority-medium">Priority 2 (Medium)</label>
            </div>
            <div class="radio-option">
                <input type="radio" id="priority-low" name="priority" value="${PriorityTag.Low}" ${this.currentPriority === PriorityTag.Low ? 'checked' : ''}>
                <label for="priority-low">Priority 3 (Low)</label>
            </div>
            <div class="radio-option">
                <input type="radio" id="priority-none" name="priority" value="${PriorityTag.None}" ${this.currentPriority === PriorityTag.None ? 'checked' : ''}>
                <label for="priority-none">No Priority</label>
            </div>`;
    }

    private getTimeFilterRadioGroup(): string {
        return `
            <div class="radio-option">
                <input type="radio" id="time-all" name="timeFilter" value="${ViewFilter.All}" ${this.currentViewFilter === ViewFilter.All ? 'checked' : ''}>
                <label for="time-all">Due Anytime</label>
            </div>
            <div class="radio-option">
                <input type="radio" id="time-7days" name="timeFilter" value="${ViewFilter.DueIn7Days}" ${this.currentViewFilter === ViewFilter.DueIn7Days ? 'checked' : ''}>
                <label for="time-7days">Due in 7 Days</label>
            </div>
            <div class="radio-option">
                <input type="radio" id="time-14days" name="timeFilter" value="${ViewFilter.DueIn14Days}" ${this.currentViewFilter === ViewFilter.DueIn14Days ? 'checked' : ''}>
                <label for="time-14days">Due in 14 Days</label>
            </div>
            <div class="radio-option">
                <input type="radio" id="time-30days" name="timeFilter" value="${ViewFilter.DueIn30Days}" ${this.currentViewFilter === ViewFilter.DueIn30Days ? 'checked' : ''}>
                <label for="time-30days">Due in 30 Days</label>
            </div>
            <div class="radio-option">
                <input type="radio" id="time-today" name="timeFilter" value="${ViewFilter.DueToday}" ${this.currentViewFilter === ViewFilter.DueToday ? 'checked' : ''}>
                <label for="time-today">Due Today</label>
            </div>
            <div class="radio-option">
                <input type="radio" id="time-future" name="timeFilter" value="${ViewFilter.FutureDueDates}" ${this.currentViewFilter === ViewFilter.FutureDueDates ? 'checked' : ''}>
                <label for="time-future">Future Due Dates</label>
            </div>
            <div class="radio-option">
                <input type="radio" id="time-overdue" name="timeFilter" value="${ViewFilter.Overdue}" ${this.currentViewFilter === ViewFilter.Overdue ? 'checked' : ''}>
                <label for="time-overdue">Overdue</label>
            </div>`;
    }

    private getHtmlContent(): string {
        const nonce = this.getNonce();
        const css = TimexFilterPanel.cachedCss || '';
        const js = TimexFilterPanel.cachedJs || '';
        const priorityFilterRadioGroup = this.getPriorityFilterRadioGroup();
        const timeFilterRadioGroup = this.getTimeFilterRadioGroup();

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
    <title>Timex Filters</title>
    <style>
        ${css}
    </style>
</head>
<body>
    <div class="filters-container">
        <div class="filter-section">
            <h2>Priority Filter</h2>
            <div class="radio-group">
                ${priorityFilterRadioGroup}
            </div>
        </div>

        <div class="filter-section">
            <h2>Time Filter</h2>
            <div class="radio-group">
                ${timeFilterRadioGroup}
            </div>
        </div>
    </div>

    <div class="button-group">
        <button id="applyBtn">OK</button>
        <button class="secondary" id="cancelBtn">Cancel</button>
    </div>

    <script nonce="${nonce}">
        ${js}
    </script>
</body>
</html>`;
    }

    private getNonce(): string {
        let text = '';
        const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        for (let i = 0; i < 32; i++) {
            text += possible.charAt(Math.floor(Math.random() * possible.length));
        }
        return text;
    }

    private dispose() {
        TimexFilterPanel.currentPanel = undefined;

        // Clean up resources
        this.panel.dispose();

        while (this.disposables.length) {
            const disposable = this.disposables.pop();
            if (disposable) {
                disposable.dispose();
            }
        }
    }
}
