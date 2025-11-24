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

let infoBarTimeout = null;
let hls = null;
let isPaused = false;
let isMuted = true;
let videoElement = null;
let streamType = '';
let programStartTime = null;
let programEndTime = null;
let errorSound = null;
let allChannels = [];
let currentChannelIndex = -1;
let hideTimeout = null;
let isOnDemand = false;
let youtubePlayer = null;
let twitchPlayer = null;
let currentSrc = '';
let startProgress = 0;
let activePlayerData = null; 

document.addEventListener('DOMContentLoaded', async () => {
    videoElement = document.getElementById('fullscreen-video');
    errorSound = document.getElementById('error-sound');
    
    const sessionData = sessionStorage.getItem('playerData');
    if (sessionData) {
        try {
            activePlayerData = JSON.parse(sessionData);
        } catch (e) { console.error('Failed to parse playerData:', e); }
    }
    
    if (!activePlayerData) {
        const persistentData = sessionStorage.getItem('persistentMiniplayer');
        if (persistentData) {
            try {
                activePlayerData = JSON.parse(persistentData);
            } catch (e) { console.error('Failed to parse persistentMiniplayer:', e); }
        }
    }
    
    if (!activePlayerData) {
        const params = new URLSearchParams(window.location.search);
        if (params.get('src') && params.get('type')) {
            activePlayerData = {
                url: params.get('src'),
                type: params.get('type'),
                title: params.get('title') || 'Unknown Program',
                desc: params.get('desc') || '',
                channelId: params.get('channelId') || '',
                channelLogo: params.get('channelLogo') || '',
                channelNum: params.get('channelNum') || '',
                channelName: params.get('channelName') || '',
                startTime: params.get('startTime') || '',
                endTime: params.get('endTime') || '',
                source: params.get('source') || 'live',
                year: params.get('year') || '',
                itemId: params.get('itemId') || '',
                progress: Number(params.get('progress')) || 0
            };
        }
    }
    
    if (!activePlayerData || !activePlayerData.url || !activePlayerData.type) {
        console.error('Missing required stream data:', activePlayerData);
        alert('Invalid stream data. Returning to previous page.');
        window.history.back();
        return;
    }
    
    const src = activePlayerData.url;
    streamType = activePlayerData.type;
    currentSrc = src;
    startProgress = activePlayerData.progress || 0;
    
    const title = activePlayerData.title || 'Unknown';
    const channelId = activePlayerData.channelId || '';
    const channelLogo = activePlayerData.channelLogo || '';
    const channelNum = activePlayerData.channelNum || '';
    const channelName = activePlayerData.channelName || '';
    const startTime = activePlayerData.startTime;
    const endTime = activePlayerData.endTime;
    const year = activePlayerData.year || '';
    isOnDemand = activePlayerData.source === 'ondemand';
    
    const persistentUnmute = sessionStorage.getItem('miniplayerUnmuted') === 'true';
    isMuted = !persistentUnmute;
    
    const params = new URLSearchParams(window.location.search);
    const noAnimation = params.get('noAnimation') === 'true';
    const appContainer = document.getElementById('app-container');
    if (noAnimation && appContainer) {
        appContainer.style.animation = 'none';
    }
    
    const config = window.iCableConfig.get();
    
    if (config.appearance?.enableWeather) {
        navigator.geolocation.getCurrentPosition(pos => {
            window.MenuWidgets.init(config, pos.coords);
        }, () => {
            window.MenuWidgets.init(config);
        });
    } else {
        window.MenuWidgets.init(config);
    }
    
    allChannels = [...(config.channels || []), ...(config.customChannels || [])];
    allChannels.sort((a, b) => parseInt(a.number) - parseInt(b.number));
    if (channelId) {
        currentChannelIndex = allChannels.findIndex(ch => ch.id === channelId);
    }
    
    if (config.appearance?.systemLogoId) {
        const logoData = await window.iCableConfig.getImage(config.appearance.systemLogoId);
        if (logoData) {
            document.getElementById('info-system-logo').src = logoData.data;
        }
    }
    
    if (isOnDemand) {
        document.getElementById('info-title').textContent = title;
        const logoEl = document.getElementById('info-channel-logo');
        if (logoEl) logoEl.style.display = 'none';
        document.getElementById('info-channel-num').textContent = year;
        document.getElementById('info-channel-name').textContent = '';
        document.getElementById('info-timeslot').textContent = '';
        const surfIndicator = document.getElementById('channel-surf-indicator');
        if (surfIndicator) surfIndicator.style.display = 'none';
        
        const controlKeys = document.querySelector('.control-keys');
        if (controlKeys) {
            const surfControl = Array.from(controlKeys.children).find(el => 
                el.textContent.includes('Surf')
            );
            if (surfControl) {
                surfControl.innerHTML = '<span class="key-btn">O</span><span>On-Demand</span>';
            }
        }
    } else {
        document.getElementById('info-title').textContent = title;
        document.getElementById('info-channel-logo').src = channelLogo || 'https://placehold.co/100x100/4d648d/FFFFFF?text=' + channelNum;
        document.getElementById('info-channel-num').textContent = channelNum;
        document.getElementById('info-channel-name').textContent = channelName;
        const hdIndicator = document.getElementById('info-hd');
        if (hdIndicator) hdIndicator.style.display = 'inline-block';
        
        if (startTime && endTime) {
            try {
                programStartTime = new Date(parseInt(startTime));
                programEndTime = new Date(parseInt(endTime));
                
                const startStr = programStartTime.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
                const endStr = programEndTime.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
                document.getElementById('info-timeslot').textContent = `${startStr} - ${endStr}`;
            } catch (e) {
                console.warn('Invalid time data:', e);
            }
        }
    }
    
    updateClock();
    setInterval(updateClock, 10000);
    
    if (config.appearance?.enableWeather) {
        navigator.geolocation.getCurrentPosition(pos => {
            fetchWeather(pos.coords, config.appearance.weatherApiKey);
        }, () => {});
    }
    
    startPlayback(src, streamType);
    
    if (isMuted) {
        const unmuteMsg = document.getElementById('unmute-message');
        if (unmuteMsg) {
            unmuteMsg.classList.add('visible');
            setTimeout(() => {
                unmuteMsg.classList.remove('visible');
            }, 5000);
        }
    }
    
    scheduleHide();
    
    document.addEventListener('mousemove', () => {
        if (!isPaused) {
            showOverlays();
            scheduleHide();
        }
    });
    
    document.addEventListener('keydown', handleKeyPress);
    
    setupDVRControls();
    
    const menuOverlay = document.getElementById('menu-overlay');
    if (menuOverlay) {
        menuOverlay.addEventListener('click', toggleMenu);
    }
});

