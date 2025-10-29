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
</tv>
`;

document.addEventListener('DOMContentLoaded', async () => {
    CONFIG = window.iCableConfig.get();
    
    errorSound = document.getElementById('error-sound');
    
    try {
        await loadConfigFromStorage();
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
        displayInitialMessage('Error', 'Could not start the guide. Check Settings or console for details.');
    }

    document.addEventListener('keydown', handleKeyPress);
    syncScrollbars();
    setupPlayerControls();

    const resumeChannelId = sessionStorage.getItem('returnFromPlayerChannelId') || sessionStorage.getItem('lastWatchedChannel');
    const lastStreamStr = sessionStorage.getItem('lastStream');
    
    if (resumeChannelId && guideData.channels.length > 0) {
        const channelToResume = guideData.channels.find(ch => ch.id === resumeChannelId);
        
        if (channelToResume && channelToResume.stream) {
            const wasUnmuted = sessionStorage.getItem('playerUnmuted') === 'true';
            
            const cIndex = guideData.channels.findIndex(ch => ch.id === resumeChannelId);
            if (cIndex !== -1) {
                const pIndex = findLiveProgramIndex(cIndex);
                if (pIndex !== -1) {
                    selectProgram(cIndex, pIndex);
                    
                    setTimeout(() => {
                        const selectedBlock = document.querySelector('.program-block.selected');
                        if (selectedBlock) {
                            selectedBlock.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
                        }
                    }, 500);
                }
            }
            
            loadStream(channelToResume, !wasUnmuted);
        }
        sessionStorage.removeItem('returnFromPlayerChannelId');
    }

    const menuOverlay = document.getElementById('menu-overlay');
    if (menuOverlay) {
        menuOverlay.addEventListener('click', toggleMenu);
    }
});

async function loadConfigFromStorage() {
    CONFIG = window.iCableConfig.get();
    
    if (CONFIG.appearance?.systemLogoId) {
        const logoData = await window.iCableConfig.getImage(CONFIG.appearance.systemLogoId);
        if (logoData) {
            CONFIG.logoUrl = logoData.data;
        }
    }
    
    if (CONFIG.customChannels && CONFIG.customChannels.length > 0) {
        for (let channel of CONFIG.customChannels) {
            if (channel.logoId && !channel.logo) {
                const logoData = await window.iCableConfig.getImage(channel.logoId);
                if (logoData) {
                    channel.logo = logoData.data;
                }
            }
        }
    }
    
    CONFIG.xmltvUrl = CONFIG.integrations?.xmltvUrl || '';
    CONFIG.jsonUrl = CONFIG.integrations?.jsonUrl || '';
    CONFIG.m3uUrl = CONFIG.integrations?.m3uUrl || '';
    CONFIG.openWeatherApiKey = CONFIG.appearance?.weatherApiKey || '';
    CONFIG.tmdbApiKey = CONFIG.appearance?.tmdbApiKey || '';
    CONFIG.enableWeather = CONFIG.appearance?.enableWeather || false;
    CONFIG.enableLogo = !!CONFIG.logoUrl;
    CONFIG.messages = CONFIG.appearance?.customMessages || ['Welcome to iCable!'];
    CONFIG.guideViewHours = CONFIG.guide?.viewHours || 2;
    CONFIG.totalGuideHours = CONFIG.guide?.totalHours || 12;
    CONFIG.customChannels = CONFIG.customChannels || [];
    CONFIG.streamMappings = [];
    CONFIG.colors = CONFIG.appearance?.colors || {};
}

function applyConfigToUI() {
    if (CONFIG.colors) {
        window.iCableConfig.applyTheme(CONFIG.colors);
    }
    
    const logoEl = document.getElementById('guide-logo-placeholder');
    const weatherEl = document.getElementById('guide-weather');

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
    if (CONFIG.xmltvUrl === 'data:demo') {
        return { data: sampleXmlTvData, format: 'xml' };
    }
    
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
    displayInitialMessage('Info', 'No guide data configured. Using demo data. Add sources in Settings.');
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
            
            let finalUrl = url;
            if (type === 'youtube') {
                 const videoIdMatch = url.match(/(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/);
                 if (videoIdMatch && videoIdMatch[1]) {
                    finalUrl = videoIdMatch[1];
                 } else {
                     console.warn(`Could not extract YouTube ID from URL: ${url}`);
                     continue;
                 }
            }
            
            if (type !== 'unknown') {
                streams[currentTvgId] = { type, url: finalUrl };
            }
            currentTvgId = null;
        }
    }
    return streams;
}

function initializeGuide(parsedData, m3uStreams) {
    guideData = mergeAndSortData(parsedData, m3uStreams);
    
    sessionStorage.setItem('guideCache', JSON.stringify({
        channels: guideData.channels,
        programmes: guideData.programmes.map(p => ({
            ...p,
            start: p.start.toISOString(),
            stop: p.stop.toISOString()
        }))
    }));
    
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
        const id = tag.getAttribute('tvg-id') || tag.getAttribute('id'); 
        return { id, name, number, logo: tag.querySelector('icon')?.getAttribute('src') || '' };
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
        const channelId = tag.getAttribute('tvg-channel') || tag.getAttribute('channel'); 
        return { channel: channelId, start: parseXMLTVTime(tag.getAttribute('start')), stop: parseXMLTVTime(tag.getAttribute('stop')), title: tag.querySelector('title').textContent, desc: tag.querySelector('desc')?.textContent || 'No description available.', episodeNum };
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
        if (customChannel.epg && customChannel.epg.length > 0) {
            let currentTime = new Date(past);
            const totalDuration = customChannel.epg.reduce((sum, block) => sum + block.duration, 0);
            
            while (currentTime < future) {
                customChannel.epg.forEach(block => {
                    const startTime = new Date(currentTime);
                    const endTime = new Date(currentTime.getTime() + block.duration * 60 * 1000);
                    
                    if (endTime > past && startTime < future) {
                        programmes.push({
                            channel: customChannel.id,
                            start: startTime,
                            stop: endTime,
                            title: block.title,
                            desc: block.desc || `${block.title} - ${customChannel.fullName || customChannel.name}`,
                            episodeNum: ''
                        });
                    }
                    
                    currentTime = endTime;
                });
            }
        } else {
            programmes.push({
                channel: customChannel.id,
                start: past,
                stop: future,
                title: customChannel.fullName || customChannel.name,
                desc: customChannel.description || `24/7 streaming of ${customChannel.fullName || customChannel.name}`,
                episodeNum: ''
            });
        }
    });
    
    channels.forEach(ch => {
        const m3uStream = m3uStreams[ch.id];
        const mapping = CONFIG.streamMappings.find(m => m.channelId === ch.id);
        const custom = CONFIG.customChannels.find(c => c.id === ch.id);

        if (custom && custom.stream && custom.stream.url) {
            ch.stream = custom.stream;
        } else if (m3uStream) {
            ch.stream = m3uStream;
        } else if (mapping) {
            ch.stream = { type: mapping.type, url: mapping.url };
        }
    });

    return { channels, programmes };
}

function parseXMLTVTime(timeStr) {
    const y = timeStr.substring(0, 4), m = timeStr.substring(4, 6) - 1, d = timeStr.substring(6, 8);
    const h = timeStr.substring(8, 10), min = timeStr.substring(10, 12);
    const offsetMatch = timeStr.match(/([+-])(\d{2})(\d{2})$/);
    if (offsetMatch) {
        const offsetSign = offsetMatch[1] === '+' ? -1 : 1; 
        const offsetHours = parseInt(offsetMatch[2]);
        const offsetMinutes = parseInt(offsetMatch[3]);
        const date = new Date(Date.UTC(y, m, d, h, min));
        date.setUTCHours(date.getUTCHours() + offsetSign * offsetHours);
        date.setUTCMinutes(date.getUTCMinutes() + offsetSign * offsetMinutes);
        return date;
    } else {
        return new Date(Date.UTC(y, m, d, h, min));
    }
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
    if (containerWidth <= 0) {
        console.warn("Grid container not ready for rendering yet.");
        setTimeout(renderGuide, 100);
        return;
    }
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

    const rowHeightPx = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--row-height')) * parseFloat(getComputedStyle(document.documentElement).fontSize);
    programGrid.style.height = `${guideData.channels.length * rowHeightPx}px`;

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
            
            if (startOffsetMinutes + durationMinutes <= 0 || startOffsetMinutes >= CONFIG.totalGuideHours * 60) {
                 return;
             }

            const programBlock = document.createElement('div');
            programBlock.className = 'program-block';
            programBlock.dataset.cIndex = cIndex;
            programBlock.dataset.pIndex = pIndex;

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

    const startTimeStr = program.start ? program.start.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';
    const stopTimeStr = program.stop ? program.stop.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';

    const episodeNumHTML = program.episodeNum ? `<span class="episode-num">${program.episodeNum}</span>` : '';
    
    let posterUrl = `https://placehold.co/400x600/0c1428/FFFFFF?text=N/A`;
    if (program.title && CONFIG.tmdbApiKey) {
        posterUrl = await getPosterUrl(program.title);
    }
    posterContainer.innerHTML = `<img src="${posterUrl}" alt="Poster">`;

    titleEl.innerHTML = `${program.title || ''}${episodeNumHTML}`;
    channelInfoEl.innerHTML = channel.name ? `<img src="${channel.logo || 'https://placehold.co/100x50/cccccc/000000?text=NoLogo'}" alt=""><span>${channel.name} ${channel.number}</span>` : '';
    descriptionP.textContent = program.desc || '';
    timeslotEl.textContent = program.title ? `Timeslot: ${startTimeStr} - ${stopTimeStr}` : '';

    const container = descriptionP.parentElement;
    descriptionP.style.animation = 'none';
    descriptionP.classList.remove('autoscroll');
    descriptionP.offsetHeight;

    if (descriptionP.scrollHeight > container.clientHeight) {
        const overflow = descriptionP.scrollHeight - container.clientHeight;
        const duration = (10 + (overflow / 100) * 5); 
        
        const animationName = 'scroll-text'; 

        let keyframesRule = null;
        for (let i = 0; i < document.styleSheets.length; i++) {
             try {
                for (let j = 0; j < document.styleSheets[i].cssRules.length; j++) {
                    if (document.styleSheets[i].cssRules[j].name === animationName && document.styleSheets[i].cssRules[j].type === CSSRule.KEYFRAMES_RULE) {
                        keyframesRule = document.styleSheets[i].cssRules[j];
                        break;
                    }
                }
             } catch(e) { continue; }
             if (keyframesRule) break;
        }

        const toKeyframe = `to { transform: translateY(calc(-100% + ${container.clientHeight}px)); }`;
        if (keyframesRule) {
             keyframesRule.deleteRule('100%');
             keyframesRule.appendRule(toKeyframe);
        } else {
            try {
                 document.styleSheets[0].insertRule(`@keyframes ${animationName} {
                     from { transform: translateY(0%); }
                     ${toKeyframe}
                 }`, document.styleSheets[0].cssRules.length);
            } catch(e) { console.error("Could not insert keyframes rule:", e); }
        }

        descriptionP.style.animationName = animationName;
        descriptionP.style.animationDuration = `${duration}s`;
        descriptionP.style.animationTimingFunction = 'linear';
        descriptionP.style.animationIterationCount = 'infinite';
        descriptionP.style.animationDirection = 'alternate';
        descriptionP.classList.add('autoscroll');
    }
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

    video.addEventListener('click', () => {
        if (currentStreamInfo.channelId) {
            const currentlyUnmuted = sessionStorage.getItem('playerUnmuted') === 'true';
            const newMuteState = currentlyUnmuted;
            
            sessionStorage.setItem('playerUnmuted', newMuteState ? 'false' : 'true');
            
            if (currentStreamInfo.type === 'hls' && video.src) {
                video.muted = !video.muted;
                console.log('HLS clicked. Muted:', video.muted);
            }
            else if (currentStreamInfo.type === 'youtube' || currentStreamInfo.type === 'twitch' || currentStreamInfo.type === 'iframe') {
                const channel = guideData.channels.find(ch => ch.id === currentStreamInfo.channelId);
                if (channel) {
                    console.log('Reloading embedded stream with new mute state. Unmuted:', !newMuteState);
                    loadStream(channel, false);
                }
            }
        }
    });

    fullscreenBtn.addEventListener('click', () => {
         if (!currentStreamInfo.channelId) return;
         const program = programsByChannel[currentStreamInfo.cIndex]?.[currentStreamInfo.pIndex];
         const channel = guideData.channels[currentStreamInfo.cIndex];
         if (!program || !channel) return;
         
         const params = new URLSearchParams({
             src: currentStreamInfo.url,
             type: currentStreamInfo.type,
             title: program.title,
             desc: program.desc,
             channelId: channel.id,
             channelLogo: channel.logo || '',
             channelNum: channel.number || '',
             channelName: channel.name || '',
             startTime: program.start.getTime().toString(),
             endTime: program.stop.getTime().toString()
         });
         window.location.href = `player.html?${params.toString()}`;
    });
}

