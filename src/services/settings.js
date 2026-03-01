import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SETTINGS_FILE = join(__dirname, '../../guild-settings.json');

// ── In-memory store ──────────────────────────────────────────────────
let guildSettings = {};

// ── Settings Schema ──────────────────────────────────────────────────

/**
 * Schema defining all configurable per-guild settings.
 * Each entry specifies type, default value, validation constraints, and i18n description key.
 */
export const SETTINGS_SCHEMA = {
    default_volume: {
        type: 'integer',
        default: 50,
        min: 1,
        max: 100,
        description: 'settings.default_volume.description',
    },
    max_queue_size: {
        type: 'integer',
        default: 100,
        min: 10,
        max: 500,
        description: 'settings.max_queue_size.description',
    },
    inactivity_timeout: {
        type: 'integer',
        default: 180,
        min: 30,
        max: 600,
        description: 'settings.inactivity_timeout.description',
    },
    max_song_duration: {
        type: 'integer',
        default: 0,
        min: 0,
        max: 3600,
        description: 'settings.max_song_duration.description',
    },
    vote_skip_threshold: {
        type: 'integer',
        default: 50,
        min: 1,
        max: 100,
        description: 'settings.vote_skip_threshold.description',
    },
    dj_role: {
        type: 'role',
        default: null,
        description: 'settings.dj_role.description',
    },
    restricted_text_channel: {
        type: 'channel',
        default: null,
        description: 'settings.restricted_text_channel.description',
    },
    restricted_voice_channel: {
        type: 'channel',
        default: null,
        description: 'settings.restricted_voice_channel.description',
    },
    embed_color: {
        type: 'color',
        default: '#8b5cf6',
        description: 'settings.embed_color.description',
    },
};

// ── Validation ───────────────────────────────────────────────────────

const SNOWFLAKE_RE = /^\d{17,20}$/;
const HEX_COLOR_RE = /^#[0-9A-Fa-f]{6}$/;

/**
 * Validate a value against its schema definition.
 * @param {string} key - Setting key
 * @param {*} value - Value to validate
 * @returns {{ valid: boolean, error?: string }}
 */
function validate(key, value) {
    const schema = SETTINGS_SCHEMA[key];
    if (!schema) return { valid: false, error: `Unknown setting: ${key}` };

    // null is allowed for nullable types (role, channel, color)
    if (value === null) {
        if (schema.type === 'role' || schema.type === 'channel' || schema.type === 'color') {
            return { valid: true };
        }
        return { valid: false, error: `Setting '${key}' cannot be null.` };
    }

    switch (schema.type) {
        case 'integer':
            if (!Number.isInteger(value)) {
                return { valid: false, error: `Setting '${key}' must be an integer.` };
            }
            if (value < schema.min || value > schema.max) {
                return { valid: false, error: `Setting '${key}' must be between ${schema.min} and ${schema.max}.` };
            }
            return { valid: true };

        case 'role':
            if (typeof value !== 'string' || !SNOWFLAKE_RE.test(value)) {
                return { valid: false, error: `Setting '${key}' must be a valid role ID.` };
            }
            return { valid: true };

        case 'channel':
            if (typeof value !== 'string' || !SNOWFLAKE_RE.test(value)) {
                return { valid: false, error: `Setting '${key}' must be a valid channel ID.` };
            }
            return { valid: true };

        case 'color':
            if (typeof value !== 'string' || !HEX_COLOR_RE.test(value)) {
                return { valid: false, error: `Setting '${key}' must be a hex color (e.g. #8b5cf6).` };
            }
            return { valid: true };

        default:
            return { valid: false, error: `Unknown type for setting '${key}'.` };
    }
}

// ── Persistence ──────────────────────────────────────────────────────

/**
 * Load guild settings from disk into memory.
 * Safe to call multiple times (idempotent).
 */
export function loadSettings() {
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
 * Save guild settings from memory to disk.
 * Uses synchronous write to avoid partial writes (single-threaded safety).
 */
export function saveSettings() {
    try {
        writeFileSync(SETTINGS_FILE, JSON.stringify(guildSettings, null, 2), 'utf-8');
    } catch (err) {
        console.error('Failed to save guild settings:', err.message);
    }
}

// ── CRUD API ─────────────────────────────────────────────────────────

/**
 * Get a single setting value for a guild. Returns the default if not explicitly set.
 * @param {string} guildId
 * @param {string} key - Setting key from SETTINGS_SCHEMA
 * @returns {*} The setting value or its default
 */
export function getSetting(guildId, key) {
    const schema = SETTINGS_SCHEMA[key];
    if (!schema) throw new Error(`Unknown setting: ${key}`);
    const guildData = guildSettings[guildId];
    if (guildData && key in guildData) {
        return guildData[key];
    }
    return schema.default;
}

/**
 * Set a setting value for a guild. Validates and persists.
 * @param {string} guildId
 * @param {string} key - Setting key from SETTINGS_SCHEMA
 * @param {*} value - New value (must pass validation)
 * @throws {Error} If validation fails
 */
export function setSetting(guildId, key, value) {
    const result = validate(key, value);
    if (!result.valid) throw new Error(result.error);

    if (!guildSettings[guildId]) guildSettings[guildId] = {};
    guildSettings[guildId][key] = value;
    saveSettings();
}

/**
 * Reset a single setting to its default for a guild.
 * @param {string} guildId
 * @param {string} key - Setting key from SETTINGS_SCHEMA
 */
export function resetSetting(guildId, key) {
    if (!SETTINGS_SCHEMA[key]) throw new Error(`Unknown setting: ${key}`);
    if (guildSettings[guildId]) {
        delete guildSettings[guildId][key];
        saveSettings();
    }
}

/**
 * Reset ALL settings to defaults for a guild (preserves locale).
 * @param {string} guildId
 */
export function resetAllSettings(guildId) {
    if (guildSettings[guildId]) {
        const locale = guildSettings[guildId].locale;
        guildSettings[guildId] = {};
        if (locale) guildSettings[guildId].locale = locale;
        saveSettings();
    }
}

/**
 * Get all settings for a guild, merged with defaults.
 * @param {string} guildId
 * @returns {Record<string, *>} All settings with current or default values
 */
export function getGuildSettings(guildId) {
    const result = {};
    for (const [key, schema] of Object.entries(SETTINGS_SCHEMA)) {
        const guildData = guildSettings[guildId];
        result[key] = (guildData && key in guildData) ? guildData[key] : schema.default;
    }
    return result;
}

// ── Raw access (used by i18n module for locale) ──────────────────────

/**
 * Get raw guild settings object (used by i18n for direct locale access).
 * @param {string} guildId
 * @returns {object|undefined}
 */
export function getRawGuildSettings(guildId) {
    return guildSettings[guildId];
}

/**
 * Set a raw key/value on guild settings (used by i18n for locale writes).
 * Bypasses schema validation (locale is not in SETTINGS_SCHEMA).
 * @param {string} guildId
 * @param {string} key
 * @param {*} value
 */
export function setRawGuildSetting(guildId, key, value) {
    if (!guildSettings[guildId]) guildSettings[guildId] = {};
    guildSettings[guildId][key] = value;
    saveSettings();
}
