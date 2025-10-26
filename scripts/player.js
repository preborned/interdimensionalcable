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

document.addEventListener('DOMContentLoaded', async () => {
    const params = new URLSearchParams(window.location.search);
    const src = params.get('src');
    streamType = params.get('type');
    const title = params.get('title') || 'Unknown Program';
    const channelId = params.get('channelId');
    const channelLogo = params.get('channelLogo');
    const channelNum = params.get('channelNum');
    const channelName = params.get('channelName');
    const startTime = params.get('startTime');
    const endTime = params.get('endTime');
    
    videoElement = document.getElementById('fullscreen-video');
    errorSound = document.getElementById('error-sound');
    
    if (startTime && endTime) {
        programStartTime = new Date(parseInt(startTime));
        programEndTime = new Date(parseInt(endTime));
        
        const startStr = programStartTime.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
        const endStr = programEndTime.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
        document.getElementById('info-timeslot').textContent = `${startStr} - ${endStr}`;
    }
    
    const config = window.iCableConfig.get();
    allChannels = [...(config.channels || []), ...(config.customChannels || [])];
    allChannels.sort((a, b) => parseInt(a.number) - parseInt(b.number));
    currentChannelIndex = allChannels.findIndex(ch => ch.id === channelId);
    
    if (config.appearance?.systemLogoId) {
        const logoData = await window.iCableConfig.getImage(config.appearance.systemLogoId);
        if (logoData) {
            document.getElementById('info-system-logo').src = logoData.data;
        }
    }
    
    document.getElementById('info-title').textContent = title;
    document.getElementById('info-channel-logo').src = channelLogo || 'https://placehold.co/100x100/4d648d/FFFFFF?text=' + channelNum;
    document.getElementById('info-channel-num').textContent = channelNum || '000';
    document.getElementById('info-channel-name').textContent = channelName || 'Channel';
    
    document.getElementById('info-hd').style.display = 'inline-block';
    
    updateClock();
    setInterval(updateClock, 10000);
    
    if (config.appearance?.enableWeather) {
        navigator.geolocation.getCurrentPosition(pos => {
            fetchWeather(pos.coords, config.appearance.weatherApiKey);
        }, () => {});
    }
    
    startPlayback(src, streamType);
    
    document.getElementById('unmute-message').classList.add('visible');
    setTimeout(() => {
        document.getElementById('unmute-message').classList.remove('visible');
    }, 5000);
    
    setTimeout(() => {
        if (!isPaused) hideOverlays();
    }, 5000);
    
    let mouseMoveTimeout;
    document.addEventListener('mousemove', () => {
        if (!isPaused) {
            showOverlays();
            clearTimeout(mouseMoveTimeout);
            mouseMoveTimeout = setTimeout(hideOverlays, 3000);
        }
    });
    
    document.addEventListener('keydown', handleKeyPress);
    
    setupDVRControls();
    
    const menuOverlay = document.getElementById('menu-overlay');
    if (menuOverlay) {
        menuOverlay.addEventListener('click', toggleMenu);
    }
    
    initializeMenuWidgets();
});

function startPlayback(src, type) {
    const videoEl = document.getElementById('fullscreen-video');
    const youtubeContainer = document.getElementById('youtube-player-iframe-fs');
    const dvrControls = document.getElementById('dvr-controls');
    
    if (hls) { hls.destroy(); hls = null; }
    videoEl.src = '';
    youtubeContainer.innerHTML = '';
    
    if (type === 'hls') {
        videoEl.style.display = 'block';
        youtubeContainer.style.display = 'none';
        dvrControls.classList.add('visible');
        
        if (Hls.isSupported()) {
            hls = new Hls();
            hls.loadSource(src);
            hls.attachMedia(videoEl);
            hls.on(Hls.Events.MANIFEST_PARSED, () => {
                videoEl.play().catch(e => console.warn("Autoplay prevented:", e));
                updateDVRButtonStates();
            });
            hls.on(Hls.Events.ERROR, (event, data) => {
                console.error('HLS Error:', data);
                if (data.fatal) {
                    showError("Playback Error", "Could not load this stream.");
                }
            });
        } else if (videoEl.canPlayType('application/vnd.apple.mpegurl')) {
            videoEl.src = src;
            videoEl.addEventListener('loadedmetadata', () => {
                videoEl.play().catch(e => console.warn("Autoplay prevented:", e));
                updateDVRButtonStates();
            });
        } else {
            showError("Compatibility Error", "HLS not supported");
        }
        
        videoEl.addEventListener('play', () => {
            isPaused = false;
            document.getElementById('pause-overlay').classList.remove('visible');
            document.getElementById('dvr-play-pause').textContent = '⏸';
        });
        videoEl.addEventListener('pause', () => {
            isPaused = true;
            document.getElementById('pause-overlay').classList.add('visible');
            document.getElementById('dvr-play-pause').textContent = '▶';
            showOverlays();
        });
        videoEl.addEventListener('timeupdate', updateDVRButtonStates);
        
    } else if (type === 'youtube') {
        videoEl.style.display = 'none';
        youtubeContainer.style.display = 'block';
        dvrControls.style.display = 'none';
        
        youtubeContainer.innerHTML = `<iframe 
            src="https://www.youtube.com/embed/${src}?autoplay=1&mute=1&controls=0&disablekb=1&fs=0&modestbranding=1&rel=0&showinfo=0&iv_load_policy=3" 
            frameborder="0" 
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope" 
            style="pointer-events: none;"
            allowfullscreen></iframe>`;
            
    } else if (type === 'twitch') {
        videoEl.style.display = 'none';
        youtubeContainer.style.display = 'block';
        dvrControls.style.display = 'none';
        
        youtubeContainer.innerHTML = `<iframe 
            src="https://player.twitch.tv/?channel=${src}&parent=${window.location.hostname}&autoplay=true&muted=true" 
            frameborder="0" 
            allow="autoplay; fullscreen" 
            allowfullscreen></iframe>`;
            
    } else if (type === 'iframe') {
        videoEl.style.display = 'none';
        youtubeContainer.style.display = 'block';
        dvrControls.style.display = 'none';
        
        youtubeContainer.innerHTML = `<iframe 
            src="${src}" 
            frameborder="0" 
            allow="autoplay; fullscreen" 
            allowfullscreen></iframe>`;
    } else {
        showError("Unsupported Stream", `Cannot play type: ${type}`);
    }
}

