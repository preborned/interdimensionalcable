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
let mediaLibrary = {
    continueWatching: [],
    movies: [],
    tvShows: [],
    freeMovies: [],
    popular: []
};
let currentItem = null;
let hlsInstance = null;
let selectedRowIndex = 0;
let selectedItemIndex = 0;
let allRows = [];

document.addEventListener('DOMContentLoaded', async () => {
    CONFIG = window.iCableConfig.get();
    
    await loadConfigAndApplyUI();
    await loadMediaContent();
    
    document.addEventListener('keydown', handleKeyPress);
    
    const menuOverlay = document.getElementById('menu-overlay');
    if (menuOverlay) {
        menuOverlay.addEventListener('click', toggleMenu);
    }
    
    document.getElementById('action-play').addEventListener('click', () => playSelectedItem());
    document.getElementById('action-restart').addEventListener('click', () => restartItem());
    document.getElementById('action-episodes').addEventListener('click', () => showEpisodes());
    document.getElementById('action-close').addEventListener('click', () => closeActionMenu());
    document.getElementById('action-menu-overlay').addEventListener('click', (e) => {
        if (e.target === e.currentTarget) closeActionMenu();
    });
    
    updateTime();
    setInterval(updateTime, 10000);
    
    if (CONFIG.appearance?.enableWeather) {
        navigator.geolocation.getCurrentPosition(pos => {
            fetchWeather(pos.coords);
            window.MenuWidgets.init(CONFIG, pos.coords);
        }, () => {
            window.MenuWidgets.init(CONFIG);
        });
    } else {
        window.MenuWidgets.init(CONFIG);
    }
    
    checkPersistentMiniplayer();
    setupMiniplayerControls();
});

async function loadConfigAndApplyUI() {
    if (CONFIG.appearance?.systemLogoId) {
        const logoData = await window.iCableConfig.getImage(CONFIG.appearance.systemLogoId);
        if (logoData) {
            const logoEl = document.getElementById('ondemand-logo-placeholder');
            if (logoEl) {
                logoEl.style.backgroundImage = `url('${logoData.data}')`;
                logoEl.style.border = 'none';
            }
        }
    }
}

async function loadMediaContent() {
    const contentEl = document.getElementById('ondemand-content');
    contentEl.innerHTML = '<div class="loading-indicator">Loading your library...</div>';
    
    try {
        if (CONFIG.integrations?.jellyfin?.enabled && CONFIG.integrations?.jellyfin?.url) {
            await loadJellyfinContent();
        }
        
        await loadFreeContent();
        renderContentRows();
        
    } catch (error) {
        console.error('Failed to load content:', error);
        contentEl.innerHTML = `
            <div style="text-align: center; padding: 3rem;">
                <h2 style="color: var(--accent-color);">No Media Sources Configured</h2>
                <p>Go to Settings > Integrations to connect Jellyfin, Plex, or Emby</p>
                <a href="settings.html" style="color: var(--accent-color); text-decoration: underline;">Open Settings</a>
            </div>
        `;
    }
}

async function loadJellyfinContent() {
    const baseUrl = CONFIG.integrations.jellyfin.url.replace(/\/$/, '');
    const apiKey = CONFIG.integrations.jellyfin.apiKey;
    
    if (!apiKey) {
        throw new Error('Jellyfin API key required');
    }
    
    const usersRes = await fetch(`${baseUrl}/Users`, {
        headers: { 'X-Emby-Token': apiKey }
    });
    const users = await usersRes.json();
    const userId = users[0]?.Id;
    
    if (!userId) throw new Error('No Jellyfin users found');
    
    try {
        const resumeRes = await fetch(`${baseUrl}/Users/${userId}/Items/Resume?Limit=20&Fields=Overview,PrimaryImageAspectRatio`, {
            headers: { 'X-Emby-Token': apiKey }
        });
        const resumeData = await resumeRes.json();
        
        for (const item of resumeData.Items) {
            if (item.Type === 'Episode' || item.Type === 'Movie') {
                mediaLibrary.continueWatching.push(await formatJellyfinItem(item, baseUrl, apiKey, userId));
            }
        }
    } catch (e) {
        console.warn('Could not load continue watching:', e);
    }
    
    try {
        const moviesRes = await fetch(`${baseUrl}/Users/${userId}/Items?IncludeItemTypes=Movie&Recursive=true&Limit=30&SortBy=DateCreated,SortName&SortOrder=Descending&Fields=Overview,PrimaryImageAspectRatio`, {
            headers: { 'X-Emby-Token': apiKey }
        });
        const moviesData = await moviesRes.json();
        
        for (const item of moviesData.Items) {
            mediaLibrary.movies.push(await formatJellyfinItem(item, baseUrl, apiKey, userId));
        }
    } catch (e) {
        console.warn('Could not load movies:', e);
    }
    
    try {
        const tvRes = await fetch(`${baseUrl}/Shows/NextUp?UserId=${userId}&Limit=30&Fields=Overview,PrimaryImageAspectRatio`, {
            headers: { 'X-Emby-Token': apiKey }
        });
        const tvData = await tvRes.json();
        
        for (const item of tvData.Items) {
            if (item.Type === 'Episode') {
                mediaLibrary.tvShows.push(await formatJellyfinItem(item, baseUrl, apiKey, userId));
            }
        }
    } catch (e) {
        console.warn('Could not load TV shows:', e);
    }
}

