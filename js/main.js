/*
 Copyright (C) 2025 Preborned Software

 This program is free software: you can redistribute it and/or modify
 it under the terms of the GNU General Public License as published by
 the Free Software Foundation, either version 3 of the License, or
 (at your option) any later version.

 This program is distributed in the hope that it will be useful,
 but WITHOUT ANY WARRANTY; without even the implied warranty of
 MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 GNU General Public License for more details.

 You should have received a copy of the GNU General Public License
 along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

let CONFIG = {};
let guideData = { channels: [], programmes: [] };
let programsByChannel = [];
let selectedChannelIndex = 0;
let selectedProgramIndex = 0;
let userCoords = null;
let guideStartTime;
let hlsInstance = null;
let currentStreamInfo = {};
let errorSound = null;

const sampleXmlTvData = `
<tv>
  <channel id="11"><display-name>11 NUTS</display-name><icon src="https://placehold.co/100x100/000000/FFFFFF?text=NUTS" /></channel>
  <channel id="12"><display-name>12 SCI</display-name><icon src="https://placehold.co/100x100/1a237e/FFFFFF?text=SCI" /></channel>
  <programme start="20251008100000 +0000" stop="20251008110000 +0000" channel="12"><title>How It's Made</title><desc>Today: George Washington, Blankets, Pillows, and More!</desc><episode-num system="xmltv_ns">0.14.2/1</episode-num></programme>
  <programme start="20251008103000 +0000" stop="20251008113000 +0000" channel="11"><title>Ball Fondlers</title><desc>The epic finale.</desc><episode-num system="xmltv_ns">2.3.0/1</episode-num></programme>
</tv>
`;

document.addEventListener('DOMContentLoaded', async () => {
    errorSound = document.getElementById('error-sound');
    try {
        await loadConfig();
        applyConfigToUI();
        displayInitialMessage();

        const { data, format } = await fetchGuideData();
        const m3uStreams = await fetchM3UData();
        
        let parsedData;
        if (format === 'xml') {
            const parser = new DOMParser();
            const xmlDoc = parser.parseFromString(data, "application/xml");
            parsedData = parseXmlGuide(xmlDoc);
        } else { 
            parsedData = parseJsonGuide(JSON.parse(data));
        }

        initializeGuide(parsedData, m3uStreams);

    } catch (error) {
        console.error("Initialization failed:", error);
        displayInitialMessage('Error', 'Could not start the guide. Check console for details.');
    }

    document.addEventListener('keydown', handleKeyPress);
    syncScrollbars();
    setupPlayerControls();

    const resumeChannelId = sessionStorage.getItem('returnFromPlayerChannelId');
    if (resumeChannelId && guideData.channels.length > 0) { 
        const channelToResume = guideData.channels.find(ch => ch.id === resumeChannelId);
        if (channelToResume && channelToResume.stream) {
            loadStream(channelToResume);
        }
        sessionStorage.removeItem('returnFromPlayerChannelId');
    }
});


async function loadConfig() {
    const response = await fetch('config.xml');
    if (!response.ok) throw new Error("config.xml not found or could not be loaded.");
    const xmlString = await response.text();
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlString, "application/xml");

    CONFIG.xmltvUrl = xmlDoc.querySelector('xmltvUrl').textContent;
    CONFIG.jsonUrl = xmlDoc.querySelector('jsonUrl').textContent;
    CONFIG.m3uUrl = xmlDoc.querySelector('m3uUrl').textContent;
    CONFIG.openWeatherApiKey = xmlDoc.querySelector('openWeatherApiKey').textContent;
    CONFIG.tmdbApiKey = xmlDoc.querySelector('tmdbApiKey').textContent;
    CONFIG.playerUrl = xmlDoc.querySelector('player url').textContent;
    CONFIG.hotlinkUrl = xmlDoc.querySelector('player hotlinkUrl').textContent;
    CONFIG.enableLogo = xmlDoc.querySelector('enableLogo').textContent === 'true';
    CONFIG.logoUrl = xmlDoc.querySelector('logoUrl').textContent;
    CONFIG.enableWeather = xmlDoc.querySelector('enableWeather').textContent === 'true';
    CONFIG.messages = Array.from(xmlDoc.querySelectorAll('messages message')).map(m => m.textContent);
    CONFIG.streamMappings = Array.from(xmlDoc.querySelectorAll('streamMappings stream')).map(s => ({
        channelId: s.getAttribute('channelId'),
        type: s.getAttribute('type'),
        url: s.textContent.trim()
    }));

    CONFIG.colors = {};
    const colorNodes = xmlDoc.querySelectorAll('colors *');
    colorNodes.forEach(node => {
        CONFIG.colors[`--${node.tagName.toLowerCase()}`] = node.textContent;
    });

    CONFIG.customChannels = Array.from(xmlDoc.querySelectorAll('customChannels channel')).map(ch => ({
        id: ch.getAttribute('id'),
        number: ch.getAttribute('number'),
        name: ch.getAttribute('name'),
        logo: ch.getAttribute('logo'),
        stream: {
            type: ch.querySelector('stream')?.getAttribute('type'),
            url: ch.querySelector('stream')?.textContent.trim()
        },
        programTitle: ch.querySelector('programTitle')?.textContent || '24/7 Broadcast',
        episodeNum: ch.querySelector('episodeNum')?.textContent || '',
        description: ch.querySelector('description')?.textContent || ''
    }));

    CONFIG.guideViewHours = 2;
    CONFIG.totalGuideHours = 12;
}

function applyConfigToUI() {
    for (const [key, value] of Object.entries(CONFIG.colors)) {
        document.documentElement.style.setProperty(key.replace(/([a-z])([A-Z])/g, '$1-$2'), value);
    }
    
    const logoEl = document.getElementById('guide-logo-placeholder');
    const weatherEl = document.getElementById('guide-weather');
    const forecastWidget = document.getElementById('hourly-forecast-widget');

    if (CONFIG.enableLogo && logoEl) {
        if (CONFIG.logoUrl) {
            logoEl.style.backgroundImage = `url('${CONFIG.logoUrl}')`;
            logoEl.style.border = 'none';
        }
    } else if(logoEl) {
        logoEl.style.display = 'none';
    }

    if (!CONFIG.enableWeather) {
        if (weatherEl) weatherEl.style.display = 'none';
        const menuForecastWidgetContainer = document.querySelector('#side-menu #hourly-forecast-widget');
        if (menuForecastWidgetContainer) menuForecastWidgetContainer.style.display = 'none';
    }
}

async function fetchGuideData() {
    if (CONFIG.xmltvUrl) {
        try {
            const response = await fetch(CONFIG.xmltvUrl);
            if (!response.ok) throw new Error('XMLTV fetch failed, trying JSON.');
            const data = await response.text();
            return { data, format: 'xml' };
        } catch (error) { console.warn(error.message); }
    }

    if (CONFIG.jsonUrl) {
        try {
            const response = await fetch(CONFIG.jsonUrl);
            if (!response.ok) throw new Error('JSON fetch failed, using sample data.');
            const data = await response.text();
            return { data, format: 'json' };
        } catch (error) { console.warn(error.message); }
    }
    
    console.error('All data sources failed. Loading sample XML data.');
    displayInitialMessage('Error', 'Could not fetch guide data. Loading sample data instead.');
    return { data: sampleXmlTvData, format: 'xml' };
}

async function fetchM3UData() {
    if (!CONFIG.m3uUrl) return {};

    try {
        const response = await fetch(CONFIG.m3uUrl);
        if (!response.ok) throw new Error('M3U fetch failed.');
        const m3uText = await response.text();
        return parseM3U(m3uText);
    } catch (error) {
        console.error("Failed to fetch or parse M3U:", error.message);
        return {};
    }
}

function parseM3U(m3uText) {
    const lines = m3uText.split('\n');
    const streams = {};
    let currentTvgId = null;

    for (const line of lines) {
        if (line.startsWith('#EXTINF:')) {
            const tvgIdMatch = line.match(/tvg-id="([^"]+)"/);
            currentTvgId = tvgIdMatch ? tvgIdMatch[1] : null;
        } else if (line.trim() && !line.startsWith('#') && currentTvgId) {
            const url = line.trim();
            const type = url.includes('.m3u8') ? 'hls' : (url.includes('youtube.com') || url.includes('youtu.be') ? 'youtube' : 'unknown');
            if (type !== 'unknown') {
                streams[currentTvgId] = { type, url };
            }
            currentTvgId = null;
        }
    }
    return streams;
}


function initializeGuide(parsedData, m3uStreams) {
    guideData = mergeAndSortData(parsedData, m3uStreams);
    guideStartTime = new Date();
    guideStartTime.setHours(guideStartTime.getHours() - 3);
    guideStartTime.setMinutes(0, 0, 0);
    renderGuide();
    selectInitialProgram();
    setupDynamicUpdates();
    startWidgetSlideshow();
    startMessageBox();
}

function setupDynamicUpdates() {
    updateTime(); 
    setInterval(updateTime, 1000);

    if (CONFIG.enableWeather) {
        navigator.geolocation.getCurrentPosition(pos => {
            userCoords = pos.coords;
            fetchWeather();
            fetchHourlyForecast();
            setInterval(fetchWeather, 15 * 60 * 1000);
            setInterval(fetchHourlyForecast, 60 * 60 * 1000);
        }, err => console.error("Geolocation error:", err.message));
    }
}

function syncScrollbars() {
    const gridContainer = document.getElementById('program-grid-container');
    const channelList = document.getElementById('channel-list');
    const timeBarContent = document.getElementById('time-bar-content');
    let isSyncing = false;

    gridContainer.addEventListener('scroll', () => {
        if (!isSyncing) {
            isSyncing = true;
            channelList.scrollTop = gridContainer.scrollTop;
            timeBarContent.style.transform = `translateX(-${gridContainer.scrollLeft}px)`;
            updateVisibleTitles(gridContainer.scrollLeft);
            requestAnimationFrame(() => { isSyncing = false; });
        }
    });
    channelList.addEventListener('scroll', () => {
         if (!isSyncing) {
            isSyncing = true;
            gridContainer.scrollTop = channelList.scrollTop;
            requestAnimationFrame(() => { isSyncing = false; });
        }
    });
}

function parseXmlGuide(xmlDoc) {
    const channels = Array.from(xmlDoc.querySelectorAll('channel')).map(tag => {
        const nameContent = tag.querySelector('display-name').textContent;
        const nameParts = nameContent.split(' ');
        const number = nameParts.shift();
        const name = nameParts.join(' ');
        return { id: tag.getAttribute('id'), name, number, logo: tag.querySelector('icon')?.getAttribute('src') || '' };
    });

    const programmes = Array.from(xmlDoc.querySelectorAll('programme')).map(tag => {
        const epNumTag = tag.querySelector('episode-num');
        let episodeNum = '';
        if (epNumTag && epNumTag.getAttribute('system') === 'xmltv_ns') {
            const parts = epNumTag.textContent.split('.');
            const s = parseInt(parts[0]) + 1;
            const e = parseInt(parts[1]) + 1;
            if (!isNaN(s) && !isNaN(e)) episodeNum = `S${String(s).padStart(2, '0')}E${String(e).padStart(2, '0')}`;
        }
        return { channel: tag.getAttribute('channel'), start: parseXMLTVTime(tag.getAttribute('start')), stop: parseXMLTVTime(tag.getAttribute('stop')), title: tag.querySelector('title').textContent, desc: tag.querySelector('desc')?.textContent || 'No description available.', episodeNum };
    });
    return { channels, programmes };
}

function parseJsonGuide(json) {
    const channels = json.channels.map(ch => ({
        id: ch.id,
        name: ch.displayName.split(' ').slice(1).join(' '),
        number: ch.displayName.split(' ')[0],
        logo: ch.icon
    }));

    const programmes = json.programmes.map(p => ({ ...p, start: new Date(p.start), stop: new Date(p.stop) }));
    return { channels, programmes };
}


function mergeAndSortData({ channels, programmes }, m3uStreams = {}) {
    channels = channels.concat(CONFIG.customChannels);
    channels.sort((a, b) => parseInt(a.number) - parseInt(b.number));

    const now = new Date();
    const past = new Date(now.getTime() - 3 * 60 * 60 * 1000);
    const future = new Date(now.getTime() + 9 * 60 * 60 * 1000);

    CONFIG.customChannels.forEach(customChannel => {
        programmes.push({
            channel: customChannel.id, start: past, stop: future,
            title: customChannel.programTitle || "24/7 Broadcast",
            desc: customChannel.description || `Enjoy a continuous stream of ${customChannel.name}.`,
            episodeNum: customChannel.episodeNum || ''
        });
    });
    
    channels.forEach(ch => {
        const m3uStream = m3uStreams[ch.id];
        const mapping = CONFIG.streamMappings.find(m => m.channelId === ch.id);
        const custom = CONFIG.customChannels.find(c => c.id === ch.id);

        if (m3uStream) {
            ch.stream = m3uStream;
        } else if (mapping) {
            ch.stream = { type: mapping.type, url: mapping.url };
        } else if (custom && custom.stream && custom.stream.url) {
            ch.stream = custom.stream;
        }
    });

    return { channels, programmes };
}

function parseXMLTVTime(timeStr) {
    const y = timeStr.substring(0, 4), m = timeStr.substring(4, 6) - 1, d = timeStr.substring(6, 8);
    const h = timeStr.substring(8, 10), min = timeStr.substring(10, 12);
    return new Date(Date.UTC(y, m, d, h, min));
}

function renderGuide() {
    const timeBarContent = document.getElementById('time-bar-content');
    const channelList = document.getElementById('channel-list');
    const programGrid = document.getElementById('program-grid');
    const gridContainer = document.getElementById('program-grid-container');
    const now = new Date();

    timeBarContent.innerHTML = '';
    channelList.innerHTML = '';
    programGrid.innerHTML = '';

    const containerWidth = gridContainer.clientWidth;
    const pxPerMinute = containerWidth / (CONFIG.guideViewHours * 60);
    const totalGridWidthPx = CONFIG.totalGuideHours * 60 * pxPerMinute;

    programGrid.style.width = `${totalGridWidthPx}px`;
    timeBarContent.style.width = programGrid.style.width;

    for (let i = 0; i < CONFIG.totalGuideHours * 2; i++) {
        const markerTime = new Date(guideStartTime.getTime() + i * 30 * 60 * 1000);
        const timeMarker = document.createElement('div');
        timeMarker.className = 'time-marker';
        timeMarker.style.width = `${30 * pxPerMinute}px`;
        timeMarker.textContent = markerTime.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
        timeBarContent.appendChild(timeMarker);
    }

    programGrid.style.height = `${guideData.channels.length * parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--row-height'))}px`;

    programsByChannel = guideData.channels.map(channel =>
        guideData.programmes.filter(p => p.channel === channel.id).sort((a, b) => a.start - b.start)
    );

    guideData.channels.forEach((channel, cIndex) => {
        const channelDiv = document.createElement('div');
        channelDiv.className = 'channel-info';
        if (channel.stream && channel.stream.url) {
            channelDiv.addEventListener('click', () => {
                const liveProgramIndex = findLiveProgramIndex(cIndex);
                handleProgramClick(cIndex, liveProgramIndex !== -1 ? liveProgramIndex : 0, true);
            });
        }
        channelDiv.innerHTML = `<img src="${channel.logo}" alt=""><div class="channel-text"><span class="channel-name">${channel.name}</span><span class="channel-number">| ${channel.number}</span></div>`;
        channelList.appendChild(channelDiv);

        programsByChannel[cIndex].forEach((program, pIndex) => {
            const startOffsetMinutes = (program.start - guideStartTime) / 60000;
            const durationMinutes = (program.stop - program.start) / 60000;

            const programBlock = document.createElement('div');
            programBlock.className = 'program-block';
            programBlock.dataset.cIndex = cIndex;
            programBlock.dataset.pIndex = pIndex;
            const rowHeightPx = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--row-height')) * parseFloat(getComputedStyle(document.documentElement).fontSize);
            programBlock.style.top = `${cIndex * rowHeightPx}px`;
            programBlock.style.left = `${startOffsetMinutes * pxPerMinute}px`;
            programBlock.style.width = `${durationMinutes * pxPerMinute}px`;
            
            programBlock.innerHTML = `<div class="program-content"><div class="program-title">${program.title}</div><div class="program-time">${program.start.toLocaleTimeString([],{hour:'numeric',minute:'2-digit'})}</div></div>`;
            
            if (program.start <= now && program.stop > now) programBlock.classList.add('live');
            else if (program.stop <= now) programBlock.classList.add('past');

            programBlock.addEventListener('click', () => handleProgramClick(cIndex, pIndex));
            programGrid.appendChild(programBlock);
        });
    });

    const nowOffsetMinutes = (new Date() - guideStartTime) / 60000;
    const viewCenterMinutes = (CONFIG.guideViewHours * 60) / 2;
    const initialScrollPx = Math.max(0, (nowOffsetMinutes - viewCenterMinutes) * pxPerMinute);
    gridContainer.scrollLeft = initialScrollPx;
    updateVisibleTitles(initialScrollPx);
}

function updateVisibleTitles(scrollLeft) {
    const programBlocks = document.querySelectorAll('.program-block');
    programBlocks.forEach(block => {
        const title = block.querySelector('.program-title');
        const blockLeft = block.offsetLeft;

        if (blockLeft < scrollLeft) {
            const offset = scrollLeft - blockLeft;
            title.style.transform = `translateX(${offset}px)`;
        } else {
            title.style.transform = 'translateX(0px)';
        }
    });
}


function displayInitialMessage(title = 'Loading Guide...', desc = 'Fetching program data. Please wait.') {
    displayProgramDetails({ title, desc, episodeNum: '', start: new Date(), stop: new Date() }, { name: 'System', number: '00', logo: '' });
}

async function displayProgramDetails(program, channel) {
    const detailsPanel = document.getElementById('current-program-details');
    const posterContainer = detailsPanel.querySelector('.details-poster-container');
    const titleEl = detailsPanel.querySelector('h3');
    const channelInfoEl = detailsPanel.querySelector('.details-channel-info');
    const descriptionP = detailsPanel.querySelector('.description-container p');
    const timeslotEl = detailsPanel.querySelector('.details-timeslot');

    const startTimeStr = program.start.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const stopTimeStr = program.stop.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

    const episodeNumHTML = program.episodeNum ? `<span class="episode-num">${program.episodeNum}</span>` : '';
    
    const posterUrl = await getPosterUrl(program.title);
    posterContainer.innerHTML = program.title ? `<img src="${posterUrl}" alt="Poster">` : '';

    titleEl.innerHTML = `${program.title || ''}${episodeNumHTML}`;
    channelInfoEl.innerHTML = channel.name ? `<img src="${channel.logo}" alt=""><span>${channel.name} ${channel.number}</span>` : '';
    descriptionP.textContent = program.desc || '';
    timeslotEl.textContent = program.title ? `Timeslot: ${startTimeStr} - ${stopTimeStr}` : '';

    descriptionP.classList.remove('autoscroll');
    descriptionP.style.animation = 'none';

    setTimeout(() => {
        const container = descriptionP.parentElement;
        if (descriptionP.scrollHeight > container.clientHeight) {
            const overflow = descriptionP.scrollHeight - container.clientHeight;
            const duration = (overflow / 20);
            descriptionP.style.animation = `scroll-text ${duration}s linear infinite alternate`;
            descriptionP.classList.add('autoscroll');
        }
    }, 50);
}

function setupPlayerControls() {
    const video = document.getElementById('mini-player-video');
    const wrapper = document.getElementById('player-ui-wrapper');
    const progressFilled = document.getElementById('progress-bar-filled');
    const fullscreenBtn = document.getElementById('fullscreen-button');

    video.addEventListener('timeupdate', () => {
        if(video.duration && !isNaN(video.duration)) {
            progressFilled.style.width = `${(video.currentTime / video.duration) * 100}%`;
        } else {
             progressFilled.style.width = `0%`;
        }
    });

    video.addEventListener('play', () => wrapper.classList.remove('paused'));
    video.addEventListener('pause', () => wrapper.classList.add('paused'));

    fullscreenBtn.addEventListener('click', () => {
         if (!currentStreamInfo.channelId) return;
         const program = programsByChannel[currentStreamInfo.cIndex]?.[currentStreamInfo.pIndex];
         if (!program) return;
         
         const url = `player.html?src=${encodeURIComponent(currentStreamInfo.url)}&type=${currentStreamInfo.type}&title=${encodeURIComponent(program.title)}&desc=${encodeURIComponent(program.desc)}&channelId=${currentStreamInfo.channelId}`;
         window.location.href = url;
    });
}

function loadStream(channel) {
    if (!channel || !channel.stream || !channel.stream.url) {
        console.error("No stream URL found for channel", channel?.id);
        stopMiniPlayer();
        return;
    }

    currentStreamInfo = { 
        channelId: channel.id, 
        cIndex: guideData.channels.findIndex(ch => ch.id === channel.id),
        pIndex: findLiveProgramIndex(guideData.channels.findIndex(ch => ch.id === channel.id)),
        url: channel.stream.url, 
        type: channel.stream.type 
    };

    const playerContainer = document.getElementById('mini-player-container');
    const videoEl = document.getElementById('mini-player-video');
    const youtubeContainer = document.getElementById('youtube-player-iframe');
    
    stopMiniPlayer();

    playerContainer.classList.add('active');
    let streamUrl = channel.stream.url;
    let streamType = channel.stream.type;

    if (streamType === 'youtube') {
        const videoIdMatch = streamUrl.match(/(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/);
        if (videoIdMatch && videoIdMatch[1]) {
            streamUrl = videoIdMatch[1];
        }
    }


    if (streamType === 'hls') {
        videoEl.style.display = 'block';
        youtubeContainer.style.display = 'none';
        if (Hls.isSupported()) {
            hlsInstance = new Hls();
            hlsInstance.loadSource(streamUrl);
            hlsInstance.attachMedia(videoEl);
            hlsInstance.on(Hls.Events.MANIFEST_PARSED, () => videoEl.play().catch(e => console.warn("Autoplay prevented:", e)));
            hlsInstance.on(Hls.Events.ERROR, (event, data) => console.error('HLS Error:', data));
        } else if (videoEl.canPlayType('application/vnd.apple.mpegurl')) {
            videoEl.src = streamUrl;
            videoEl.addEventListener('loadedmetadata', () => videoEl.play().catch(e => console.warn("Autoplay prevented:", e)));
        }
    } else if (streamType === 'youtube') {
        videoEl.style.display = 'none';
        youtubeContainer.style.display = 'block';
        youtubeContainer.innerHTML = `<iframe src="https://www.youtube.com/embed/${streamUrl}?autoplay=1&controls=0&modestbranding=1" frameborder="0" allow="autoplay; encrypted-media" allowfullscreen></iframe>`;
    } else {
        console.warn("Unsupported stream type:", streamType);
        stopMiniPlayer();
    }
}

function stopMiniPlayer() {
     const playerContainer = document.getElementById('mini-player-container');
     const videoEl = document.getElementById('mini-player-video');
     const youtubeContainer = document.getElementById('youtube-player-iframe');
     
     if (hlsInstance) {
        hlsInstance.destroy();
        hlsInstance = null;
    }
    videoEl.pause();
    videoEl.src = '';
    videoEl.removeAttribute('src');
    youtubeContainer.innerHTML = '';
    playerContainer.classList.remove('active');
    currentStreamInfo = {};
}

function handleProgramClick(cIndex, pIndex, forceTune = false) {
     const program = programsByChannel[cIndex]?.[pIndex];
     const channel = guideData.channels[cIndex];
     if (!program || !channel) return;
     
     selectProgram(cIndex, pIndex);

     const now = new Date();
     const isLive = program.start <= now && program.stop > now;

     if (isLive || forceTune) {
         if (channel.stream && channel.stream.url) {
             const url = `player.html?src=${encodeURIComponent(channel.stream.url)}&type=${channel.stream.type}&title=${encodeURIComponent(program.title)}&desc=${encodeURIComponent(program.desc)}&channelId=${channel.id}`;
             window.location.href = url;
         } else {
             console.warn("No stream found for this live channel:", channel.id);
             playErrorSound();
         }
     } else {
         playErrorSound();
     }
}

function playErrorSound() {
    if (errorSound) {
        errorSound.currentTime = 0;
        errorSound.play().catch(e => console.warn("Error sound blocked:", e));
    }
}

function findLiveProgramIndex(channelIndex) {
    if (!programsByChannel[channelIndex]) return -1;
    const now = new Date();
    return programsByChannel[channelIndex].findIndex(p => p.start <= now && p.stop > now);
}

function selectInitialProgram() {
    const now = new Date();
    for (let c = 0; c < programsByChannel.length; c++) {
        const startIndex = programsByChannel[c].findIndex(p => p.stop > now);
        if (startIndex !== -1) {
            selectProgram(c, startIndex); 
            return;
        }
    }
    if (programsByChannel.length > 0 && programsByChannel[0].length > 0) {
        selectProgram(0, 0);
    } else {
         displayInitialMessage("No Programs Found", "Could not load any program data.");
    }
}


function selectProgram(cIndex, pIndex) {
    if (!programsByChannel[cIndex] || !programsByChannel[cIndex][pIndex]) return;

    selectedChannelIndex = cIndex;
    selectedProgramIndex = pIndex;

    document.querySelectorAll('.program-block.selected').forEach(el => el.classList.remove('selected'));

    const targetBlock = document.querySelector(`.program-block[data-c-index='${cIndex}'][data-p-index='${pIndex}']`);
    if (targetBlock) {
        targetBlock.classList.add('selected');
        targetBlock.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });

        const program = programsByChannel[cIndex][pIndex];
        const channel = guideData.channels[cIndex];
        displayProgramDetails(program, channel);
    }
}

function handleKeyPress(e) {
    const menu = document.getElementById('side-menu');
    if (e.key.toLowerCase() === 'm') {
        toggleMenu();
        return;
    }
    
    if (menu.classList.contains('visible')) return; 

    e.preventDefault();
    let newC = selectedChannelIndex;
    let newP = selectedProgramIndex;
    const currentProgram = programsByChannel[selectedChannelIndex]?.[selectedProgramIndex];
    if (!currentProgram) return;

    switch (e.key) {
        case "ArrowUp": newC = Math.max(0, newC - 1); break;
        case "ArrowDown": newC = Math.min(programsByChannel.length - 1, newC + 1); break;
        case "ArrowLeft": newP = Math.max(0, newP - 1); break;
        case "ArrowRight": newP = Math.min(programsByChannel[selectedChannelIndex].length - 1, newP + 1); break;
        case "Enter": 
            handleProgramClick(selectedChannelIndex, selectedProgramIndex);
            return;
        default: return;
    }

    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        const now = new Date();
        const isCurrentLive = currentProgram.start <= now && currentProgram.stop > now;

        if (isCurrentLive) {
            const liveProgramOnNewChannel = programsByChannel[newC].findIndex(p => p.start <= now && p.stop > now);
            if (liveProgramOnNewChannel !== -1) {
                newP = liveProgramOnNewChannel;
            } else { 
                 let bestMatch = { diff: Infinity, index: 0 };
                 programsByChannel[newC].forEach((prog, i) => {
                     const diff = Math.abs(prog.start - currentProgram.start);
                     if (diff < bestMatch.diff) { bestMatch = { diff, index: i }; }
                 });
                 newP = bestMatch.index;
            }
        } else {
            let bestMatch = { diff: Infinity, index: 0 };
            programsByChannel[newC].forEach((prog, i) => {
                 const diff = Math.abs(prog.start - currentProgram.start);
                 if (diff < bestMatch.diff) { bestMatch = { diff, index: i }; }
            });
            newP = bestMatch.index;
        }
    }
    selectProgram(newC, newP);
}

function toggleMenu() {
    const appContainer = document.getElementById('app-container');
    const menuOverlay = document.getElementById('menu-overlay');
    const sideMenu = document.getElementById('side-menu');
    appContainer.classList.toggle('blurred');
    menuOverlay.classList.toggle('visible');
    sideMenu.classList.toggle('visible');
}


function updateTime() {
    const timeEl = document.getElementById('guide-time');
    if (timeEl) timeEl.textContent = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

async function getPosterUrl(title) {
    if (!title || !CONFIG.tmdbApiKey || CONFIG.tmdbApiKey === 'YOUR_API_KEY_HERE') {
        return `https://placehold.co/400x600/0c1428/FFFFFF?text=${encodeURIComponent(title || 'N/A')}`;
    }
    try {
        const url = `https://api.themoviedb.org/3/search/multi?api_key=${CONFIG.tmdbApiKey}&query=${encodeURIComponent(title)}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`TMDb search failed: ${res.status}`);
        const data = await res.json();
        const firstResult = data.results?.[0];
        if (firstResult?.poster_path) {
            return `https://image.tmdb.org/t/p/w400${firstResult.poster_path}`;
        }
    } catch (err) {
        console.error("TMDb fetch error:", err.message);
    }
    return `https://placehold.co/400x600/0c1428/FFFFFF?text=${encodeURIComponent(title || 'N/A')}`;
}

async function fetchWeather() {
    if (!CONFIG.enableWeather || CONFIG.openWeatherApiKey === 'YOUR_API_KEY_HERE' || !userCoords) return;
    const { latitude, longitude } = userCoords;
    const url = `https://api.openweathermap.org/data/2.5/weather?lat=${latitude}&lon=${longitude}&appid=${CONFIG.openWeatherApiKey}&units=imperial`;
    try {
        const res = await fetch(url);
        if (res.status === 401) throw new Error("Unauthorized(401). Check OpenWeather API key and plan.");
        if (!res.ok) throw new Error(`HTTP error! Status: ${res.status}`);
        const data = await res.json();
        const weatherEl = document.getElementById('guide-weather');
        if (weatherEl && data.main) weatherEl.textContent = `${Math.round(data.main.temp)}°F`;
    } catch (err) {
        console.error("Weather fetch error:", err.message);
        const weatherEl = document.getElementById('guide-weather');
        if(weatherEl) weatherEl.textContent = 'N/A';
    }
}

async function fetchHourlyForecast() {
    if (!CONFIG.enableWeather || CONFIG.openWeatherApiKey === 'YOUR_API_KEY_HERE' || !userCoords) return;
    const { latitude, longitude } = userCoords;
    const url = `https://api.openweathermap.org/data/2.5/forecast?lat=${latitude}&lon=${longitude}&appid=${CONFIG.openWeatherApiKey}&units=imperial&cnt=4`; 
    try {
        const res = await fetch(url);
        if (res.status === 401) throw new Error("Unauthorized(401). Check OpenWeather API key and plan.");
        if (!res.ok) throw new Error(`HTTP error! Status: ${res.status}`);
        const data = await res.json();
        const container = document.querySelector('#hourly-forecast-widget .forecast-items');
        if(!container) return;
        container.innerHTML = '';
        data.list.slice(0, 4).forEach(item => {
            const date = new Date(item.dt * 1000);
            const icon = item.weather[0].icon;
            container.innerHTML += `
                <div class="forecast-item">
                    <div>${date.toLocaleTimeString([], {hour: 'numeric'})}</div>
                    <img src="https://openweathermap.org/img/wn/${icon}.png" alt="${item.weather[0].description}">
                    <div>${Math.round(item.main.temp)}°F</div>
                </div>`;
        });
    } catch (err) {
         console.error("Hourly forecast error:", err.message);
         const container = document.querySelector('#hourly-forecast-widget .forecast-items');
         if(container) container.innerHTML = '<p style="font-size: 0.8em; text-align: center; margin-top: 1rem;">Forecast unavailable.</p>';
    }
}

function buildRecommendationWidget() {
    const now = new Date();
    const upcoming = [];
    if (!guideData || !guideData.channels) return;
    
    programsByChannel.forEach((channelProgs, cIndex) => {
        if (!channelProgs) return;
        const nextProg = channelProgs.find(p => p.start > now);
        if(nextProg && guideData.channels[cIndex]) {
            upcoming.push({ program: nextProg, channel: guideData.channels[cIndex] });
        }
    });

    const container = document.querySelector('#recommendation-widget .rec-content');
    if(!container) return;
    
    if (upcoming.length > 0) {
        const randomRec = upcoming[Math.floor(Math.random() * upcoming.length)];
        container.innerHTML = `
            <p class="rec-show-title">${randomRec.program.title}</p>
            <p class="rec-show-channel">On ${randomRec.channel.name} at ${randomRec.program.start.toLocaleTimeString([], {hour:'numeric', minute:'2-digit'})}</p>`;
    } else {
         container.innerHTML = `<p>No upcoming shows found.</p>`;
    }
}

function startWidgetSlideshow() {
    const widgetContainer = document.querySelector('#side-menu #widget-slideshow-container');
    if (!widgetContainer) return;

    const allSlides = Array.from(widgetContainer.querySelectorAll('.widget-slide'));
    const slides = allSlides.filter(slide => {
        if (slide.id === 'hourly-forecast-widget' && !CONFIG.enableWeather) {
            slide.style.display = 'none';
            return false;
        }
        slide.style.display = 'flex';
        return true;
    });

    if(slides.length === 0) return;
    let currentSlide = 0;

    function showSlide(index) {
        slides.forEach((slide, i) => {
            slide.classList.toggle('active', i === index);
        });
    }

    buildRecommendationWidget(); 

    setInterval(() => {
        if(slides.length <= 1) return;
        currentSlide = (currentSlide + 1) % slides.length;
        if (slides[currentSlide].id === 'recommendation-widget') {
            buildRecommendationWidget();
        }
        showSlide(currentSlide);
    }, 10000);

    showSlide(0);
}

function startMessageBox() {
    const messageTextEl = document.getElementById('message-text');
    if (!messageTextEl) return;

    let allMessages = [...CONFIG.messages];

    const now = new Date();
    const upcoming = [];
    if (guideData && guideData.channels) {
        programsByChannel.forEach((channelProgs, cIndex) => {
             if (!channelProgs) return;
            const nextProg = channelProgs.find(p => p.start > now);
            if(nextProg && guideData.channels[cIndex]) {
                upcoming.push({ program: nextProg, channel: guideData.channels[cIndex] });
            }
        });
    }

    for (let i = 0; i < Math.min(3, upcoming.length); i++) {
        const randomRec = upcoming.splice(Math.floor(Math.random() * upcoming.length), 1)[0];
            if (randomRec) {
                const timeStr = randomRec.program.start.toLocaleTimeString([], {hour:'numeric', minute:'2-digit'});
                allMessages.push(`Coming Up at ${timeStr}: "${randomRec.program.title}" on ${randomRec.channel.name}`);
            }
    }

    if (allMessages.length === 0) return;

    for (let i = allMessages.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [allMessages[i], allMessages[j]] = [allMessages[j], allMessages[i]];
    }

    let currentMessageIndex = 0;
    
    function displayNextMessage() {
        if (allMessages.length > 0) {
            messageTextEl.textContent = allMessages[currentMessageIndex];
            currentMessageIndex = (currentMessageIndex + 1) % allMessages.length;
        } else {
            messageTextEl.textContent = '';
        }
    }

    setInterval(displayNextMessage, 15000);
    displayNextMessage();
}