function setupDVRControls() {
    const playPauseBtn = document.getElementById('dvr-play-pause');
    const rewindBtn = document.getElementById('dvr-rewind');
    const forwardBtn = document.getElementById('dvr-forward');
    
    playPauseBtn.addEventListener('click', togglePlayPause);
    rewindBtn.addEventListener('click', () => seekRelative(-10));
    forwardBtn.addEventListener('click', () => seekRelative(10));
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
}

function updateDVRButtonStates() {
    if (!videoElement || !videoElement.duration) return;
    
    const rewindBtn = document.getElementById('dvr-rewind');
    const forwardBtn = document.getElementById('dvr-forward');
    
    if (videoElement.currentTime <= 0) {
        rewindBtn.classList.add('disabled');
    } else {
        rewindBtn.classList.remove('disabled');
    }
    
    if (videoElement.currentTime >= videoElement.duration - 1) {
        forwardBtn.classList.add('disabled');
    } else {
        forwardBtn.classList.remove('disabled');
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
        let startTime = '';
        let endTime = '';
        
        try {
            const guideCacheStr = sessionStorage.getItem('guideCache');
            if (guideCacheStr) {
                const guideCache = JSON.parse(guideCacheStr);
                const now = new Date();
                const channelProgs = guideCache.programmes.filter(p => p.channel === newChannel.id);
                const liveProgram = channelProgs.find(p => new Date(p.start) <= now && new Date(p.stop) > now);
                
                if (liveProgram) {
                    programTitle = liveProgram.title;
                    startTime = new Date(liveProgram.start).getTime().toString();
                    endTime = new Date(liveProgram.stop).getTime().toString();
                }
            }
        } catch (e) {
            console.warn('Could not load guide data for surfing:', e);
        }
        
        const params = new URLSearchParams({
            src: newChannel.stream.url,
            type: newChannel.stream.type,
            channelId: newChannel.id,
            channelLogo: newChannel.logo || '',
            channelNum: newChannel.number,
            channelName: newChannel.fullName || newChannel.name,
            title: programTitle,
            startTime,
            endTime
        });
        window.location.replace(`player.html?${params.toString()}`);
    } else {
        playErrorSound();
    }
}

