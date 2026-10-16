/**
 * Хранилище данных «Дорожной канцелярии».
 *
 * Состояние живёт в metadata конкретного чата: у каждой ролевой своя газета,
 * своя доска объявлений и свой кошель. Настройки поведения — глобально.
 *
 * ВАЖНО: расширение не хранит API-ключи. Только имя профиля.
 */

// core/state.js → public/scripts/extensions/third-party/travelers-folio/core/
//   ../../../../../ = public/   (core + travelers-folio + third-party + extensions + scripts + public)
import { chat_metadata, saveSettingsDebounced } from '../../../../../script.js';
import { extension_settings, saveMetadataDebounced } from '../../../../extensions.js';

const META_KEY = 'travelersFolio';
const SETTINGS_KEY = 'travelersFolio_settings';

const DEFAULT_SETTINGS = {
    enabled: true,
    showFab: true,
    injectPrompt: true,

    // Название города подставляется в промпты.
    city: '',
    // Имя профиля Connection Manager для генерации. Пусто = текущая модель чата.
    // Это ЕДИНСТВЕННОЕ, что хранится: никаких url, ключей, заголовков.
    generationProfile: '',

    // Фоновая генерация выключена по умолчанию: любая автоматика пишет в чат.
    ambientTriggers: false,
    ambientChance: 0.15,
    ambientEvery: 10,

    maxItems: 48,
    maxPerRefresh: 6,
    maxNotices: 24,
    maxNoticesPerRefresh: 5,
    maxTokens: 900,
    maxLettersPerThread: 40,
};

/** @returns {object} глобальные настройки расширения */
export function getSettings() {
    if (!extension_settings[SETTINGS_KEY] || typeof extension_settings[SETTINGS_KEY] !== 'object') {
        extension_settings[SETTINGS_KEY] = { ...DEFAULT_SETTINGS };
    }
    const s = extension_settings[SETTINGS_KEY];
    for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) if (s[k] === undefined) s[k] = v;
    return s;
}

export function saveSettings() {
    try { saveSettingsDebounced(); } catch (e) { console.warn('[Folio] saveSettings', e); }
}

function emptyMeta() {
    return {
        version: 2,
        /** Газета: слухи и официальные документы вперемешку. */
        gazette: [],
        /** Доска объявлений: заказы, попутчики, товары. */
        board: [],
        /** Почтовые голуби: переписка, один поток на адресата. */
        letters: [],
        /** Кошелёк. currency.generated=false, пока модель не придумает монеты. */
        purse: { currency: { generated: false, unit: '', plural: '', denominations: [] }, amounts: {}, ledger: [] },
        /** Трофеи: что персонаж лично узнал и что уходит в чат. */
        witnessed: [],
    };
}

/** @returns {object} metadata канцелярии для текущего чата */
export function getMeta() {
    const md = chat_metadata;
    if (!md[META_KEY] || typeof md[META_KEY] !== 'object') md[META_KEY] = emptyMeta();
    const meta = md[META_KEY];
    for (const [k, v] of Object.entries(emptyMeta())) if (meta[k] === undefined) meta[k] = v;
    // Миграция с v1: там был кошелёк с золотыми/серебряными и отдельные указы.
    if (meta.version < 2) {
        meta.version = 2;
        meta.gazette = meta.gazette || [];
        meta.board = meta.board || [];
        meta.letters = meta.letters || [];
        meta.purse = meta.purse?.currency ? meta.purse : emptyMeta().purse;
        delete meta.rumors;
        delete meta.proclamations;
        saveMeta();
    }
    return meta;
}

export function saveMeta() {
    try { saveMetadataDebounced(); } catch (e) { console.warn('[Folio] saveMeta', e); }
}

/** Полный сброс папки текущей ролевой. Чат и расширения не трогает. */
export function factoryReset() {
    try { delete chat_metadata[META_KEY]; } catch (e) { chat_metadata[META_KEY] = undefined; }
    getMeta();
    saveMeta();
}

export function getChatLength() {
    try { return SillyTavern.getContext()?.chat?.length || 0; } catch (e) { return 0; }
}

export function getUserName() {
    try { return SillyTavern.getContext()?.name1 || ''; } catch (e) { return ''; }
}

export function getCharacterName() {
    try { return SillyTavern.getContext()?.name2 || ''; } catch (e) { return ''; }
}