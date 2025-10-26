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
    document.addEventListener('keydown', (e) => {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

        if (e.key.toLowerCase() === 'm') {
            toggleMenu();
        }
    });

    const menuOverlay = document.getElementById('menu-overlay');
    if(menuOverlay) {
        menuOverlay.addEventListener('click', toggleMenu);
    }

     initializeMenuWidgets();
});

function toggleMenu() {
    console.log("Toggling menu on ondemand page...");
    const appContainer = document.getElementById('app-container');
    const menuOverlay = document.getElementById('menu-overlay');
    const sideMenu = document.getElementById('side-menu');
    if (appContainer) appContainer.classList.toggle('blurred');
    if (menuOverlay) menuOverlay.classList.toggle('visible');
    if (sideMenu) sideMenu.classList.toggle('visible');
}

async function initializeMenuWidgets() {
    console.log("Initializing menu widgets on ondemand page");
    const widgetContainer = document.querySelector('#side-menu #widget-slideshow-container');
    if (!widgetContainer) return;

    let localConfig = {};
    try {
        localConfig = window.iCableConfig.get();
    } catch(e) {
        console.error("Could not load config for menu widgets on ondemand page:", e);
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
             fetchHourlyForecastOnDemand(pos.coords, localConfig.appearance.weatherApiKey);
         }, err => {
             console.error("Geolocation error:", err.message);
              const container = document.querySelector('#side-menu #hourly-forecast-widget .forecast-items');
              if(container) container.innerHTML = '<p style="font-size: 0.8em; text-align: center;">Location needed for forecast.</p>';
         });
    }

     if (slides.length > 1) {
         const intervalId = setInterval(() => {
             currentSlide = (currentSlide + 1) % slides.length;
             showSlide(currentSlide);
         }, 10000);
     }

     showSlide(0);
}

async function fetchHourlyForecastOnDemand(coords, apiKey) {
    const container = document.querySelector('#side-menu #hourly-forecast-widget .forecast-items');
     if (!container || !coords || !apiKey || apiKey === 'YOUR_API_KEY_HERE') {
         if(container) container.innerHTML = '<p style="font-size: 0.8em; text-align: center;">Forecast unavailable (config error).</p>';
         return;
     }

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
          console.error("Hourly forecast error on ondemand page:", err.message);
          container.innerHTML = `<p style="font-size: 0.8em; text-align: center;">${err.message}</p>`;
     }
}
