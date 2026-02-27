import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// In-memory store: { localeName: { key: value } }
const locales = {};
const DEFAULT_LOCALE = 'en';

// Guild settings persistence
const SETTINGS_FILE = join(__dirname, '../../guild-settings.json');
let guildSettings = {};

// ---------------------------------------------------------------------------
// Locale loading
// ---------------------------------------------------------------------------

/**
 * Load all locale files from the locales/ directory.
 * Called automatically on import.
 */
function loadLocales() {
    const localesDir = join(__dirname, 'locales');
    const files = readdirSync(localesDir).filter(f => f.endsWith('.json'));
    for (const file of files) {
        const name = file.replace('.json', '');
        const content = readFileSync(join(localesDir, file), 'utf-8');
        locales[name] = JSON.parse(content);
    }
    console.log(`🌐 Loaded locales: ${Object.keys(locales).join(', ')}`);
}
loadLocales();

// ---------------------------------------------------------------------------
// Guild settings persistence
// ---------------------------------------------------------------------------

/**
 * Load guild settings from disk.
 * Called automatically on import; can be called again to reload.
 */
export function loadGuildSettings() {
    try {
        if (existsSync(SETTINGS_FILE)) {
            guildSettings = JSON.parse(readFileSync(SETTINGS_FILE, 'utf-8'));
        }
    } catch {
        console.warn('⚠️ Could not load guild-settings.json, starting fresh.');
        guildSettings = {};
    }
}

/**
 * Save guild settings to disk.
 */
function saveGuildSettings() {
    try {
        writeFileSync(SETTINGS_FILE, JSON.stringify(guildSettings, null, 2), 'utf-8');
    } catch (err) {
        console.error('Failed to save guild settings:', err.message);
    }
}

// Load on import
loadGuildSettings();

// ---------------------------------------------------------------------------
// Translation API
// ---------------------------------------------------------------------------

/**
 * Translate a key for a guild.
 * Fallback chain: guild locale → English → raw key name.
 *
 * @param {string} guildId - The guild ID
 * @param {string} key - The translation key (e.g. "now_playing.title")
 * @param {Record<string, string|number>} [params={}] - Interpolation params
 * @returns {string} The translated string with params interpolated
 */
export function t(guildId, key, params = {}) {
    const locale = getLocale(guildId);
    let text = locales[locale]?.[key] ?? locales[DEFAULT_LOCALE]?.[key] ?? key;

    // Interpolate {placeholder} values
    for (const [param, value] of Object.entries(params)) {
        text = text.replaceAll(`{${param}}`, String(value));
    }
    return text;
}

/**
 * Translate with simple plural selection.
 * Uses key.one for count === 1, key.other for anything else.
 *
 * @param {string} guildId - The guild ID
 * @param {string} baseKey - Key without .one/.other suffix
 * @param {number} count - The count to determine singular/plural
 * @param {Record<string, string|number>} [params={}] - Additional interpolation params
 * @returns {string}
 */
export function tp(guildId, baseKey, count, params = {}) {
    const suffix = count === 1 ? '.one' : '.other';
    return t(guildId, baseKey + suffix, { ...params, count });
}

// ---------------------------------------------------------------------------
// Locale management
// ---------------------------------------------------------------------------

/**
 * Get the locale code for a guild.
 * @param {string} guildId
 * @returns {string} Locale code (e.g. "en", "de")
 */
export function getLocale(guildId) {
    return guildSettings[guildId]?.locale ?? DEFAULT_LOCALE;
}

/**
 * Set the locale for a guild and persist to disk.
 * @param {string} guildId
 * @param {string} locale - Must be a loaded locale code
 * @throws {Error} If the locale is not available
 */
export function setLocale(guildId, locale) {
    if (!locales[locale]) throw new Error(`Unknown locale: ${locale}`);
    if (!guildSettings[guildId]) guildSettings[guildId] = {};
    guildSettings[guildId].locale = locale;
    saveGuildSettings();
}

/**
 * Get list of available locales with their display names.
 * @returns {Array<{ code: string, name: string, flag: string }>}
 */
export function getAvailableLocales() {
    return Object.keys(locales).map(key => ({
        code: key,
        name: locales[key]?.['locale.name'] ?? key,
        flag: locales[key]?.['locale.flag'] ?? '🏳️',
    }));
}
