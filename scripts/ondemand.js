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