async function formatJellyfinItem(item, baseUrl, apiKey, userId) {
    const streamUrl = `${baseUrl}/Videos/${item.Id}/master.m3u8?MediaSourceId=${item.Id}&VideoCodec=h264,h265,hevc&AudioCodec=aac,mp3,ac3,eac3&AudioStreamIndex=1&VideoBitrate=120000000&AudioBitrate=384000&MaxFramerate=60&api_key=${apiKey}&TranscodingMaxAudioChannels=2&RequireAvc=false&Tag=${item.Etag}&SegmentContainer=ts&MinSegments=1&h264-profile=high,main,baseline,constrainedbaseline,high10&h264-level=52&TranscodeReasons=VideoCodecNotSupported`;
    
    const percentage = item.UserData?.PlayedPercentage || 0;
    
    const formatted = {
        id: item.Id,
        title: item.SeriesName || item.Name,
        year: item.ProductionYear || '',
        type: item.Type === 'Episode' ? 'episode' : (item.Type === 'Series' ? 'series' : 'movie'),
        rating: item.OfficialRating || '',
        overview: item.Overview || 'No description available.',
        posterUrl: item.ImageTags?.Primary 
            ? `${baseUrl}/Items/${item.Id}/Images/Primary?api_key=${apiKey}&maxWidth=400` 
            : (item.SeriesId ? `${baseUrl}/Items/${item.SeriesId}/Images/Primary?api_key=${apiKey}&maxWidth=400` : 'https://placehold.co/400x600/0c1428/FFFFFF?text=' + encodeURIComponent(item.Name)),
        streamUrl: streamUrl,
        streamType: 'hls',
        progress: 0,
        percentage: percentage,
        seriesId: item.SeriesId,
        seasonName: item.SeasonName || '',
        episodeNumber: item.IndexNumber || '',
        source: 'jellyfin',
        baseUrl,
        apiKey,
        userId
    };
    
    if (percentage > 0) {
        formatted.progress = 1; 
    }
    
    if (formatted.type === 'episode' && formatted.episodeNumber) {
        formatted.displayTitle = `${formatted.title} - S${item.ParentIndexNumber || '?'}E${formatted.episodeNumber}`;
    } else {
        formatted.displayTitle = formatted.title;
    }
    
    return formatted;
}

async function loadFreeContent() {
    mediaLibrary.popular = [];
    mediaLibrary.freeMovies = [];
}

function renderContentRows() {
    const contentEl = document.getElementById('ondemand-content');
    let html = '';
    
    const rows = [
        { title: 'Continue Watching', items: mediaLibrary.continueWatching, id: 'continue' },
        { title: 'Movies', items: mediaLibrary.movies, id: 'movies' },
        { title: 'TV Shows', items: mediaLibrary.tvShows, id: 'tv' },
        { title: 'Free Movies', items: mediaLibrary.freeMovies, id: 'free' },
        { title: 'Popular', items: mediaLibrary.popular, id: 'popular' }
    ];
    
    allRows = rows.filter(row => row.items.length > 0);
    
    allRows.forEach((row, rowIndex) => {
        html += `
            <div class="content-row" data-row-index="${rowIndex}">
                <div class="row-header">
                    <div class="row-title">${row.title}</div>
                    <div class="row-count">${row.items.length} items</div>
                </div>
                <div class="poster-grid" id="row-${row.id}">
                    ${row.items.map((item, itemIndex) => `
                        <div class="poster-item" tabindex="0" data-row="${rowIndex}" data-item="${itemIndex}">
                            <img class="poster-image" src="${item.posterUrl}" alt="${item.displayTitle}" loading="lazy">
                            <div class="poster-overlay">
                                <div class="poster-title">${item.displayTitle}</div>
                                <div class="poster-meta">
                                    ${item.rating ? `<span class="poster-rating">${item.rating}</span>` : ''}
                                    ${item.year} • ${item.type}
                                </div>
                                <div class="poster-desc">${item.overview.substring(0, 100)}...</div>
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    });
    
    if (html === '') {
        html = `
            <div style="text-align: center; padding: 3rem;">
                <h2 style="color: var(--accent-color);">No Content Found</h2>
                <p>Add media to your Jellyfin server or configure integrations in Settings</p>
            </div>
        `;
    }
    
    contentEl.innerHTML = html;
    
    document.querySelectorAll('.poster-item').forEach(el => {
        const rowIdx = parseInt(el.dataset.row);
        const itemIdx = parseInt(el.dataset.item);
        
        el.addEventListener('click', () => showActionMenu(rowIdx, itemIdx));
        el.addEventListener('mouseenter', () => updateDetailsPreview(rowIdx, itemIdx));
    });
    
    if (allRows.length > 0 && allRows[0].items.length > 0) {
        selectPoster(0, 0);
    }
}