function handleKeyPress(e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    
    const key = e.key.toLowerCase();
    
    if (key === 'g') {
        const app = document.getElementById('app-container');
        app.style.animation = 'zoomOut 0.3s ease-in forwards';
        setTimeout(() => {
            sessionStorage.setItem('returnFromPlayerChannelId', new URLSearchParams(window.location.search).get('channelId'));
            window.location.href = 'index.html';
        }, 300);
    } else if (key === 'm') {
        toggleMenu();
    } else if (e.shiftKey && !e.repeat) {
        e.preventDefault();
        if (videoElement && videoElement.style.display !== 'none') {
            videoElement.muted = !videoElement.muted;
            isMuted = videoElement.muted;
            
            if (!isMuted && videoElement.paused) {
                videoElement.play().catch(err => console.warn('Play failed:', err));
            }
            
            if (!isMuted) {
                document.getElementById('unmute-message').classList.remove('visible');
            }
            
            console.log('Muted:', isMuted, 'Volume:', videoElement.volume);
        }
    } else if (key === 'arrowup') {
        e.preventDefault();
        channelSurf(-1);
    } else if (key === 'arrowdown') {
        e.preventDefault();
        channelSurf(1);
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

const style = document.createElement('style');
style.textContent = `
    @keyframes zoomOut {
        from {
            opacity: 1;
            transform: scale(1);
        }
        to {
            opacity: 0;
            transform: scale(1.05);
        }
    }
`;
document.head.appendChild(style);'arrowdown'
        e.preventDefault();
        channelSurf(1);
    if (key === 'p') {
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

function showOverlays() {
    document.getElementById('info-bar').classList.add('visible');
    document.getElementById('control-bar').classList.add('visible');
    if (streamType === 'hls' && !isPaused) {
        document.getElementById('dvr-controls').classList.add('visible');
    }
}

function hideOverlays() {
    if (!isPaused) {
        document.getElementById('info-bar').classList.remove('visible');
        document.getElementById('control-bar').classList.remove('visible');
        if (streamType === 'hls') {
            document.getElementById('dvr-controls').classList.remove('visible');
        }
    }
}

function toggleInfoBar() {
    const infoBar = document.getElementById('info-bar');
    if (infoBar.classList.contains('visible')) {
        hideOverlays();
    } else {
        showOverlays();
        if (!isPaused) {
            clearTimeout(infoBarTimeout);
            infoBarTimeout = setTimeout(hideOverlays, 5000);
        }
    }
}

function updateClock() {
    document.getElementById('info-clock').textContent = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

async function fetchWeather(coords, apiKey) {
    if (!apiKey || apiKey === 'YOUR_API_KEY_HERE') return;
    
    const { latitude, longitude } = coords;
    const url = `https://api.openweathermap.org/data/2.5/weather?lat=${latitude}&lon=${longitude}&appid=${apiKey}&units=imperial`;
    
    try {
        const res = await fetch(url);
        if (!res.ok) throw new Error('Weather fetch failed');
        const data = await res.json();
        document.getElementById('info-weather').textContent = `${Math.round(data.main.temp)}°F`;
    } catch (err) {
        console.error('Weather error:', err);
        document.getElementById('info-weather').textContent = '--°F';
    }
}

function playErrorSound() {
    if (errorSound) {
        errorSound.currentTime = 0;
        errorSound.play().catch(e => console.warn("Error sound blocked:", e));
    }
}

function showError(title, message) {
    document.getElementById('info-title').textContent = title;
    document.getElementById('info-bar').classList.add('visible');
    alert(`${title}: ${message}`);
}

function toggleMenu() {
    const appContainer = document.getElementById('app-container');
    const menuOverlay = document.getElementById('menu-overlay');
    const sideMenu = document.getElementById('side-menu');
    if (appContainer) appContainer.classList.toggle('blurred');
    if (menuOverlay) menuOverlay.classList.toggle('visible');
    if (sideMenu) sideMenu.classList.toggle('visible');
}

async function initializeMenuWidgets() {
    const widgetContainer = document.querySelector('#side-menu #widget-slideshow-container');
    if (!widgetContainer) return;

    let localConfig = {};
    try {
        localConfig = window.iCableConfig.get();
    } catch(e) {
        console.error("Could not load config for menu widgets");
        widgetContainer.style.display = 'none';
        return;
    }

    const allSlides = Array.from(widgetContainer.querySelectorAll('.widget-slide'));
    const slides = allSlides.filter(slide => {
        if (slide.id === 'hourly-forecast-widget' && !localConfig.appearance?.enableWeather) {
            slide.style.display = 'none';
            return false;
        }
        if (slide.id === 'recommendation-widget') {
             slide.style.display = 'none';
             return false;
        }
        slide.style.display = 'flex';
        return true;
    });

    if (slides.length === 0) {
        widgetContainer.style.display = 'none';
        return;
    };
    widgetContainer.style.display = 'block';
    let currentSlide = 0;

    function showSlide(index) {
        slides.forEach((slide, i) => {
            slide.classList.toggle('active', i === index);
        });
    }

    if (localConfig.appearance?.enableWeather) {
        navigator.geolocation.getCurrentPosition(pos => {
            fetchHourlyForecastPlayer(pos.coords, localConfig.appearance.weatherApiKey);
        }, err => console.error("Geolocation error:", err.message));
    }

    if (slides.length > 1) {
         const intervalId = setInterval(() => {
             currentSlide = (currentSlide + 1) % slides.length;
             showSlide(currentSlide);
         }, 10000);
     }

     showSlide(0);
}

async function fetchHourlyForecastPlayer(coords, apiKey) {
    const container = document.querySelector('#side-menu #hourly-forecast-widget .forecast-items');
    if (!container || !coords || !apiKey || apiKey === 'YOUR_API_KEY_HERE') return;

    const { latitude, longitude } = coords;
    const url = `https://api.openweathermap.org/data/2.5/forecast?lat=${latitude}&lon=${longitude}&appid=${apiKey}&units=imperial&cnt=4`;
    try {
        const res = await fetch(url);
        if (res.status === 401) throw new Error("Unauthorized(401). Check OpenWeather API key and plan support.");
        if (!res.ok) throw new Error(`HTTP error! Status: ${res.status}`);
        const data = await res.json();

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
         console.error("Hourly forecast error on player page:", err.message);
         container.innerHTML = '<p style="font-size: 0.8em; text-align: center; margin-top: 1rem;">Forecast unavailable.</p>';
    }
}

window.addEventListener('beforeunload', () => {
    if (hls) {
        hls.destroy();
    }
});