function updateClock() {
    const clockEl = document.getElementById('info-clock');
    if (clockEl) {
        clockEl.textContent = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    }
}

async function fetchWeather(coords, apiKey) {
    if (!apiKey || apiKey === 'YOUR_API_KEY_HERE') return;
    
    const { latitude, longitude } = coords;
    const url = `https://api.openweathermap.org/data/2.5/weather?lat=${latitude}&lon=${longitude}&appid=${apiKey}&units=imperial`;
    
    try {
        const res = await fetch(url);
        if (!res.ok) throw new Error('Weather fetch failed');
        const data = await res.json();
        const weatherEl = document.getElementById('info-weather');
        if (weatherEl) {
            weatherEl.textContent = `${Math.round(data.main.temp)}°F`;
        }
    } catch (err) {
        console.error('Weather error:', err);
    }
}

function scheduleHide() {
    clearTimeout(hideTimeout);
    hideTimeout = setTimeout(() => {
        if (!isPaused) hideOverlays();
    }, 3000);
}

function startPlayback(src, type) {
    const videoEl = document.getElementById('fullscreen-video');
    const youtubeContainer = document.getElementById('youtube-player-iframe-fs');
    const dvrControls = document.getElementById('dvr-controls');
    
    if (hls) { 
        hls.destroy(); 
        hls = null; 
    }
    videoEl.src = '';
    youtubeContainer.innerHTML = '';
    
    const finalMuteState = isMuted;
    
    if (type === 'hls') {
        videoEl.style.display = 'block';
        youtubeContainer.style.display = 'none';
        if (dvrControls) dvrControls.classList.add('visible');
        
        videoEl.muted = finalMuteState;
        videoEl.volume = 1.0;
        
        if (Hls.isSupported()) {
            hls = new Hls({
                debug: false,
                enableWorker: true,
                lowLatencyMode: false,
                backBufferLength: 90,
                maxBufferLength: 30,
                maxMaxBufferLength: 600
            });
            
            hls.loadSource(src);
            hls.attachMedia(videoEl);
            
            hls.on(Hls.Events.MANIFEST_PARSED, () => {
                if (startProgress && startProgress > 0) {
                    videoEl.currentTime = startProgress;
                }
                videoEl.play().catch(e => {
                    console.warn("Autoplay prevented:", e);
                    videoEl.muted = true;
                    videoEl.play().catch(err => console.warn("Still prevented:", err));
                });
                updateDVRButtonStates();
            });
            
            hls.on(Hls.Events.ERROR, (event, data) => {
                console.error('HLS Error:', data);
                if (data.fatal) {
                    switch (data.type) {
                        case Hls.ErrorTypes.NETWORK_ERROR:
                            console.log('Network error, recovering...');
                            hls.startLoad();
                            break;
                        case Hls.ErrorTypes.MEDIA_ERROR:
                            console.log('Media error, recovering...');
                            hls.recoverMediaError();
                            break;
                        default:
                            console.error('Fatal HLS error');
                            showError("Playback Error", "Stream failed to load");
                            break;
                    }
                }
            });
        } else if (videoEl.canPlayType('application/vnd.apple.mpegurl')) {
            videoEl.src = src;
            videoEl.addEventListener('loadedmetadata', () => {
                if (startProgress && startProgress > 0) {
                    videoEl.currentTime = startProgress;
                }
                videoEl.play().catch(e => {
                    console.warn("Autoplay prevented:", e);
                    videoEl.muted = true;
                    videoEl.play();
                });
                updateDVRButtonStates();
            });
        } else {
            showError("Error", "HLS not supported");
        }
        
        videoEl.addEventListener('play', () => {
            isPaused = false;
            const pauseOverlay = document.getElementById('pause-overlay');
            if (pauseOverlay) pauseOverlay.classList.remove('visible');
            const playPauseBtn = document.getElementById('dvr-play-pause');
            if (playPauseBtn) playPauseBtn.textContent = '||';
        });  
        
        videoEl.addEventListener('pause', () => {
            isPaused = true;
            const pauseOverlay = document.getElementById('pause-overlay');
            if (pauseOverlay) pauseOverlay.classList.add('visible');
            const playPauseBtn = document.getElementById('dvr-play-pause');
            if (playPauseBtn) playPauseBtn.textContent = '▶';
            showOverlays();
        });
        
        videoEl.addEventListener('timeupdate', () => {
            updateDVRButtonStates();
            savePlaybackState();
        });
        
    } else if (type === 'youtube') {
        videoEl.style.display = 'none';
        youtubeContainer.style.display = 'block';
        if (dvrControls) dvrControls.style.display = 'none';
        
        const muteParam = finalMuteState ? '1' : '0';
        youtubeContainer.innerHTML = `
            <iframe 
                src="https://www.youtube.com/embed/${src}?autoplay=1&mute=${muteParam}&controls=1&modestbranding=1&rel=0" 
                frameborder="0" 
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" 
                allowfullscreen 
                style="width: 100%; height: 100%;">
            </iframe>`;
            
    } else if (type === 'twitch') {
        videoEl.style.display = 'none';
        youtubeContainer.style.display = 'block';
        if (dvrControls) dvrControls.style.display = 'none';
        
        const muteParam = finalMuteState ? 'true' : 'false';
        youtubeContainer.innerHTML = `
            <iframe 
                src="https://player.twitch.tv/?channel=${src}&parent=${window.location.hostname}&autoplay=true&muted=${muteParam}" 
                frameborder="0" 
                allow="autoplay; fullscreen; picture-in-picture" 
                allowfullscreen 
                style="width: 100%; height: 100%;">
            </iframe>`;
            
    } else if (type === 'iframe') {
        videoEl.style.display = 'none';
        youtubeContainer.style.display = 'block';
        if (dvrControls) dvrControls.style.display = 'none';
        
        youtubeContainer.innerHTML = `<iframe src="${src}" frameborder="0" allow="autoplay; fullscreen" allowfullscreen style="width: 100%; height: 100%;"></iframe>`;
    } else {
        showError("Error", `Unsupported stream type: ${type}`);
    }
}

