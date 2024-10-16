const progressBar = document.getElementById('progress-bar');
const progressText = document.getElementById('progress-text');
const status = document.getElementById('status');
const startBtn = document.getElementById('start-btn');

function updateProgress(progress) {
    const roundedProgress = Math.round(progress);
    progressBar.style.width = `${roundedProgress}%`;
    progressText.textContent = `${roundedProgress}%`;
}

function updateStatus(message) {
    status.textContent = message;
}

startBtn.addEventListener('click', () => {
    startBtn.disabled = true;
    chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
        chrome.tabs.sendMessage(tabs[0].id, {action: "start"});
    });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "updateProgress") {
        updateProgress(message.progress);
    } else if (message.action === "updateStatus") {
        updateStatus(message.status);
    } else if (message.action === "processingComplete") {
        startBtn.disabled = false;
    }
});