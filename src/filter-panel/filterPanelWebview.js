// Timex Filter Panel JavaScript
const vscode = acquireVsCodeApi();

document.getElementById('applyBtn').addEventListener('click', () => {
    const selectedPriority = document.querySelector('input[name="priority"]:checked').value;
    const selectedTimeFilter = document.querySelector('input[name="timeFilter"]:checked').value;
    const searchQuery = document.getElementById('searchInput').value.trim();
    vscode.postMessage({
        command: 'apply',
        priority: selectedPriority,
        viewFilter: selectedTimeFilter,
        searchQuery: searchQuery
    });
});

document.getElementById('cancelBtn').addEventListener('click', () => {
    vscode.postMessage({
        command: 'cancel'
    });
});

document.getElementById('clearBtn').addEventListener('click', () => {
    vscode.postMessage({
        command: 'clear'
    });
});

// Allow Enter key to submit
document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        document.getElementById('applyBtn').click();
    } else if (e.key === 'Escape') {
        document.getElementById('cancelBtn').click();
    }
});
