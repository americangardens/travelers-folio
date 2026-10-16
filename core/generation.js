/**
 * Отдельная модель для генерации слухов.
 *
 * ГЛАВНОЕ ПРО КЛЮЧИ: расширение НИКОГДА не хранит ключи.
 * Оно хранит только строку — имя профиля из штатного Connection Manager.
 * Профиль ссылается на ключ через `secret-id`, а сами ключи лежат
 * в secrets.json на сервере SillyTavern и в браузер не попадают.
 *
 * Если профиль не выбран — генерация идёт через текущую модель чата.
 */

// core/generation.js → public/scripts/extensions/third-party/travelers-folio/core/
//   ../../../../../ = public/   (core + travelers-folio + third-party + extensions + scripts + public)
import { executeSlashCommands } from '../../../../slash-commands.js';
import { generateQuietPrompt } from '../../../../../script.js';
import { extension_settings } from '../../../../extensions.js';
import { getSettings, saveSettings } from './state.js';

/** Поля профиля, применяемые на время тихой генерации. */
const APPLY_FIELDS = [
    { field: 'api', command: 'api' },
    { field: 'api_url', command: 'api-url' },
    { field: 'model', command: 'model' },
    { field: 'preset', command: 'preset' },
];

/**
 * Профили Connection Manager для выпадающего списка.
 * @returns {Array<{name:string, model:string}>}
 */
export function listProfiles() {
    try {
        const mgr = extension_settings.connectionManager;
        if (!mgr || !Array.isArray(mgr.profiles)) return [];
        return mgr.profiles
            .map(p => ({ name: p.name || '', model: p.model || '' }))
            .filter(p => p.name);
    } catch (e) {
        return [];
    }
}

function findProfile(name) {
    const mgr = extension_settings.connectionManager;
    if (!mgr || !Array.isArray(mgr.profiles)) return null;
    return mgr.profiles.find(p => p.name === name) || null;
}

function snapshot() {
    const s = extension_settings;
    return {
        api: s.api,
        api_url: s.api_url,
        main_api: s.main_api,
        chat_completion_source: s.chat_completion_source,
        custom_model: s.custom_model,
        preset: s.presets?.current,
    };
}

async function restore(snap) {
    const s = extension_settings;
    s.api = snap.api;
    s.api_url = snap.api_url;
    s.main_api = snap.main_api;
    s.chat_completion_source = snap.chat_completion_source;
    s.custom_model = snap.custom_model;
    if (snap.preset !== undefined && s.presets) s.presets.current = snap.preset;
    saveSettings();
}

async function applyProfile(profile) {
    for (const { field, command } of APPLY_FIELDS) {
        const value = profile[field];
        if (value === undefined || value === null || value === '') continue;
        try {
            await executeSlashCommands(`/${command} ${value}`, false, null, false);
        } catch (e) {
            console.warn(`[Folio] не удалось применить ${command}`, e);
        }
    }
}

/**
 * Тих��я генерация. Если выбран профиль — подменяет настройки
 * на время запроса и возвращает их обратно, даже при ошибке.
 *
 * @param {string} prompt
 * @param {object} [opts] остальные параметры generateQuietPrompt
 * @returns {Promise<string>}
 */
export async function generateWithProfile(prompt, opts = {}) {
    const s = getSettings();
    const profile = s.generationProfile ? findProfile(s.generationProfile) : null;

    if (!profile) {
        return generateQuietPrompt({ quietPrompt: prompt, ...opts });
    }

    const snap = snapshot();
    try {
        await applyProfile(profile);
        return await generateQuietPrompt({ quietPrompt: prompt, ...opts });
    } finally {
        await restore(snap);
    }
}

/** Данные для панели настроек. */
export function profileInfo() {
    const s = getSettings();
    const profiles = listProfiles();
    const selected = s.generationProfile || '';
    return {
        selected,
        profiles,
        selectedExists: !selected || !!findProfile(selected),
        connectionManagerPresent: profiles.length > 0,
    };
}