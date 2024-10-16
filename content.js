// Optimized function to find and click a button by matching its text content with regex patterns
function clickButtonByText(patterns) {
    const buttons = document.querySelectorAll('button');
    patterns = Array.isArray(patterns) ? patterns : [patterns];
    const regexPatterns = patterns.map(pattern => new RegExp(`^${pattern}$`));

    for (const button of buttons) {
        const textToMatch = button.childNodes.length === 1 ? button.textContent.trim() : button.innerText.trim();
        if (regexPatterns.some(regex => regex.test(textToMatch))) {
            button.click();
            break; // Exit after clicking the first matching button
        }
    }
}

// Optimized NetworkMonitor class
class NetworkMonitor {
    constructor() {
        this.requests = new Set();
        this.observers = new Set();
        this.intervalId = null;
        this.isProcessingComplete = false;
    }

    start() {
        const observer = new PerformanceObserver((list) => {
            const entries = list.getEntries().filter(entry => entry.entryType === 'resource');
            entries.forEach(entry => this.requests.add(entry));
            this.notifyObservers(entries);
        });

        observer.observe({ entryTypes: ['resource'] });
    }

    search(query) {
        const lowerQuery = query.toLowerCase();
        return Array.from(this.requests).filter(request => 
            request.name.toLowerCase().includes(lowerQuery)
        );
    }

    addObserver(callback) {
        this.observers.add(callback);
    }

    notifyObservers(entries) {
        this.observers.forEach(callback => callback(entries));
    }

    stopSearch() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
            console.log('Search stopped.');
        }
    }

    stopAll() {
        this.stopSearch();
        this.isProcessingComplete = true;
        this.observers.clear();
        console.log('All operations stopped.');
    }

    async parseM3U8(url) {
        try {
            const response = await fetch(url);
            const content = await response.text();
            return content.split('\n').filter(line => line.trim().startsWith('chunk') && line.endsWith('.aac'));
        } catch (error) {
            console.error('Error parsing M3U8:', error);
            return [];
        }
    }

    async downloadAudioSegments(m3u8Url) {
        if (this.isProcessingComplete) {
            console.log('Processing already complete. Skipping download.');
            return;
        }

        const baseUrl = m3u8Url.substring(0, m3u8Url.lastIndexOf('/') + 1);
        const segments = await this.parseM3U8(m3u8Url);
        chrome.runtime.sendMessage({action: "updateStatus", status: `Found ${segments.length} segments. Starting download...`});

        const batchSize = 10; // Update progress every 10 segments
        const audioBuffers = [];

        for (let i = 0; i < segments.length; i += batchSize) {
            if (this.isProcessingComplete) {
                chrome.runtime.sendMessage({action: "updateStatus", status: 'Processing was stopped during download. Aborting.'});
                return;
            }

            const batch = segments.slice(i, i + batchSize);
            const batchBuffers = await Promise.all(batch.map(async (segment, j) => {
                const segmentUrl = baseUrl + segment;
                try {
                    const response = await fetch(segmentUrl);
                    return await response.arrayBuffer();
                } catch (error) {
                    console.error(`Error downloading segment ${segment}:`, error);
                    return null;
                }
            }));

            audioBuffers.push(...batchBuffers);

            const progress = Math.min(((i + batch.length) / segments.length) * 100, 99);
            chrome.runtime.sendMessage({
                action: "updateProgress", 
                progress: progress
            });
            chrome.runtime.sendMessage({
                action: "updateStatus", 
                status: `Downloaded ${i + batch.length} of ${segments.length} segments`
            });
        }

        if (this.isProcessingComplete) {
            chrome.runtime.sendMessage({action: "updateStatus", status: 'Processing was stopped during download. Aborting.'});
            return;
        }

        chrome.runtime.sendMessage({action: "updateStatus", status: 'All segments downloaded. Starting concatenation...'});

        const validBuffers = audioBuffers.filter(buffer => buffer !== null);
        const totalLength = validBuffers.reduce((sum, buffer) => sum + buffer.byteLength, 0);
        const concatenatedBuffer = new Uint8Array(totalLength);

        let offset = 0;
        for (let i = 0; i < validBuffers.length; i++) {
            if (this.isProcessingComplete) {
                chrome.runtime.sendMessage({action: "updateStatus", status: 'Processing was stopped during concatenation. Aborting.'});
                return;
            }
            const buffer = validBuffers[i];
            concatenatedBuffer.set(new Uint8Array(buffer), offset);
            offset += buffer.byteLength;

            if (i % 10 === 0 || i === validBuffers.length - 1) {
                chrome.runtime.sendMessage({
                    action: "updateStatus", 
                    status: `Concatenated segment ${i + 1}/${validBuffers.length}`
                });
            }
        }

        chrome.runtime.sendMessage({action: "updateStatus", status: 'Concatenation complete. Generating filename...'});

        // Generate filename based on tweet content
        const tweetDiv = document.querySelector('div[data-testid="tweetText"]');
        const textContent = tweetDiv ? tweetDiv.innerText : '';
        const filename = textContent
            .trim()
            .replace(/\s+/g, '_')
            .replace(/[^\w\-]+/g, '')
            .toLowerCase();

        const finalFilename = filename ? `${filename}.aac` : 'concatenated_audio.aac';

        chrome.runtime.sendMessage({action: "updateStatus", status: `Saving the audio file as: ${finalFilename}`});
        this.saveBlob(new Blob([concatenatedBuffer]), finalFilename);
        chrome.runtime.sendMessage({action: "updateStatus", status: `Audio file saved as ${finalFilename}`});
        chrome.runtime.sendMessage({action: "updateProgress", progress: 100});
        chrome.runtime.sendMessage({action: "processingComplete"});
        this.stopAll();
    }

    saveBlob(blob, fileName) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        URL.revokeObjectURL(url);
        a.remove();
    }
}

const monitor = new NetworkMonitor();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "start") {
        monitor.start();

        // Add an observer to log and download new .m3u8 requests
        monitor.addObserver((entries) => {
            if (monitor.isProcessingComplete) return;
            const m3u8Entries = entries.filter(entry => entry.name.endsWith('.m3u8'));
            if (m3u8Entries.length > 0) {
                chrome.runtime.sendMessage({action: "updateStatus", status: 'New .m3u8 files detected. Starting download...'});
                m3u8Entries.forEach(entry => {
                    monitor.downloadAudioSegments(entry.name);
                });
            }
        });

        // Search for .m3u8 files every 5 seconds
        monitor.intervalId = setInterval(() => {
            if (monitor.isProcessingComplete) {
                monitor.stopSearch();
                return;
            }
            const m3u8Files = monitor.search('.m3u8');
            if (m3u8Files.length > 0) {
                chrome.runtime.sendMessage({action: "updateStatus", status: 'Found .m3u8 files. Starting download...'});
                clickButtonByText(["Play", "Pause", "Play recording"]);
                m3u8Files.forEach(file => {
                    monitor.downloadAudioSegments(file.name);
                });
                monitor.stopSearch();
            } else {
                chrome.runtime.sendMessage({action: "updateStatus", status: 'Searching for .m3u8 files...'});
            }
        }, 5000);

        // Call the function with a single pattern or an array of patterns
        clickButtonByText(["Play", "Pause", "Play recording"]);
    }
});