function selectPoster(rowIndex, itemIndex) {
    if (!allRows[rowIndex] || !allRows[rowIndex].items[itemIndex]) return;
    
    selectedRowIndex = rowIndex;
    selectedItemIndex = itemIndex;
    
    document.querySelectorAll('.poster-item').forEach(el => {
        el.style.outline = '';
        el.classList.remove('selected');
    });
    
    const selector = `.poster-item[data-row="${rowIndex}"][data-item="${itemIndex}"]`;
    const element = document.querySelector(selector);
    if (element) {
        element.style.outline = '3px solid var(--accent-color)';
        element.classList.add('selected');
        element.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    }
    
    updateDetailsPreview(rowIndex, itemIndex);
}

function updateDetailsPreview(rowIndex, itemIndex) {
    const item = allRows[rowIndex]?.items[itemIndex];
    if (!item) return;
    
    document.getElementById('detail-poster').src = item.posterUrl;
    document.getElementById('detail-title').textContent = item.displayTitle;
    document.getElementById('detail-meta').textContent = `${item.year} • ${item.type}${item.rating ? ' • ' + item.rating : ''}`;
    document.getElementById('detail-desc').textContent = item.overview;
}

function showActionMenu(rowIndex, itemIndex) {
    currentItem = allRows[rowIndex]?.items[itemIndex];
    if (!currentItem) return;
    
    document.getElementById('action-menu-poster').src = currentItem.posterUrl;
    document.getElementById('action-menu-title').textContent = currentItem.displayTitle;
    document.getElementById('action-menu-meta').textContent = `${currentItem.year} • ${currentItem.type}${currentItem.rating ? ' • ' + currentItem.rating : ''}`;
    document.getElementById('action-menu-desc').textContent = currentItem.overview;
    
    const playBtn = document.getElementById('action-play');
    const restartBtn = document.getElementById('action-restart');
    const episodesBtn = document.getElementById('action-episodes');
    
    let hasLocalProgress = false;
    try {
        const persistentData = JSON.parse(sessionStorage.getItem('persistentMiniplayer') || '{}');
        if (persistentData.title === currentItem.displayTitle || persistentData.itemId === currentItem.id) {
             if (persistentData.progress > 5) {
                 hasLocalProgress = true;
                 currentItem.progress = persistentData.progress;
             }
        }
    } catch (e) {}

    if (currentItem.progress > 0 || currentItem.percentage > 0 || hasLocalProgress) {
        playBtn.textContent = '▶ Continue';
        restartBtn.style.display = 'block';
    } else {
        playBtn.textContent = '▶ Play';
        restartBtn.style.display = 'none';
    }
    
    episodesBtn.style.display = 'none';
    
    document.getElementById('action-menu-overlay').classList.add('visible');
    document.getElementById('action-play').focus();
}

function closeActionMenu() {
    document.getElementById('action-menu-overlay').classList.remove('visible');
}

function playSelectedItem() {
    if (!currentItem) return;
    closeActionMenu();
    launchPlayer(currentItem.progress || 0);
}

function restartItem() {
    if (!currentItem) return;
    closeActionMenu();
    launchPlayer(0);
}