function savePlaybackState() {
    if (videoElement && !videoElement.paused && activePlayerData) {
        activePlayerData.progress = videoElement.currentTime;
        
        const jsonStr = JSON.stringify(activePlayerData);
        sessionStorage.setItem('playerData', jsonStr);
        sessionStorage.setItem('persistentMiniplayer', jsonStr);
    }
}

function setupDVRControls() {
    const playPauseBtn = document.getElementById('dvr-play-pause');
    const rewindBtn = document.getElementById('dvr-rewind');
    const forwardBtn = document.getElementById('dvr-forward');
    
    if (playPauseBtn) playPauseBtn.addEventListener('click', togglePlayPause);
    if (rewindBtn) rewindBtn.addEventListener('click', () => seekRelative(-10));
    if (forwardBtn) forwardBtn.addEventListener('click', () => seekRelative(10));
}

function togglePlayPause() {
    if (!videoElement) return;
    if (videoElement.paused) {
        videoElement.play();
    } else {
        videoElement.pause();
    }
}

function seekRelative(seconds) {
    if (!videoElement || !videoElement.duration) {
        playErrorSound();
        return;
    }
    const newTime = videoElement.currentTime + seconds;
    if (newTime < 0 || newTime > videoElement.duration) {
        playErrorSound();
        return;
    }
    videoElement.currentTime = newTime;
    savePlaybackState();
}

