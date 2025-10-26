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

const CONFIG_VERSION = "1.0.0";
const STORAGE_KEY = "icable_config";
const DB_NAME = "icable_db";
const DB_VERSION = 1;

const DEFAULT_CONFIG = {
    version: CONFIG_VERSION,
    setupComplete: false,
    currentSetupStep: 0,
    
    integrations: {
        xmltvUrl: "",
        jsonUrl: "",
        m3uUrl: "",
        jellyfin: { url: "", apiKey: "", enabled: false },
        plex: { url: "", token: "", enabled: false },
        emby: { url: "", apiKey: "", enabled: false }
    },
    
    channels: [],
    customChannels: [],
    
    appearance: {
        theme: "default-blue",
        colors: {
            primaryBgStart: "#1d2b4b",
            primaryBgEnd: "#0c1428",
            secondaryBg: "#2a3a5e",
            tertiaryBg: "#4d648d",
            accent: "#00aaff",
            text: "#f0f0f0",
            liveBg: "#78909c",
            pastBg: "#263238"
        },
        systemLogoId: null,
        customMessages: [
            "Welcome to iCable!",
            "Press 'M' to open the menu"
        ],
        enableWeather: false,
        weatherApiKey: "",
        tmdbApiKey: ""
    },
    
    player: {
        defaultQuality: "auto",
        autoplay: true,
        volume: 1.0,
        muted: false
    },
    
    guide: {
        viewHours: 2,
        totalHours: 12,
        use12Hour: true
    }
};

let db = null;

function initDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
            db = request.result;
            resolve(db);
        };
        
        request.onupgradeneeded = (e) => {
            const database = e.target.result;
            
            if (!database.objectStoreNames.contains('images')) {
                database.createObjectStore('images', { keyPath: 'id', autoIncrement: true });
            }
        };
    });
}

async function saveImage(file) {
    if (!db) await initDB();
    
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const transaction = db.transaction(['images'], 'readwrite');
            const store = transaction.objectStore('images');
            
            const imageData = {
                data: e.target.result,
                name: file.name,
                type: file.type,
                size: file.size,
                timestamp: Date.now()
            };
            
            const request = store.add(imageData);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        };
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
    });
}

async function getImage(id) {
    if (!db) await initDB();
    if (!id) return null;
    
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(['images'], 'readonly');
        const store = transaction.objectStore('images');
        const request = store.get(id);
        
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function deleteImage(id) {
    if (!db) await initDB();
    
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(['images'], 'readwrite');
        const store = transaction.objectStore('images');
        const request = store.delete(id);
        
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
}

function getConfig() {
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (!stored) return { ...DEFAULT_CONFIG };
        
        let config = JSON.parse(stored);
        
        if (!config.version || config.version !== CONFIG_VERSION) {
            config = migrateConfig(config);
        }
        
        return config;
    } catch (error) {
        console.error("Failed to load config:", error);
        return { ...DEFAULT_CONFIG };
    }
}

function saveConfig(config) {
    try {
        config.version = CONFIG_VERSION;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
        return true;
    } catch (error) {
        console.error("Failed to save config:", error);
        if (error.name === 'QuotaExceededError') {
            alert("Browser storage is full. Please clear some data in Settings > Data.");
        }
        return false;
    }
}

function migrateConfig(oldConfig) {
    console.log(`Migrating config from ${oldConfig.version || 'unknown'} to ${CONFIG_VERSION}`);
    
    const newConfig = { ...DEFAULT_CONFIG };
    
    if (oldConfig.setupComplete) newConfig.setupComplete = oldConfig.setupComplete;
    if (oldConfig.integrations) newConfig.integrations = { ...newConfig.integrations, ...oldConfig.integrations };
    if (oldConfig.channels) newConfig.channels = oldConfig.channels;
    if (oldConfig.customChannels) newConfig.customChannels = oldConfig.customChannels;
    if (oldConfig.appearance) newConfig.appearance = { ...newConfig.appearance, ...oldConfig.appearance };
    
    saveConfig(newConfig);
    
    return newConfig;
}

function exportConfig() {
    const config = getConfig();
    const dataStr = JSON.stringify(config, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `icable-config-${Date.now()}.json`;
    link.click();
    URL.revokeObjectURL(url);
}

async function importConfig(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const imported = JSON.parse(e.target.result);
                
                if (typeof imported !== 'object') {
                    throw new Error("Invalid config file");
                }
                
                const migrated = migrateConfig(imported);
                saveConfig(migrated);
                
                resolve(migrated);
            } catch (error) {
                reject(error);
            }
        };
        reader.onerror = () => reject(reader.error);
        reader.readAsText(file);
    });
}

function resetConfig() {
    if (confirm("Are you sure you want to reset all settings? This cannot be undone.")) {
        localStorage.removeItem(STORAGE_KEY);
        
        if (db) {
            const transaction = db.transaction(['images'], 'readwrite');
            const store = transaction.objectStore('images');
            store.clear();
        }
        
        window.location.href = 'setup.html';
    }
}

function applyTheme(colors) {
    const root = document.documentElement;
    root.style.setProperty('--primary-bg-start', colors.primaryBgStart);
    root.style.setProperty('--primary-bg-end', colors.primaryBgEnd);
    root.style.setProperty('--secondary-bg', colors.secondaryBg);
    root.style.setProperty('--tertiary-bg', colors.tertiaryBg);
    root.style.setProperty('--accent-color', colors.accent);
    root.style.setProperty('--text-color', colors.text);
    root.style.setProperty('--live-bg', colors.liveBg);
    root.style.setProperty('--past-bg', colors.pastBg);
}

document.addEventListener('DOMContentLoaded', async () => {
    await initDB();
    
    const config = getConfig();
    
    if (!config.setupComplete && !window.location.pathname.includes('setup.html')) {
        window.location.href = 'setup.html';
    }
    
    if (config.appearance?.colors) {
        applyTheme(config.appearance.colors);
    }
});

window.iCableConfig = {
    get: getConfig,
    save: saveConfig,
    export: exportConfig,
    import: importConfig,
    reset: resetConfig,
    applyTheme: applyTheme,
    saveImage: saveImage,
    getImage: getImage,
    deleteImage: deleteImage,
    DEFAULT: DEFAULT_CONFIG
};