function loadStream(channel, shouldMute = false) {
    if (!channel || !channel.stream || !channel.stream.url) {
        console.warn("No stream URL found for channel", channel?.id);
        stopMiniPlayer();
        return;
    }

     const cIndex = guideData.channels.findIndex(ch => ch.id === channel.id);
     const pIndex = findLiveProgramIndex(cIndex);

    currentStreamInfo = { 
        channelId: channel.id, 
        cIndex: cIndex,
        pIndex: pIndex, 
        url: channel.stream.url, 
        type: channel.stream.type 
    };
    
    sessionStorage.setItem('lastWatchedChannel', channel.id);

    const playerContainer = document.getElementById('mini-player-container');
    const videoEl = document.getElementById('mini-player-video');
    const youtubeContainer = document.getElementById('youtube-player-iframe');
    
    stopMiniPlayer(); 

    playerContainer.classList.add('active');
    let streamUrl = channel.stream.url;
    let streamType = channel.stream.type;

    const userUnmuted = sessionStorage.getItem('playerUnmuted') === 'true';
    const finalMuteState = userUnmuted ? false : shouldMute;

    if (streamType === 'youtube') {
         streamUrl = channel.stream.url; 
    }

    if (streamType === 'hls') {
        videoEl.style.display = 'block';
        youtubeContainer.style.display = 'none';
        
        videoEl.muted = finalMuteState;
        
        if (Hls.isSupported()) {
            hlsInstance = new Hls({
                autoStartLoad: true,
                startPosition: -1,
                maxBufferLength: 30,
                maxMaxBufferLength: 600
            });
            hlsInstance.loadSource(streamUrl);
            hlsInstance.attachMedia(videoEl);
            hlsInstance.on(Hls.Events.MANIFEST_PARSED, () => {
                const playPromise = videoEl.play();
                if (playPromise !== undefined) {
                    playPromise.catch(e => {
                        console.warn("Autoplay prevented:", e);
                        videoEl.muted = true;
                        videoEl.play().catch(err => console.warn("Still prevented:", err));
                    });
                }
            });
            hlsInstance.on(Hls.Events.ERROR, (event, data) => {
                 console.error('HLS Error:', data);
                 if (data.fatal) {
                      stopMiniPlayer();
                      displayInitialMessage('Playback Error', `Could not load stream for ${channel.name}.`);
                 }
            });
        } else if (videoEl.canPlayType('application/vnd.apple.mpegurl')) {
            videoEl.src = streamUrl;
            videoEl.addEventListener('loadedmetadata', () => {
                const playPromise = videoEl.play();
                if (playPromise !== undefined) {
                    playPromise.catch(e => {
                        console.warn("Autoplay prevented:", e);
                        videoEl.muted = true;
                        videoEl.play().catch(err => console.warn("Still prevented:", err));
                    });
                }
            });
             videoEl.addEventListener('error', (e) => {
                 console.error('Native HLS Error:', e);
                 stopMiniPlayer();
                 displayInitialMessage('Playback Error', `Could not load stream for ${channel.name}.`);
             });
        } else {
             console.error("HLS not supported by this browser.");
             stopMiniPlayer();
        }
    } else if (streamType === 'youtube') {
        videoEl.style.display = 'none';
        youtubeContainer.style.display = 'block';
        const muteParam = finalMuteState ? 'mute=1' : 'mute=0';
        youtubeContainer.innerHTML = `<iframe src="https://www.youtube.com/embed/${streamUrl}?autoplay=1&${muteParam}&controls=0&modestbranding=1&rel=0" frameborder="0" allow="autoplay; encrypted-media" allowfullscreen></iframe>`;
    } else if (streamType === 'twitch') {
        videoEl.style.display = 'none';
        youtubeContainer.style.display = 'block';
        const muteParam = finalMuteState ? 'true' : 'false';
        youtubeContainer.innerHTML = `<iframe src="https://player.twitch.tv/?channel=${streamUrl}&parent=${window.location.hostname}&autoplay=true&muted=${muteParam}" frameborder="0" allow="autoplay; fullscreen" allowfullscreen style="width: 100%; height: 100%;"></iframe>`;
    } else if (streamType === 'iframe') {
        videoEl.style.display = 'none';
        youtubeContainer.style.display = 'block';
        youtubeContainer.innerHTML = `<iframe src="${streamUrl}" frameborder="0" allow="autoplay; fullscreen" allowfullscreen style="width: 100%; height: 100%;"></iframe>`;
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
    videoEl.load();
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
             const appContainer = document.getElementById('app-container');
             appContainer.style.animation = 'zoomOut 0.4s ease-in forwards';
             
             setTimeout(() => {
                 const params = new URLSearchParams({
                     src: channel.stream.url,
                     type: channel.stream.type,
                     title: program.title,
                     desc: program.desc,
                     channelId: channel.id,
                     channelLogo: channel.logo || '',
                     channelNum: channel.number || '',
                     channelName: channel.name || '',
                     startTime: program.start.getTime().toString(),
                     endTime: program.stop.getTime().toString()
                 });
                 window.location.href = `player.html?${params.toString()}`;
             }, 300);
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
    if (!programsByChannel[cIndex] || !programsByChannel[cIndex][pIndex]) {
        console.warn(`Program not found at index [${cIndex}, ${pIndex}]`);
        return;
    };

    selectedChannelIndex = cIndex;
    selectedProgramIndex = pIndex;

    document.querySelectorAll('.program-block.selected').forEach(el => el.classList.remove('selected'));

    const targetBlock = document.querySelector(`.program-block[data-c-index='${cIndex}'][data-p-index='${pIndex}']`);
    if (targetBlock) {
        targetBlock.classList.add('selected');
        const gridContainer = document.getElementById('program-grid-container');
        const blockRect = targetBlock.getBoundingClientRect();
        const containerRect = gridContainer.getBoundingClientRect();

        if (blockRect.top < containerRect.top || blockRect.bottom > containerRect.bottom || blockRect.left < containerRect.left || blockRect.right > containerRect.right) {
             targetBlock.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
        }

        const program = programsByChannel[cIndex][pIndex];
        const channel = guideData.channels[cIndex];
        displayProgramDetails(program, channel);
    } else {
         console.warn(`Target block not found for selection: [${cIndex}, ${pIndex}]`);
          const program = programsByChannel[cIndex]?.[pIndex];
          const channel = guideData.channels[cIndex];
          if(program && channel) displayProgramDetails(program, channel);
    }
}

function handleKeyPress(e) {
    const menu = document.getElementById('side-menu');
    
    if (menu.classList.contains('visible')) {
        if (e.key.toLowerCase() === 'm' || e.key === 'Escape') {
            e.preventDefault();
            toggleMenu();
            return;
        }
        
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            const menuButtons = Array.from(menu.querySelectorAll('.menu-button'));
            const currentIndex = menuButtons.findIndex(btn => btn === document.activeElement);
            
            if (e.key === 'ArrowUp') {
                const prevIndex = currentIndex <= 0 ? menuButtons.length - 1 : currentIndex - 1;
                menuButtons[prevIndex].focus();
            } else {
                const nextIndex = currentIndex >= menuButtons.length - 1 ? 0 : currentIndex + 1;
                menuButtons[nextIndex].focus();
            }
            return;
        }
        
        if (e.key === 'Enter') {
            e.preventDefault();
            if (document.activeElement.classList.contains('menu-button')) {
                document.activeElement.click();
            }
            return;
        }
        
        return;
    }
    
    if (e.key.toLowerCase() === 'm') {
        e.preventDefault();
        toggleMenu();
        return;
    }

    if (e.ctrlKey && e.key.toLowerCase() === 'f') {
        return;
    }

    if (e.key === 'Shift' && !e.repeat) {
        e.preventDefault();
        const video = document.getElementById('mini-player-video');
        const youtubeContainer = document.getElementById('youtube-player-iframe');
        
        if (currentStreamInfo.channelId) {
            const currentlyUnmuted = sessionStorage.getItem('playerUnmuted') === 'true';
            const newMuteState = currentlyUnmuted;
            
            sessionStorage.setItem('playerUnmuted', newMuteState ? 'false' : 'true');
            
            if (currentStreamInfo.type === 'hls' && video.src) {
                video.muted = !video.muted;
                console.log('HLS miniplayer toggled. Muted:', video.muted);
            } 
            else if (currentStreamInfo.type === 'youtube' || currentStreamInfo.type === 'twitch' || currentStreamInfo.type === 'iframe') {
                const channel = guideData.channels.find(ch => ch.id === currentStreamInfo.channelId);
                if (channel) {
                    console.log('Reloading embedded stream with new mute state. Unmuted:', !newMuteState);
                    loadStream(channel, false);
                }
            }
            return;
        }
    }

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
         if (!programsByChannel[newC] || programsByChannel[newC].length === 0) return;

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
                 const timeBias = prog.start >= currentProgram.start ? 0 : 1; 
                 if (diff + timeBias < bestMatch.diff) { bestMatch = { diff: diff + timeBias, index: i }; }
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
    const isOpening = !sideMenu.classList.contains('visible');
    
    appContainer.classList.toggle('blurred');
    menuOverlay.classList.toggle('visible');
    sideMenu.classList.toggle('visible');
    
    if (isOpening) {
        setTimeout(() => {
            const firstMenuItem = sideMenu.querySelector('.menu-button');
            if (firstMenuItem) firstMenuItem.focus();
        }, 100);
    }
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
        let url = `https://api.themoviedb.org/3/search/tv?api_key=${CONFIG.tmdbApiKey}&query=${encodeURIComponent(title)}`;
        let res = await fetch(url);
        if (!res.ok) throw new Error(`TMDb TV search failed: ${res.status}`);
        let data = await res.json();
        let firstResult = data.results?.[0];

        if (!firstResult) {
            url = `https://api.themoviedb.org/3/search/movie?api_key=${CONFIG.tmdbApiKey}&query=${encodeURIComponent(title)}`;
            res = await fetch(url);
             if (!res.ok) throw new Error(`TMDb Movie search failed: ${res.status}`);
             data = await res.json();
             firstResult = data.results?.[0];
        }

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
    const container = document.querySelector('#side-menu #hourly-forecast-widget .forecast-items');
    if (!CONFIG.enableWeather || CONFIG.openWeatherApiKey === 'YOUR_API_KEY_HERE' || !userCoords || !container) return;
    
    const { latitude, longitude } = userCoords;
    const url = `https://api.openweathermap.org/data/2.5/forecast?lat=${latitude}&lon=${longitude}&appid=${CONFIG.openWeatherApiKey}&units=imperial&cnt=4`; 
    try {
        const res = await fetch(url);
        if (res.status === 401) throw new Error("Unauthorized(401). Check OpenWeather API key and plan support for this endpoint.");
        if (!res.ok) throw new Error(`HTTP error! Status: ${res.status}`);
        const data = await res.json();
        
        container.innerHTML = '';
        data.list.slice(0, 4).forEach(item => { 
            const date = new Date(item.dt * 1000);
            const icon = item.weather[0].icon;
            const condition = item.weather[0].main.toLowerCase();
            
            let bgColor = '#4a90e2';
            if (condition.includes('clear')) bgColor = '#f39c12';
            else if (condition.includes('cloud')) bgColor = '#95a5a6';
            else if (condition.includes('rain')) bgColor = '#3498db';
            else if (condition.includes('thunder')) bgColor = '#9b59b6';
            else if (condition.includes('snow')) bgColor = '#ecf0f1';
            else if (condition.includes('mist') || condition.includes('fog')) bgColor = '#bdc3c7';
            
            container.innerHTML += `
                <div class="forecast-item" style="background: ${bgColor};">
                    <div style="font-weight: bold;">${date.toLocaleTimeString([], {hour: 'numeric'})}</div>
                    <img src="https://openweathermap.org/img/wn/${icon}@2x.png" alt="${item.weather[0].description}" style="width: 50px; height: 50px;">
                    <div style="font-size: 1.1em; font-weight: bold;">${Math.round(item.main.temp)}°F</div>
                    <div style="font-size: 0.8em; opacity: 0.9; text-transform: capitalize;">${item.weather[0].description}</div>
                </div>`;
        });
    } catch (err) {
         console.error("Hourly forecast error:", err.message);
         container.innerHTML = '<p style="font-size: 0.8em; text-align: center; margin-top: 1rem;">Forecast unavailable.</p>';
    }
}

