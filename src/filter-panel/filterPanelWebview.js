// Timex Filter Panel JavaScript
const vscode = acquireVsCodeApi();

document.getElementById('applyBtn').addEventListener('click', () => {
    const selectedPriority = document.querySelector('input[name="priority"]:checked').value;
    const selectedTimeFilter = document.querySelector('input[name="timeFilter"]:checked').value;
    const selectedHashtag = document.querySelector('input[name="hashtag"]:checked').value;
    const searchQuery = document.getElementById('searchInput').value.trim();
    vscode.postMessage({
        command: 'apply',
        priority: selectedPriority,
        viewFilter: selectedTimeFilter,
        hashtag: selectedHashtag,
        searchQuery: searchQuery
    });
});

document.getElementById('cancelBtn').addEventListener('click', () => {
    vscode.postMessage({
        command: 'cancel'
    });
});

document.getElementById('clearBtn').addEventListener('click', () => {
    // Reset UI elements to defaults
    document.getElementById('searchInput').value = '';
    document.getElementById('priority-any').checked = true;
    document.getElementById('time-all').checked = true;
    document.getElementById('hashtag-all').checked = true;
    
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
