let CONFIG = {};
let guideData = null;
let programsByChannel = [];
let selectedChannelIndex = 0;
let selectedProgramIndex = 0;
let userCoords = null;
let guideStartTime;

const sampleXmlTvData = `
<tv>
  <channel id="11"><display-name>11 NUTS</display-name><icon src="https://placehold.co/100x100/000000/FFFFFF?text=NUTS" /></channel>
  <channel id="12"><display-name>12 SCI</display-name><icon src="https://placehold.co/100x100/1a237e/FFFFFF?text=SCI" /></channel>
  <programme start="20251008100000 +0000" stop="20251008110000 +0000" channel="12"><title>How It's Made</title><desc>Today: George Washington, Blankets, Pillows, and More!</desc><episode-num system="xmltv_ns">0.14.2/1</episode-num></programme>
  <programme start="20251008103000 +0000" stop="20251008113000 +0000" channel="11"><title>Ball Fondlers</title><desc>The epic finale.</desc><episode-num system="xmltv_ns">2.3.0/1</episode-num></programme>
</tv>
`;

document.addEventListener('DOMContentLoaded', async () => {
    try {
        await loadConfig();
        applyConfigToUI();
        displayInitialMessage();

        const xmlString = await fetchGuideData();
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(xmlString, "application/xml");
        initializeGuide(xmlDoc);

    } catch (error) {
        console.error("Initialization failed:", error);
        displayInitialMessage('Error', 'Could not start the guide. Check console for details.');
    }

    document.addEventListener('keydown', handleKeyPress);
    syncScrollbars();
});


async function loadConfig() {
    const response = await fetch('config.xml');
    if (!response.ok) throw new Error("config.xml not found or could not be loaded.");
    const xmlString = await response.text();
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlString, "application/xml");

    CONFIG.xmltvUrl = xmlDoc.querySelector('xmltvUrl').textContent;
    CONFIG.openWeatherApiKey = xmlDoc.querySelector('openWeatherApiKey').textContent;
    CONFIG.tmdbApiKey = xmlDoc.querySelector('tmdbApiKey').textContent;
    CONFIG.playerUrl = xmlDoc.querySelector('player url').textContent;
    CONFIG.enableLogo = xmlDoc.querySelector('enableLogo').textContent === 'true';
    CONFIG.logoUrl = xmlDoc.querySelector('logoUrl').textContent;
    CONFIG.enableWeather = xmlDoc.querySelector('enableWeather').textContent === 'true';
    CONFIG.messages = Array.from(xmlDoc.querySelectorAll('messages message')).map(m => m.textContent);

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
        if (forecastWidget) forecastWidget.style.display = 'none';
    }
}

async function fetchGuideData() {
    try {
        const response = await fetch(CONFIG.xmltvUrl);
        if (!response.ok) throw new Error('Network response was not ok');
        return await response.text();
    } catch (error) {
        console.error('Failed to fetch live guide data:', error);
        displayInitialMessage('Error', 'Could not fetch live data. Loading sample data instead.');
        return sampleXmlTvData;
    }
}


function initializeGuide(xmlDoc) {
    guideData = parseAndMergeData(xmlDoc);
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

function parseAndMergeData(xmlDoc) {
    let channels = Array.from(xmlDoc.querySelectorAll('channel')).map(tag => {
        const nameContent = tag.querySelector('display-name').textContent;
        const nameParts = nameContent.split(' ');
        const number = nameParts.shift();
        const name = nameParts.join(' ');
        return { id: tag.getAttribute('id'), name, number, logo: tag.querySelector('icon')?.getAttribute('src') || '' };
    });

    let programmes = Array.from(xmlDoc.querySelectorAll('programme')).map(tag => {
        const epNumTag = tag.querySelector('episode-num');
        let episodeNum = '';
        if (epNumTag && epNumTag.getAttribute('system') === 'xmltv_ns') {
            const parts = epNumTag.textContent.split('.');
            const s = parseInt(parts[0]) + 1;
            const e = parseInt(parts[1]) + 1;
            if (!isNaN(s) && !isNaN(e)) episodeNum = `S${String(s).padStart(2, '0')}E${String(e).padStart(2, '0')}`;
        }
        return {
            channel: tag.getAttribute('channel'),
            start: parseXMLTVTime(tag.getAttribute('start')),
            stop: parseXMLTVTime(tag.getAttribute('stop')),
            title: tag.querySelector('title').textContent,
            desc: tag.querySelector('desc')?.textContent || 'No description available.',
            episodeNum: episodeNum
        };
    });

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
        channelDiv.addEventListener('click', () => tuneToChannel(channel.id));
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

            programBlock.addEventListener('click', () => {
                selectProgram(cIndex, pIndex);
                tuneToChannel(channel.id);
            });
            programGrid.appendChild(programBlock);
        });
    });

    const nowOffsetMinutes = (new Date() - guideStartTime) / 60000;
    const viewCenterMinutes = (CONFIG.guideViewHours * 60) / 2;
    const initialScrollPx = (nowOffsetMinutes - viewCenterMinutes) * pxPerMinute;
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
    setTimeout(() => {
        if (descriptionP.scrollHeight > descriptionP.clientHeight) {
            descriptionP.classList.add('autoscroll');
        }
    }, 50);
}