function launchPlayer(startTime) {
    const streamInfo = {
        source: 'ondemand',
        type: String(currentItem.streamType || 'hls'),
        url: String(currentItem.streamUrl || ''),
        title: String(currentItem.displayTitle || currentItem.title || 'Unknown'),
        desc: String(currentItem.overview || ''),
        year: String(currentItem.year || ''),
        itemId: String(currentItem.id || ''),
        progress: Number(startTime) || 0,
        channelId: '',
        channelLogo: '',
        channelNum: '',
        channelName: '',
        startTime: '',
        endTime: ''
    };
    
    sessionStorage.setItem('playerData', JSON.stringify(streamInfo));
    sessionStorage.setItem('persistentMiniplayer', JSON.stringify(streamInfo));
    
    const app = document.getElementById('app-container');
    if (app) app.style.animation = 'zoomOut 0.3s ease-in forwards';
    setTimeout(() => {
        window.location.href = 'player.html';
    }, 300);
}

async function showEpisodes() {
    alert('Episode selection coming soon!');
}

function setupMiniplayerControls() {
    const video = document.getElementById('mini-player-video');
    const wrapper = document.getElementById('player-ui-wrapper');
    const progressFilled = document.getElementById('progress-bar-filled');

    video.addEventListener('timeupdate', () => {
        if(video.duration && !isNaN(video.duration)) {
            progressFilled.style.width = `${(video.currentTime / video.duration) * 100}%`;
            saveMiniplayerState();
        } else {
            progressFilled.style.width = `0%`;
        }
    });

    video.addEventListener('play', () => wrapper.classList.remove('paused'));
    video.addEventListener('pause', () => wrapper.classList.add('paused'));

    video.addEventListener('click', () => {
        const persistentStream = sessionStorage.getItem('persistentMiniplayer');
        if (persistentStream) {
            const currentlyUnmuted = sessionStorage.getItem('miniplayerUnmuted') === 'true';
            sessionStorage.setItem('miniplayerUnmuted', currentlyUnmuted ? 'false' : 'true');
            
            const streamInfo = JSON.parse(persistentStream);
            if (streamInfo.type === 'hls' && video.src) {
                video.muted = !video.muted;
            } else {
                loadMiniPlayer(streamInfo);
            }
        }
    });
}

function saveMiniplayerState() {
    const video = document.getElementById('mini-player-video');
    if (!video || video.paused) return;
    
    try {
        const persistentStream = sessionStorage.getItem('persistentMiniplayer');
        if (persistentStream) {
            const streamInfo = JSON.parse(persistentStream);
            streamInfo.progress = video.currentTime;
            sessionStorage.setItem('persistentMiniplayer', JSON.stringify(streamInfo));
        }
    } catch (e) {}
}

function checkPersistentMiniplayer() {
    const persistentStream = sessionStorage.getItem('persistentMiniplayer');
    if (persistentStream) {
        try {
            const streamInfo = JSON.parse(persistentStream);
            loadMiniPlayer(streamInfo);
        } catch (e) {
            console.warn('Could not resume miniplayer:', e);
        }
    }
}

function loadMiniPlayer(streamInfo) {
    const playerContainer = document.getElementById('mini-player-container');
    const videoEl = document.getElementById('mini-player-video');
    const youtubeContainer = document.getElementById('youtube-player-iframe');
    
    if (hlsInstance) {
        hlsInstance.destroy();
        hlsInstance = null;
    }
    
    playerContainer.classList.add('active');
    
    const userUnmuted = sessionStorage.getItem('miniplayerUnmuted') === 'true';
    const finalMuteState = !userUnmuted;
    
    if (streamInfo.type === 'hls') {
        videoEl.style.display = 'block';
        youtubeContainer.style.display = 'none';
        videoEl.muted = finalMuteState;
        
        if (Hls.isSupported()) {
            hlsInstance = new Hls({ debug: false });
            hlsInstance.loadSource(streamInfo.url);
            hlsInstance.attachMedia(videoEl);
            hlsInstance.on(Hls.Events.MANIFEST_PARSED, () => {
                if (streamInfo.progress && streamInfo.progress > 0) {
                    videoEl.currentTime = streamInfo.progress;
                }
                videoEl.play().catch(e => console.warn('Autoplay prevented:', e));
            });
        } else if (videoEl.canPlayType('application/vnd.apple.mpegurl')) {
            videoEl.src = streamInfo.url;
            videoEl.addEventListener('loadedmetadata', () => {
                if (streamInfo.progress && streamInfo.progress > 0) {
                    videoEl.currentTime = streamInfo.progress;
                }
                videoEl.play().catch(e => console.warn('Autoplay prevented:', e));
            });
        }
    } else if (streamInfo.type === 'youtube') {
        videoEl.style.display = 'none';
        youtubeContainer.style.display = 'block';
        const muteParam = finalMuteState ? '1' : '0';
        youtubeContainer.innerHTML = `<iframe src="https://www.youtube.com/embed/${streamInfo.url}?autoplay=1&mute=${muteParam}&controls=0&modestbranding=1&rel=0&enablejsapi=1" frameborder="0" allow="autoplay; encrypted-media" allowfullscreen></iframe>`;
    }
}