function updateDVRButtonStates() {
    if (!videoElement || !videoElement.duration) return;
    
    const rewindBtn = document.getElementById('dvr-rewind');
    const forwardBtn = document.getElementById('dvr-forward');
    
    if (rewindBtn) {
        if (videoElement.currentTime <= 0) {
            rewindBtn.classList.add('disabled');
        } else {
            rewindBtn.classList.remove('disabled');
        }
    }
    
    if (forwardBtn) {
        if (videoElement.currentTime >= videoElement.duration - 1) {
            forwardBtn.classList.add('disabled');
        } else {
            forwardBtn.classList.remove('disabled');
        }
    }
}

function channelSurf(direction) {
    if (allChannels.length === 0) return;
    
    let newIndex = currentChannelIndex + direction;
    
    if (newIndex < 0) newIndex = allChannels.length - 1;
    if (newIndex >= allChannels.length) newIndex = 0;
    
    const newChannel = allChannels[newIndex];
    
    if (newChannel.stream && newChannel.stream.url) {
        let programTitle = newChannel.fullName || newChannel.name;
        let startTimeVal = '';
        let endTimeVal = '';
        
        try {
            const guideCacheStr = sessionStorage.getItem('guideCache');
            if (guideCacheStr) {
                const guideCache = JSON.parse(guideCacheStr);
                const now = new Date();
                const channelProgs = guideCache.programmes.filter(p => p.channel === newChannel.id);
                const liveProgram = channelProgs.find(p => new Date(p.start) <= now && new Date(p.stop) > now);
                
                if (liveProgram) {
                    programTitle = liveProgram.title;
                    startTimeVal = new Date(liveProgram.start).getTime().toString();
                    endTimeVal = new Date(liveProgram.stop).getTime().toString();
                    
                    const programIndex = channelProgs.findIndex(p => p.channel === newChannel.id && new Date(p.start) <= now && new Date(p.stop) > now);
                    
                    sessionStorage.setItem('lastSelectedChannel', newIndex.toString());
                    sessionStorage.setItem('lastSelectedProgram', programIndex >= 0 ? programIndex.toString() : '0');
                }
            }
        } catch (e) {
            console.warn('Guide data unavailable:', e);
        }
        
        const streamInfo = {
            source: 'live',
            type: newChannel.stream.type,
            url: newChannel.stream.url,
            title: programTitle,
            channelId: newChannel.id,
            channelLogo: newChannel.logo || '',
            channelNum: newChannel.number,
            channelName: newChannel.fullName || newChannel.name,
            startTime: startTimeVal,
            endTime: endTimeVal
        };
        
        sessionStorage.setItem('playerData', JSON.stringify(streamInfo));
        sessionStorage.setItem('persistentMiniplayer', JSON.stringify(streamInfo));
        window.location.replace('player.html?noAnimation=true');
    } else {
        playErrorSound();
    }
}

