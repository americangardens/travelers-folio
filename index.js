/**
 * Дорожная канцелярия — вход в расширение SillyTavern.
 *
 * Здесь только связывание: UI + хранилище + инжект промптов + события чата.
 * Вся логика — в core/ и modules/.
 */

import { eventSource, event_types, saveChatConditional } from '../../../../script.js';
import { getSettings, saveSettings, getMeta, factoryReset, getChatLength } from './core/state.js';
import { updateFolioInjection } from './core/prompts.js';
import { ambientCheck } from './modules/gazette.js';
import { initUI, render, isOpen, toggle, close } from './ui/folio-modal.js';

// ── CSS ──
const cssId = 'travelers-folio-css';
if (!document.getElementById(cssId)) {
    const link = document.createElement('link');
    link.id = cssId;
    link.rel = 'stylesheet';
    // Путь от самого модуля: папку расширения можно переименовать.
    link.href = new URL('./ui/styles.css', import.meta.url).href + '?t=' + Date.now();
    document.head.appendChild(link);
}

// ── Кнопка рядом с полем ввода ──
function mountButton() {
    if (document.getElementById('folio-inline-btn')) return;
    const btn = document.createElement('div');
    btn.id = 'folio-inline-btn';
    btn.className = 'list-group-item flex-container flexGap5 interactable';
    btn.title = 'Дорожная канцелярия';
    btn.innerHTML = '<i class="fa-solid fa-folder-open"></i><span>Канцелярия</span>';
    btn.addEventListener('click', toggle);
    $('#send_form').prepend(btn);
}

function unmountButton() {
    document.getElementById('folio-inline-btn')?.remove();
}

function applySettingsToUi() {
    const s = getSettings();
    const root = document.getElementById('travelers-folio-root');
    root?.classList.toggle('is-enabled', !!s.enabled && s.showFab !== false);
    if (!s.enabled) close();
    s.enabled ? mountButton() : unmountButton();
    updateFolioInjection();
}

// ── События чата ──
function onMessageReceived() {
    const s = getSettings();
    if (!s.enabled) return;

    // Гибрид A + B: локация в тексте ИЛИ редкий шанс на ход.
    if (ambientCheck(getChatLength())) {
        saveChatConditional();
        render();
    }
    updateFolioInjection();
}

jQuery(async () => {
    initUI();

    const s = getSettings();
    if (s.enabled) mountButton();
    updateFolioInjection();
    render();

    eventSource.on(event_types.MESSAGE_RECEIVED, onMessageReceived);
    eventSource.on(event_types.MESSAGE_UPDATED, onMessageReceived);
    eventSource.on(event_types.MESSAGE_SWIPED, onMessageReceived);

    eventSource.on(event_types.CHAT_CHANGED, () => {
        getMeta();          // создать/подтянуть папку нового чата
        render();
        updateFolioInjection();
    });

    // Ручные команды в консоли — удобно отлаживать.
    const api = {
        open: () => import('./ui/folio-modal.js').then(m => m.open()),
        render,
        isOpen,
        getSettings,
        saveSettings: (patch) => { Object.assign(getSettings(), patch); saveSettings(); applySettingsToUi(); },
        factoryReset,
    };
    window.travelersFolio = api;

    console.log('[Дорожная канцелярия] готова. Команды: travelersFolio.open(), travelersFolio.factoryReset()');
});