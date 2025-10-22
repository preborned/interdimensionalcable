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

document.addEventListener('DOMContentLoaded', () => {
    const params = new URLSearchParams(window.location.search);
    const src = params.get('src');
    const type = params.get('type');
    const title = params.get('title');
    const desc = params.get('desc');
    const channelId = params.get('channelId');

    const videoElement = document.getElementById('fullscreen-video');
    const youtubeContainer = document.getElementById('youtube-player-iframe-fs');

    if (title) {
        const infoBar = document.getElementById('info-bar');
        document.getElementById('info-title').textContent = title;
        document.getElementById('info-desc').textContent = desc;
        infoBar.classList.add('visible');
        setTimeout(() => {
            infoBar.classList.remove('visible');
        }, 7000);
    }

    if (type === 'hls') {
        if (Hls.isSupported()) {
            const hls = new Hls();
            hls.loadSource(src);
            hls.attachMedia(videoElement);
            hls.on(Hls.Events.MANIFEST_PARSED, () => videoElement.play());
        } else if (videoElement.canPlayType('application/vnd.apple.mpegurl')) {
            videoElement.src = src;
            videoElement.addEventListener('loadedmetadata', () => videoElement.play());
        }
    } else if (type === 'youtube') {
        videoElement.style.display = 'none';
        youtubeContainer.innerHTML = `<iframe src="https://www.youtube.com/embed/${src}?autoplay=1&controls=0&modestbranding=1" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>`;
    }

    document.addEventListener('keydown', (e) => {
        if (e.key.toLowerCase() === 'g') {
            // Store current channel info to resume in mini-player
            sessionStorage.setItem('returnFromPlayerChannelId', channelId);
            window.location.href = 'index.html';
        }
        if (e.key.toLowerCase() === 'm') {
            toggleMenu();
        }
    });

    const menuOverlay = document.getElementById('menu-overlay');
    if(menuOverlay) {
        menuOverlay.addEventListener('click', toggleMenu);
    }
});

function toggleMenu() {
    const appContainer = document.getElementById('app-container');
    const menuOverlay = document.getElementById('menu-overlay');
    const sideMenu = document.getElementById('side-menu');
    if (appContainer) appContainer.classList.toggle('blurred');
    if (menuOverlay) menuOverlay.classList.toggle('visible');
    if (sideMenu) sideMenu.classList.toggle('visible');
}