function handleKeyPress(e) {
    const menu = document.getElementById('side-menu');
    
    if (menu && menu.classList.contains('visible')) {
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
    
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    
    const key = e.key.toLowerCase();
    
    if (key === 'g') {
        savePlaybackState();
        const app = document.getElementById('app-container');
        if (app) app.style.animation = 'zoomOut 0.3s ease-in forwards';
        setTimeout(() => {
            window.location.href = 'index.html';
        }, 300);
    } else if (key === 'm') {
        toggleMenu();
    } else if (e.shiftKey && !e.repeat) {
        e.preventDefault();
        toggleMute();
    } else if (key === 'arrowup' && !isOnDemand) {
        e.preventDefault();
        channelSurf(-1);
    } else if (key === 'arrowdown' && !isOnDemand) {
        e.preventDefault();
        channelSurf(1);
    } else if (key === 'o' && isOnDemand) {
        e.preventDefault();
        savePlaybackState();
        const app = document.getElementById('app-container');
        if (app) app.style.animation = 'zoomOut 0.3s ease-in forwards';
        setTimeout(() => {
            window.location.href = 'ondemand.html';
        }, 300);
    } else if (key === 'p') {
        alert('🚀 Portal (Watch Together) coming soon!');
    } else if (key === ' ' || key === 'spacebar') {
        e.preventDefault();
        togglePlayPause();
    } else if (key === 'arrowleft') {
        e.preventDefault();
        seekRelative(-10);
    } else if (key === 'arrowright') {
        e.preventDefault();
        seekRelative(10);
    } else if (key === 'i') {
        e.preventDefault();
        toggleInfoBar();
    }
}

function toggleMute() {
    isMuted = !isMuted;
    sessionStorage.setItem('miniplayerUnmuted', !isMuted ? 'true' : 'false');
    
    if (streamType === 'hls' && videoElement && videoElement.style.display !== 'none') {
        videoElement.muted = isMuted;
        if (!isMuted && videoElement.paused) {
            videoElement.play().catch(err => console.warn('Play failed:', err));
        }
        if (!isMuted) {
            const unmuteMsg = document.getElementById('unmute-message');
            if (unmuteMsg) unmuteMsg.classList.remove('visible');
        }
    } else if (streamType === 'youtube' || streamType === 'twitch') {
        startPlayback(currentSrc, streamType);
        if (!isMuted) {
            const unmuteMsg = document.getElementById('unmute-message');
            if (unmuteMsg) unmuteMsg.classList.remove('visible');
        }
    }
}

function showOverlays() {
    const infoBar = document.getElementById('info-bar');
    const controlBar = document.getElementById('control-bar');
    const dvrControls = document.getElementById('dvr-controls');
    
    if (infoBar) infoBar.classList.add('visible');
    if (controlBar) controlBar.classList.add('visible');
    if (dvrControls && streamType === 'hls' && !isPaused) {
        dvrControls.classList.add('visible');
    }
}

function hideOverlays() {
    if (!isPaused) {
        const infoBar = document.getElementById('info-bar');
        const controlBar = document.getElementById('control-bar');
        const dvrControls = document.getElementById('dvr-controls');
        
        if (infoBar) infoBar.classList.remove('visible');
        if (controlBar) controlBar.classList.remove('visible');
        if (dvrControls && streamType === 'hls') {
            dvrControls.classList.remove('visible');
        }
    }
}

function toggleInfoBar() {
    const infoBar = document.getElementById('info-bar');
    if (infoBar && infoBar.classList.contains('visible')) {
        hideOverlays();
    } else {
        showOverlays();
        if (!isPaused) {
            clearTimeout(infoBarTimeout);
            infoBarTimeout = setTimeout(hideOverlays, 5000);
        }
    }
}

function playErrorSound() {
    if (errorSound) {
        errorSound.currentTime = 0;
        errorSound.play().catch(e => console.warn("Error sound blocked:", e));
    }
}

function showError(title, message) {
    const infoTitle = document.getElementById('info-title');
    const infoBar = document.getElementById('info-bar');
    
    if (infoTitle) infoTitle.textContent = title;
    if (infoBar) infoBar.classList.add('visible');
    
    alert(`${title}: ${message}`);
}

function toggleMenu() {
    const appContainer = document.getElementById('app-container');
    const menuOverlay = document.getElementById('menu-overlay');
    const sideMenu = document.getElementById('side-menu');
    const isOpening = sideMenu && !sideMenu.classList.contains('visible');
    
    if (appContainer) appContainer.classList.toggle('blurred');
    if (menuOverlay) menuOverlay.classList.toggle('visible');
    if (sideMenu) sideMenu.classList.toggle('visible');
    
    if (isOpening && sideMenu) {
        setTimeout(() => {
            const firstMenuItem = sideMenu.querySelector('.menu-button');
            if (firstMenuItem) firstMenuItem.focus();
        }, 100);
    }
}

window.addEventListener('beforeunload', () => {
    if (hls) {
        hls.destroy();
    }
});