function buildRecommendationWidget() {
    const container = document.querySelector('#side-menu #recommendation-widget .rec-content');
    if (!container || !guideData || !guideData.channels) return; 

    const now = new Date();
    const upcoming = [];
    programsByChannel.forEach((channelProgs, cIndex) => {
        if (!channelProgs) return;
        const nextProg = channelProgs.find(p => p.start > now);
        if(nextProg && guideData.channels[cIndex]) { 
            upcoming.push({ program: nextProg, channel: guideData.channels[cIndex] });
        }
    });
    
    if (upcoming.length > 0) {
        const randomRec = upcoming[Math.floor(Math.random() * upcoming.length)];
        
        getPosterUrl(randomRec.program.title).then(posterUrl => {
            const isPlaceholder = posterUrl.includes('placehold.co');
            
            if (isPlaceholder) {
                container.innerHTML = `
                    <div class="rec-backdrop" style="background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);"></div>
                    <div class="rec-overlay">
                        <p class="rec-show-title">${randomRec.program.title}</p>
                        <p class="rec-show-time">${randomRec.program.start.toLocaleTimeString([], {hour:'numeric', minute:'2-digit'})}</p>
                        <p class="rec-show-channel">${randomRec.channel.name} ${randomRec.channel.number}</p>
                    </div>
                `;
            } else {
                container.innerHTML = `
                    <div class="rec-backdrop" style="background-image: url('${posterUrl}');"></div>
                    <div class="rec-overlay">
                        <p class="rec-show-title">${randomRec.program.title}</p>
                        <p class="rec-show-time">${randomRec.program.start.toLocaleTimeString([], {hour:'numeric', minute:'2-digit'})}</p>
                        <p class="rec-show-channel">${randomRec.channel.name} ${randomRec.channel.number}</p>
                    </div>
                `;
            }
        });
    } else {
         container.innerHTML = `<p style="padding: 2rem; text-align: center;">No upcoming shows found.</p>`;
    }
}

