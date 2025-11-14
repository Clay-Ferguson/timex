import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { PriorityTag, ViewFilter } from '../constants';

export class TimexFilterPanel {
    private static currentPanel: TimexFilterPanel | undefined;
    private static cachedCss: string | undefined;
    private static cachedJs: string | undefined;
    private static cachedHtml: string | undefined;
    private readonly panel: vscode.WebviewPanel;
    private disposables: vscode.Disposable[] = [];

    private constructor(
        panel: vscode.WebviewPanel,
        extensionPath: string,
        private readonly onFilterApplied: (priority: PriorityTag, viewFilter: ViewFilter, searchQuery: string) => void,
        private readonly currentPriority: PriorityTag,
        private readonly currentViewFilter: ViewFilter,
        private readonly currentSearchQuery: string
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

            // Load HTML if not already cached
            if (!TimexFilterPanel.cachedHtml) {
                TimexFilterPanel.cachedHtml = this.loadHtml(extensionPath);
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
                            message.viewFilter as ViewFilter,
                            message.searchQuery || ''
                        );
                        // COMMENTED OUT: Keep panel open after applying filters
                        // this.panel.dispose();
                        break;
                    case 'clear':
                        // Apply default filters (clears all filters)
                        this.onFilterApplied(
                            PriorityTag.Any,
                            ViewFilter.All,
                            ''
                        );
                        // COMMENTED OUT: Keep panel open after clearing filters
                        // this.panel.dispose();
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
        onFilterApplied: (priority: PriorityTag, viewFilter: ViewFilter, searchQuery: string) => void,
        currentPriority: PriorityTag,
        currentViewFilter: ViewFilter,
        currentSearchQuery: string
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
                currentViewFilter,
                currentSearchQuery
            );
        } catch (error) {
            console.error('[TimexFilterPanel] Error in show():', error);
            vscode.window.showErrorMessage(`Failed to show filter panel: ${error}`);
            throw error;
        }
    }

    private loadCss(extensionPath: string): string {
        try {
            const cssPath = path.join(extensionPath, 'out', 'filter-panel', 'filterPanel.css');
            return fs.readFileSync(cssPath, 'utf8');
        } catch (error) {
            console.error('Failed to load filterPanel.css:', error);
            return '/* CSS file not found */';
        }
    }

    private loadJs(extensionPath: string): string {
        try {
            const jsPath = path.join(extensionPath, 'out', 'filter-panel', 'filterPanelWebview.js');
            return fs.readFileSync(jsPath, 'utf8');
        } catch (error) {
            console.error('Failed to load filterPanelWebview.js:', error);
            return '/* JS file not found */';
        }
    }

    private loadHtml(extensionPath: string): string {
        try {
            const htmlPath = path.join(extensionPath, 'out', 'filter-panel', 'filterPanel.html');
            return fs.readFileSync(htmlPath, 'utf8');
        } catch (error) {
            console.error('Failed to load filterPanel.html:', error);
            return '<!DOCTYPE html><html><body>HTML template not found</body></html>';
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
        // If current view filter is Search, default to All
        const effectiveViewFilter = this.currentViewFilter === ViewFilter.Search ? ViewFilter.All : this.currentViewFilter;
        
        return `
            <div class="radio-option">
                <input type="radio" id="time-all" name="timeFilter" value="${ViewFilter.All}" ${effectiveViewFilter === ViewFilter.All ? 'checked' : ''}>
                <label for="time-all">Due Anytime</label>
            </div>
            <div class="radio-option">
                <input type="radio" id="time-7days" name="timeFilter" value="${ViewFilter.DueIn7Days}" ${effectiveViewFilter === ViewFilter.DueIn7Days ? 'checked' : ''}>
                <label for="time-7days">Due in 7 Days</label>
            </div>
            <div class="radio-option">
                <input type="radio" id="time-14days" name="timeFilter" value="${ViewFilter.DueIn14Days}" ${effectiveViewFilter === ViewFilter.DueIn14Days ? 'checked' : ''}>
                <label for="time-14days">Due in 14 Days</label>
            </div>
            <div class="radio-option">
                <input type="radio" id="time-30days" name="timeFilter" value="${ViewFilter.DueIn30Days}" ${effectiveViewFilter === ViewFilter.DueIn30Days ? 'checked' : ''}>
                <label for="time-30days">Due in 30 Days</label>
            </div>
            <div class="radio-option">
                <input type="radio" id="time-today" name="timeFilter" value="${ViewFilter.DueToday}" ${effectiveViewFilter === ViewFilter.DueToday ? 'checked' : ''}>
                <label for="time-today">Due Today</label>
            </div>
            <div class="radio-option">
                <input type="radio" id="time-future" name="timeFilter" value="${ViewFilter.FutureDueDates}" ${effectiveViewFilter === ViewFilter.FutureDueDates ? 'checked' : ''}>
                <label for="time-future">Future Due Dates</label>
            </div>
            <div class="radio-option">
                <input type="radio" id="time-overdue" name="timeFilter" value="${ViewFilter.Overdue}" ${effectiveViewFilter === ViewFilter.Overdue ? 'checked' : ''}>
                <label for="time-overdue">Overdue</label>
            </div>`;
    }

    private getHtmlContent(): string {
        const nonce = this.getNonce();
        const css = TimexFilterPanel.cachedCss || '';
        const js = TimexFilterPanel.cachedJs || '';
        const html = TimexFilterPanel.cachedHtml || '';
        const priorityFilterRadioGroup = this.getPriorityFilterRadioGroup();
        const timeFilterRadioGroup = this.getTimeFilterRadioGroup();

        return html
            .replace(/<!-- NONCE -->/g, nonce)
            .replace(/\/\* CSS \*\//g, css)
            .replace(/\/\* JS \*\//g, js)
            .replace(/<!-- PRIORITY_FILTER_RADIO_GROUP -->/g, priorityFilterRadioGroup)
            .replace(/<!-- TIME_FILTER_RADIO_GROUP -->/g, timeFilterRadioGroup)
            .replace(/<!-- SEARCH_QUERY -->/g, this.currentSearchQuery);
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