function handleKeyPress(e) {
    const menu = document.getElementById('side-menu');
    const actionMenu = document.getElementById('action-menu-overlay');
    
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
    
    if (actionMenu.classList.contains('visible')) {
        if (e.key === 'Escape' || e.key === 'b' || e.key === 'Backspace') {
            e.preventDefault();
            closeActionMenu();
            return;
        }
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            const buttons = Array.from(document.querySelectorAll('.action-btn:not([style*="display: none"])'));
            const currentIndex = buttons.findIndex(btn => btn === document.activeElement);
            if (e.key === 'ArrowUp') {
                const prevIndex = currentIndex <= 0 ? buttons.length - 1 : currentIndex - 1;
                buttons[prevIndex].focus();
            } else {
                const nextIndex = currentIndex >= buttons.length - 1 ? 0 : currentIndex + 1;
                buttons[nextIndex].focus();
            }
            return;
        }
        if (e.key === 'Enter') {
            e.preventDefault();
            if (document.activeElement) document.activeElement.click();
            return;
        }
        return;
    }
    
    const key = e.key.toLowerCase();
    
    if (key === 'm') {
        e.preventDefault();
        toggleMenu();
        return;
    }
    
    if (key === 'o') {
        e.preventDefault();
        saveMiniplayerState();
        window.location.reload();
        return;
    }
    
    if (key === 'g') {
        e.preventDefault();
        saveMiniplayerState();
        const app = document.getElementById('app-container');
        app.style.animation = 'zoomOut 0.3s ease-in forwards';
        setTimeout(() => {
            window.location.href = 'index.html';
        }, 300);
        return;
    }
    
    if (key === 'b' || key === 'backspace') {
        e.preventDefault();
        saveMiniplayerState();
        window.history.back();
        return;
    }
    
    if (e.key === 'Shift' && !e.repeat) {
        e.preventDefault();
        const persistentStream = sessionStorage.getItem('persistentMiniplayer');
        if (persistentStream) {
            const currentlyUnmuted = sessionStorage.getItem('miniplayerUnmuted') === 'true';
            sessionStorage.setItem('miniplayerUnmuted', currentlyUnmuted ? 'false' : 'true');
            const video = document.getElementById('mini-player-video');
            const streamInfo = JSON.parse(persistentStream);
            if (streamInfo.type === 'hls' && video.src) {
                video.muted = !video.muted;
            } else {
                loadMiniPlayer(streamInfo);
            }
        }
        return;
    }
    
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (allRows.length === 0) return;
    
    e.preventDefault();
    
    switch (e.key) {
        case 'ArrowUp':
            if (selectedRowIndex > 0) {
                const newItemIndex = Math.min(selectedItemIndex, allRows[selectedRowIndex - 1].items.length - 1);
                selectPoster(selectedRowIndex - 1, newItemIndex);
            }
            break;
        case 'ArrowDown':
            if (selectedRowIndex < allRows.length - 1) {
                const newItemIndex = Math.min(selectedItemIndex, allRows[selectedRowIndex + 1].items.length - 1);
                selectPoster(selectedRowIndex + 1, newItemIndex);
            }
            break;
        case 'ArrowLeft':
            if (selectedItemIndex > 0) {
                selectPoster(selectedRowIndex, selectedItemIndex - 1);
            }
            break;
        case 'ArrowRight':
            if (selectedItemIndex < allRows[selectedRowIndex].items.length - 1) {
                selectPoster(selectedRowIndex, selectedItemIndex + 1);
            }
            break;
        case 'Enter':
            showActionMenu(selectedRowIndex, selectedItemIndex);
            break;
    }
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
    const timeEl = document.getElementById('ondemand-time');
    if (timeEl) timeEl.textContent = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

async function fetchWeather(coords) {
    if (!CONFIG.appearance?.weatherApiKey || CONFIG.appearance.weatherApiKey === 'YOUR_API_KEY_HERE') return;
    try {
        const url = `https://api.openweathermap.org/data/2.5/weather?lat=${coords.latitude}&lon=${coords.longitude}&appid=${CONFIG.appearance.weatherApiKey}&units=imperial`;
        const res = await fetch(url);
        const data = await res.json();
        const weatherEl = document.getElementById('ondemand-weather');
        if (weatherEl && data.main) weatherEl.textContent = `${Math.round(data.main.temp)}°F`;
    } catch (err) { console.error('Weather error:', err); }
}