function tuneToChannel(channelId) {
    if (!channelId) return;
    window.open(`${CONFIG.playerUrl}#${channelId}`, '_blank');
}

function selectInitialProgram() {
    const now = new Date();
    for (let c = 0; c < programsByChannel.length; c++) {
        for (let p = 0; p < programsByChannel[c].length; p++) {
            if (programsByChannel[c][p].stop > now) {
                selectProgram(c, p); return;
            }
        }
    }
    if (programsByChannel.length > 0 && programsByChannel[0].length > 0) {
        selectProgram(0, 0);
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
        case "Enter": tuneToChannel(guideData.channels[selectedChannelIndex].id); return;
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
    if (!title || CONFIG.tmdbApiKey === 'YOUR_API_KEY_HERE') {
        return `https://placehold.co/400x600/0c1428/FFFFFF?text=${encodeURIComponent(title || 'No Title')}`;
    }
    try {
        const url = `https://api.themoviedb.org/3/search/multi?api_key=${CONFIG.tmdbApiKey}&query=${encodeURIComponent(title)}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error("Failed to fetch from TMDb");
        const data = await res.json();
        const firstResult = data.results?.[0];
        if (firstResult?.poster_path) {
            return `https://image.tmdb.org/t/p/w400${firstResult.poster_path}`;
        }
    } catch (err) {
        console.error("TMDb fetch error:", err.message);
    }
    return `https://placehold.co/400x600/0c1428/FFFFFF?text=${encodeURIComponent(title)}`;
}

async function fetchWeather() {
    if (!CONFIG.enableWeather || CONFIG.openWeatherApiKey === 'YOUR_API_KEY_HERE' || !userCoords) return;
    const { latitude, longitude } = userCoords;
    const url = `https://api.openweathermap.org/data/2.5/weather?lat=${latitude}&lon=${longitude}&appid=${CONFIG.openWeatherApiKey}&units=imperial`;
    try {
        const res = await fetch(url);
        if (res.status === 401) throw new Error("Unauthorized. Check your OpenWeather API key and plan.");
        if (!res.ok) throw new Error(`HTTP error! Status: ${res.status}`);
        const data = await res.json();
        const weatherEl = document.getElementById('guide-weather');
        if (weatherEl && data.main) weatherEl.textContent = `${Math.round(data.main.temp)}°F`;
    } catch (err) {
        console.error("Weather fetch error:", err.message);
    }
}

async function fetchHourlyForecast() {
    if (!CONFIG.enableWeather || CONFIG.openWeatherApiKey === 'YOUR_API_KEY_HERE' || !userCoords) return;
    const { latitude, longitude } = userCoords;
    const url = `https://api.openweathermap.org/data/2.5/forecast?lat=${latitude}&lon=${longitude}&appid=${CONFIG.openWeatherApiKey}&units=imperial&cnt=4`;
    try {
        const res = await fetch(url);
        if (res.status === 401) throw new Error("Unauthorized. Your OpenWeather plan may not support this forecast endpoint.");
        if (!res.ok) throw new Error(`HTTP error! Status: ${res.status}`);
        const data = await res.json();
        const container = document.querySelector('#hourly-forecast-widget .forecast-items');
        container.innerHTML = '';
        data.list.forEach(item => {
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
    }
}

function buildRecommendationWidget() {
    const now = new Date();
    const upcoming = [];
    if (!programsByChannel) return;
    programsByChannel.forEach((channelProgs, cIndex) => {
        const nextProg = channelProgs.find(p => p.start > now);
        if(nextProg) upcoming.push({ program: nextProg, channel: guideData.channels[cIndex] });
    });

    const container = document.querySelector('#recommendation-widget .rec-content');
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
    const allSlides = Array.from(document.querySelectorAll('.widget-slide'));
    const slides = allSlides.filter(slide => {
        if (slide.id === 'hourly-forecast-widget' && !CONFIG.enableWeather) {
            return false;
        }
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
    if (programsByChannel) {
        programsByChannel.forEach((channelProgs, cIndex) => {
            const nextProg = channelProgs.find(p => p.start > now);
            if(nextProg) upcoming.push({ program: nextProg, channel: guideData.channels[cIndex] });
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
        messageTextEl.textContent = allMessages[currentMessageIndex];
        currentMessageIndex = (currentMessageIndex + 1) % allMessages.length;
    }

    setInterval(displayNextMessage, 15000);
    displayNextMessage();
}
