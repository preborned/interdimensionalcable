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

(function() {
    'use strict';
    
    window.MenuWidgets = {
        config: null,
        userCoords: null,
        guideData: null,
        slideInterval: null,
        
        async init(configData, coords = null, guide = null) {
            this.config = configData;
            this.userCoords = coords;
            this.guideData = guide;
        
        if (!this.guideData) {
            try {
                const cachedGuide = sessionStorage.getItem('guideCache');
                if (cachedGuide) {
                    const parsed = JSON.parse(cachedGuide);
                    parsed.programmes = parsed.programmes.map(p => ({
                        ...p,
                        start: new Date(p.start),
                        stop: new Date(p.stop)
                    }));
                    this.guideData = parsed;
                }
            } catch (e) {
                console.warn('Could not load cached guide data:', e);
            }
        }
        
        await this.setupWidgets();
    },
    
    async setupWidgets() {
        const widgetContainer = document.querySelector('#side-menu #widget-slideshow-container');
        if (!widgetContainer) return;

        const allSlides = Array.from(widgetContainer.querySelectorAll('.widget-slide'));
        const slides = allSlides.filter(slide => {
            if (slide.id === 'hourly-forecast-widget' && (!this.config.appearance?.enableWeather || !this.userCoords)) {
                slide.style.display = 'none';
                return false;
            }
            if (slide.id === 'recommendation-widget' && !this.guideData) {
                slide.style.display = 'none';
                return false;
            }
            slide.style.display = 'flex';
            return true;
        });

        if (slides.length === 0) {
            widgetContainer.style.display = 'none';
            return;
        }

        widgetContainer.style.display = 'block';
        let currentSlide = 0;

        const showSlide = (index) => {
            slides.forEach((slide, i) => {
                slide.classList.toggle('active', i === index);
            });

            if (slides[index].id === 'hourly-forecast-widget') {
                this.updateWeatherWidget();
            } else if (slides[index].id === 'recommendation-widget') {
                this.updateRecommendationWidget();
            } else if (slides[index].id === 'custom-message-widget') {
                this.updateMessageWidget();
            }
        };

        if (this.config.appearance?.enableWeather && this.userCoords) {
            this.updateWeatherWidget();
        }
        if (this.guideData) {
            this.updateRecommendationWidget();
        }
        this.updateMessageWidget();

        if (slides.length > 1) {
            setInterval(() => {
                currentSlide = (currentSlide + 1) % slides.length;
                showSlide(currentSlide);
            }, 10000);
        }

        showSlide(0);
    },
    
    async updateWeatherWidget() {
        const container = document.querySelector('#side-menu #hourly-forecast-widget .forecast-items');
        if (!container || !this.userCoords || !this.config.appearance?.weatherApiKey) return;

        const { latitude, longitude } = this.userCoords;
        const url = `https://api.openweathermap.org/data/2.5/forecast?lat=${latitude}&lon=${longitude}&appid=${this.config.appearance.weatherApiKey}&units=imperial&cnt=4`;

        try {
            const res = await fetch(url);
            if (!res.ok) throw new Error(`HTTP error! Status: ${res.status}`);
            const data = await res.json();

            container.innerHTML = '';
            data.list.slice(0, 4).forEach(item => {
                const date = new Date(item.dt * 1000);
                const icon = item.weather[0].icon;

                container.innerHTML += `
                    <div class="forecast-item">
                        <div>${date.toLocaleTimeString([], {hour: 'numeric'})}</div>
                        <img src="https://openweathermap.org/img/wn/${icon}@2x.png" alt="${item.weather[0].description}">
                        <div>${Math.round(item.main.temp)}°F</div>
                        <div>${item.weather[0].main}</div>
                    </div>`;
            });
        } catch (err) {
            console.error("Weather widget error:", err.message);
            container.innerHTML = '<p style="font-size: 0.8em; text-align: center; padding: 2rem;">Forecast unavailable.</p>';
        }
    },
    
    updateRecommendationWidget() {
        const container = document.querySelector('#side-menu #recommendation-widget .rec-content');
        if (!container || !this.guideData || !this.guideData.channels) return;

        const now = new Date();
        const upcoming = [];

        if (this.guideData.programmes) {
            this.guideData.channels.forEach(channel => {
                const channelProgs = this.guideData.programmes.filter(p => p.channel === channel.id);
                const nextProg = channelProgs.find(p => p.start > now);
                if (nextProg) {
                    upcoming.push({ program: nextProg, channel });
                }
            });
        }

        if (upcoming.length > 0) {
            const randomRec = upcoming[Math.floor(Math.random() * upcoming.length)];

            this.getPosterUrl(randomRec.program.title).then(posterUrl => {
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
    },
    
    updateMessageWidget() {
        const container = document.querySelector('#side-menu #custom-message-widget .widget-content');
        if (!container) return;

        const messages = this.config.appearance?.customMessages || ['Welcome to iCable!'];
        const randomMessage = messages[Math.floor(Math.random() * messages.length)];

        container.innerHTML = `
            <div style="text-align: center; padding: 2rem; font-size: 1.1em; line-height: 1.6;">
                ${randomMessage}
            </div>
        `;
    },
    
    async getPosterUrl(title) {
        if (!title || !this.config.appearance?.tmdbApiKey || this.config.appearance.tmdbApiKey === 'YOUR_API_KEY_HERE') {
            return `https://placehold.co/400x600/0c1428/FFFFFF?text=${encodeURIComponent(title || 'N/A')}`;
        }
        
        try {
            let url = `https://api.themoviedb.org/3/search/tv?api_key=${this.config.appearance.tmdbApiKey}&query=${encodeURIComponent(title)}`;
            let res = await fetch(url);
            if (!res.ok) throw new Error(`TMDb TV search failed: ${res.status}`);
            let data = await res.json();
            let firstResult = data.results?.[0];

            if (!firstResult) {
                url = `https://api.themoviedb.org/3/search/movie?api_key=${this.config.appearance.tmdbApiKey}&query=${encodeURIComponent(title)}`;
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
};

if (navigator.geolocation && window.MenuWidgets) {
    navigator.geolocation.getCurrentPosition(
        (pos) => {
            if (window.MenuWidgets.config && window.MenuWidgets.config.appearance?.enableWeather) {
                window.MenuWidgets.userCoords = pos.coords;
                window.MenuWidgets.updateWeatherWidget();
            }
        },
        (err) => console.warn('Geolocation error:', err.message)
    );
}

})();