function startWidgetSlideshow() {
    const widgetContainer = document.querySelector('#side-menu #widget-slideshow-container');
    if (!widgetContainer) {
        console.warn("Side menu widget container not found.");
        return;
    }

    const allSlides = Array.from(widgetContainer.querySelectorAll('.widget-slide'));
    const slides = allSlides.filter(slide => {
        if (slide.id === 'hourly-forecast-widget' && !CONFIG.enableWeather) {
            slide.style.display = 'none'; 
            return false;
        }
        slide.style.display = 'flex'; 
        return true;
    });

    if(slides.length === 0) {
        widgetContainer.style.display = 'none';
        return;
    };
    widgetContainer.style.display = 'block';
    let currentSlide = 0;

    function showSlide(index) {
        slides.forEach((slide, i) => {
            slide.classList.toggle('active', i === index);
        });
        
        if (slides[index].id === 'recommendation-widget') {
            buildRecommendationWidget();
        } else if (slides[index].id === 'custom-message-widget') {
            showCustomMessage();
        }
    }

    buildRecommendationWidget();

    const intervalId = setInterval(() => {
        if(slides.length <= 1) {
             clearInterval(intervalId);
             return;
        }
        currentSlide = (currentSlide + 1) % slides.length;
        showSlide(currentSlide);
    }, 10000);

    showSlide(0);
}

function showCustomMessage() {
    const container = document.querySelector('#side-menu #custom-message-widget .widget-content');
    if (!container) return;
    
    const messages = CONFIG.messages || ['Welcome to iCable!'];
    const randomMessage = messages[Math.floor(Math.random() * messages.length)];
    
    container.innerHTML = `
        <div style="text-align: center; padding: 2rem; font-size: 1.1em; line-height: 1.6;">
            ${randomMessage}
        </div>
    `;
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

    if (allMessages.length === 0) {
         messageTextEl.textContent = '';
         return;
    }

    if(allMessages.length > 1) {
        for (let i = allMessages.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [allMessages[i], allMessages[j]] = [allMessages[j], allMessages[i]];
        }
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
