/**
 * Окно канцелярии: вкладки, рендер, плавающая кнопка.
 * DOM строится здесь, логика — в модулях.
 *
 * Четыре вкладки: Газета, Доска, Кошель, Сбор.
 * Газета и Доска — то, что персонаж видит в городе.
 * Кошель и Сбор — то, что канцелярия ведёт сама.
 */

import { getSettings, saveSettings, factoryReset } from '../core/state.js';
import { profileInfo } from '../core/generation.js';
import { updateFolioInjection } from '../core/prompts.js';
import {
    listGazette, assess, reactionCounts, react, setRefuted,
    generateIssue, markAllRead, ALL_KINDS, unreadCount, timeAgo,
} from '../modules/gazette.js';
import {
    listNotices, generateNotices, takeNotice, removeNotice,
    markNoticesRead, unreadNotices, NOTICE_KINDS,
} from '../modules/board.js';
import {
    getPurse, hasCurrency, generateCurrency, denominationScale, listLedger,
} from '../modules/purse.js';
import {
    listThreads, getThread, unreadThreads, markThreadsRead,
    generateRoster, sendLetter, removeThread, ensureThreadFor,
} from '../modules/letters.js';

const TABS = [
    { id: 'gazette', label: 'Газета' },
    { id: 'board', label: 'Доска' },
    { id: 'letters', label: 'Голуби' },
    { id: 'purse', label: 'Кошель' },
    { id: 'setup', label: 'Сбор' },
];

let root = null;
let activeTab = 'gazette';
let busy = false;
// Кто выбран для переписки и кого модель предложила как адресатов.
let letterThreadId = null;
let roster = [];

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export { unreadCount };

// ── Газета ─────────────────────────────────────────────────────

function meter(axis, value, label) {
    return `
        <div class="folio-meter-row">
            <span class="folio-axis">${axis}</span>
            <div class="folio-meter ${label}"><i style="width:${value}%"></i></div>
            <span class="folio-verdict">${value}%</span>
        </div>`;
}

function renderGazette() {
    const items = listGazette();
    const busyBtn = busy ? 'disabled' : '';

    if (!items.length) {
        return `
            <div class="folio-actions">
                <button class="folio-btn" data-act="issue" ${busyBtn}>📰 Свежий выпуск</button>
            </div>
            <div class="folio-quiet">
                <div class="folio-quiet-mark">🕯</div>
                <p>Пока тихо.</p>
                <small>Газета ещё не выходила в этой ролевой. Нажми «Свежий выпуск» —
                и она соберёт слухи и указы из того, что уже есть в чате.</small>
            </div>`;
    }

    const cards = items.map(item => {
        const a = assess(item);
        const rc = reactionCounts(item.id);
        const k = ALL_KINDS[item.kind] || ALL_KINDS.street;

        return `
        <div class="folio-card ${item.refuted ? 'is-refuted' : ''} ${item.official ? 'is-official' : ''}" data-id="${item.id}">
            <div class="folio-card-kind">${k.icon} ${esc(k.label)}</div>
            <div class="folio-card-text">${esc(item.text)}</div>
            ${meter('правда', a.truth, a.truthBand)}
            ${meter('охват', a.reach, a.reachBand)}
            <div class="folio-verdicts">
                <span>${esc(a.truthLabel)}</span>
                <span class="dot">·</span>
                <span>${esc(a.reachLabel)}</span>
            </div>
            <div class="folio-meta">
                <span>${esc(item.source)}</span>
                <span>${esc(item.place)}</span>
                <span>${timeAgo(item.createdAt)}</span>
            </div>
            <div class="folio-reactions">
                <button class="folio-react" data-react="support">🙌 <b>${rc.support}</b></button>
                <button class="folio-react" data-react="doubt">🤔 <b>${rc.doubt}</b></button>
                <button class="folio-react" data-react="spread">🗣️ <b>${rc.spread}</b></button>
            </div>
            ${item.official || item.refuted ? '' : '<button class="folio-refute" data-act="refute">Опровергнуть</button>'}
        </div>`;
    }).join('');

    return `
        <div class="folio-actions">
            <button class="folio-btn" data-act="issue" ${busyBtn}>📰 Свежий выпуск</button>
            ${busy ? '<span class="folio-loading">Глашатай собирает…</span>' : ''}
        </div>
        ${cards}`;
}

// ── Доска объявлений ───────────────────────────────────────────

function renderBoard() {
    const notices = listNotices();
    const busyBtn = busy ? 'disabled' : '';

    if (!notices.length) {
        return `
            <div class="folio-actions">
                <button class="folio-btn" data-act="notices" ${busyBtn}>📌 Что на доске</button>
            </div>
            <div class="folio-quiet">
                <div class="folio-quiet-mark">📌</div>
                <p>Доска пуста.</p>
                <small>Объявления собираются из того, чем занят город:
                работа, попутчики, товары.</small>
            </div>`;
    }

    const cards = notices.map(n => {
        const k = NOTICE_KINDS[n.kind] || NOTICE_KINDS.board;
        return `
        <div class="folio-card folio-notice ${n.taken ? 'is-taken' : ''}" data-id="${n.id}">
            <div class="folio-card-kind">${k.icon} ${esc(k.label)}${n.taken ? ' — взято' : ''}</div>
            <div class="folio-notice-title">${esc(n.title)}</div>
            <div class="folio-card-text">${esc(n.text)}</div>
            ${n.reward ? `<div class="folio-reward">🪙 ${esc(n.reward)}</div>` : ''}
            <div class="folio-meta">
                <span>${esc(n.author)}</span>
                <span>${esc(n.place)}</span>
                <span>${timeAgo(n.createdAt)}</span>
            </div>
            <div class="folio-reactions">
                <button class="folio-btn" data-act="take" ${n.taken || busyBtn}>Взять</button>
                <button class="folio-btn" data-act="drop">Сорвать</button>
            </div>
        </div>`;
    }).join('');

    return `
        <div class="folio-actions">
            <button class="folio-btn" data-act="notices" ${busyBtn}>📌 Что на доске</button>
            ${busy ? '<span class="folio-loading">Смотрю…</span>' : ''}
        </div>
        ${cards}`;
}

// ── Голуби ─────────────────────────────────────────────────────

const KIND_ICON = { character: '👤', npc: '🧑', courier: '🕊️' };

function renderLetters() {
    const threads = listThreads();
    const active = letterThreadId ? getThread(letterThreadId) : null;

    // Переписка открыта — показываем её.
    if (active) {
        const history = active.messages.length
            ? active.messages.map(m => `
                <div class="folio-msg ${m.role === 'you' ? 'is-you' : 'is-them'}">
                    <div class="folio-msg-author">${m.role === 'you' ? 'Ты' : esc(active.name)}</div>
                    <div class="folio-msg-text">${esc(m.text)}</div>
                </div>`).join('')
            : '<div class="folio-empty">Писем ещё не было. Напиши первое.</div>';

        return `
            <div class="folio-actions">
                <button class="folio-btn" data-act="close-thread">← К адресатам</button>
                <button class="folio-btn" data-act="drop-thread">Убрать переписку</button>
            </div>
            <div class="folio-letter-head">${KIND_ICON[active.kind] || '🧑'} ${esc(active.name)}</div>
            <div class="folio-thread">${history}</div>
            <textarea class="folio-letter-input" data-act="letter-body" rows="4"
                placeholder="Что написать?"></textarea>
            <div class="folio-actions">
                <button class="folio-btn" data-act="send-letter" ${busy ? 'disabled' : ''}>
                    ${busy ? 'Голубь летит…' : '🕊️ Отправить'}
                </button>
            </div>
            <p class="folio-note">Письмо уйдёт в чат одной строкой. Ответ адресата
            останется здесь и подмешается в подсказку модели.</p>`;
    }

    // Список: существующие переписки + предложенные адресаты.
    const existing = threads.map(t => `
        <button class="folio-contact" data-act="open-thread" data-id="${esc(t.id)}">
            <span class="folio-contact-ico">${KIND_ICON[t.kind] || '🧑'}</span>
            <span class="folio-contact-name">${esc(t.name)}${t.unread ? ' <b>•</b>' : ''}</span>
            <span class="folio-contact-count">${t.messages.length} писем</span>
        </button>`).join('');

    const suggested = roster.length
        ? roster.map((r, i) => `
            <button class="folio-contact" data-act="pick-contact" data-name="${esc(r.name)}" data-kind="${esc(r.kind)}">
                <span class="folio-contact-ico">${KIND_ICON[r.kind] || '🧑'}</span>
                <span class="folio-contact-name">${esc(r.name)}</span>
                <span class="folio-contact-note">${esc(r.note)}</span>
            </button>`).join('')
        : '';

    if (!threads.length && !roster.length) {
        return `
            <div class="folio-actions">
                <button class="folio-btn" data-act="roster" ${busy ? 'disabled' : ''}>🕊️ Кого спросить</button>
            </div>
            <div class="folio-quiet">
                <div class="folio-quiet-mark">🕊</div>
                <p>Голубят не выпускали.</p>
                <small>Спроси, кому в этом мире есть что тебе сказать —
                и начнётся переписка.</small>
            </div>`;
    }

    return `
        <div class="folio-actions">
            <button class="folio-btn" data-act="roster" ${busy ? 'disabled' : ''}>🕊️ Кого спросить</button>
        </div>
        ${existing ? `<div class="folio-subhead">Переписка</div>${existing}` : ''}
        ${suggested ? `<div class="folio-subhead">Могут написать</div>${suggested}` : ''}`;
}

// ── Кошель ─────────────────────────────────────────────────────

function renderPurse() {
    if (!hasCurrency()) {
        return `
            <div class="folio-actions">
                <button class="folio-btn" data-act="currency" ${busy ? 'disabled' : ''}>💰 Наполнить карманы</button>
            </div>
            <div class="folio-quiet">
                <div class="folio-quiet-mark">🪙</div>
                <p>Карманы пусты.</p>
                <small>В мире этой ролевой свои деньги. Спроси — модель придумает
                номиналы по лорбуку и истории чата.</small>
            </div>`;
    }

    const purse = getPurse();
    const scale = denominationScale();
    const ledger = listLedger();

    return `
        <p class="folio-note">Валюта этого мира: ${esc(purse.currency.unit)}.
        Номинации придуманы моделью по лорбуку.</p>
        <div class="folio-coins">
            ${scale.map(d => `
                <div class="folio-coin">
                    <div class="num">${purse.amounts[d.name] || 0}</div>
                    <div class="lbl">${esc(d.plural)}</div>
                </div>`).join('')}
        </div>
        ${ledger.length
            ? ledger.map(x => `
                <div class="folio-ledger-row">
                    <span>${esc(x.reason)}</span>
                    <span class="amt ${x.delta >= 0 ? 'plus' : 'minus'}">${x.delta >= 0 ? '+' : ''}${x.delta}</span>
                </div>`).join('')
            : '<div class="folio-empty">Транзакций ещё не было.</div>'}
        <div class="folio-actions" style="margin-top:14px">
            <button class="folio-btn" data-act="currency" ${busy ? 'disabled' : ''}>💰 Пересчитать по новой</button>
        </div>`;
}

// ── Сбор ───────────────────────────────────────────────────────

function renderSetup() {
    const s = getSettings();
    const info = profileInfo();

    const options = [
        `<option value="" ${!info.selected ? 'selected' : ''}>Текущая модель чата</option>`,
        ...info.profiles.map(p =>
            `<option value="${esc(p.name)}" ${info.selected === p.name ? 'selected' : ''}>${esc(p.name)}${p.model ? ` — ${esc(p.model)}` : ''}</option>`),
    ].join('');

    return `
        <p class="folio-note">Содержимое канцелярии генерируется отдельной моделью,
        чтобы не нагружать ту, что пишет роль.</p>

        <label class="folio-field">
            <span>Модель для газеты и доски</span>
            <select class="text_pole" data-act="set-profile">${options}</select>
        </label>

        ${!info.connectionManagerPresent ? `
            <p class="folio-warn">Профили не найдены. Расширение
            <b>Connection Manager</b> уже есть в SillyTavern — создай в нём профиль
            (например, с быстрой дешёвой моделью). Расширение хранит только
            <i>имя</i> профиля: ключи остаются в SillyTavern.</p>` : ''}

        ${info.selected && !info.selectedExists ? `
            <p class="folio-warn">Профиль «${esc(info.selected)}» больше не существует —
            генерация идёт через текущую модель чата.</p>` : ''}

        <label class="folio-field">
            <span>Город</span>
            <input type="text" class="text_pole" data-act="set-city" value="${esc(s.city || '')}" placeholder="например: Новгород">
        </label>

        <div class="folio-checks">
            <label><input type="checkbox" data-act="set-ambient" ${s.ambientTriggers ? 'checked' : ''}><span>Фоновые слухи по локациям</span></label>
            <label><input type="checkbox" data-act="set-inject" ${s.injectPrompt ? 'checked' : ''}><span>Инструкции для модели</span></label>
        </div>
        <p class="folio-note">Фоновые слухи пишут в чат и раздувают историю,
        поэтому по умолчанию выключены.</p>

        <div class="folio-actions">
            <button class="folio-btn" data-act="factory-reset">⚠ Очистить папку этой ролевой</button>
        </div>
        <p class="folio-note">Удаляет только папку канцелярии в текущем чате.
        Чат и расширения не трогает.</p>`;
}

function bodyHtml() {
    if (activeTab === 'board') return renderBoard();
    if (activeTab === 'letters') return renderLetters();
    if (activeTab === 'purse') return renderPurse();
    if (activeTab === 'setup') return renderSetup();
    return renderGazette();
}

// ── Рендер ─────────────────────────────────────────────────────

function updateBadge() {
    if (!root) return;
    const n = unreadCount() + unreadNotices() + unreadThreads();
    const fab = root.querySelector('.folio-fab');
    const badge = root.querySelector('.folio-badge');
    if (badge) badge.textContent = String(n);
    fab?.classList.toggle('has-unread', n > 0);

    const counts = { gazette: unreadCount(), board: unreadNotices(), letters: unreadThreads() };
    for (const btn of root.querySelectorAll('.folio-tab')) {
        const c = counts[btn.dataset.tab] || 0;
        let dot = btn.querySelector('.dot');
        if (c > 0) {
            if (!dot) { dot = document.createElement('span'); dot.className = 'dot'; btn.appendChild(dot); }
            dot.textContent = ` ${c}`;
        } else if (dot) dot.remove();
    }
}

export function render() {
    if (!root) return;
    root.querySelector('.folio-body').innerHTML = bodyHtml();
    for (const t of TABS) {
        root.querySelector(`.folio-tab[data-tab="${t.id}"]`)
            .classList.toggle('is-active', t.id === activeTab);
    }
    updateBadge();
}

function markRead() {
    markAllRead();
    markNoticesRead();
    markThreadsRead();
}

// ── Действия ───────────────────────────────────────────────────

async function withBusy(fn) {
    busy = true;
    render();
    try {
        await fn();
    } catch (e) {
        console.warn('[Folio] генерация не удалась', e);
        alert('Генерация не удалась. Проверь подключение к модели.');
    } finally {
        busy = false;
        render();
    }
}

async function onAction(act, btn, card) {
    const { id, name, kind } = btn.dataset;
    if (act === 'issue') {
        await withBusy(async () => {
            const res = await generateIssue();
            if (!res.rumors && !res.official) {
                alert('Модель не вернула выпуск в нужном формате. Попробуй ещё раз.');
            }
        });
        return;
    }
    if (act === 'notices') {
        await withBusy(async () => {
            const n = await generateNotices();
            if (!n) alert('Модель не вернула объявления. Попробуй ещё раз.');
        });
        return;
    }
    if (act === 'currency') {
        if (!confirm('Придумать валюту заново? Текущие монеты и записи о тратах сбросятся.')) return;
        await withBusy(async () => {
            const cur = await generateCurrency();
            if (!cur) alert('Модель не вернула валюту. Попробуй ещё раз.');
        });
        return;
    }
    if (act === 'roster') {
        await withBusy(async () => {
            roster = await generateRoster();
            if (!roster.length) alert('Модель не вернула адресатов. Попробуй ещё раз.');
        });
        return;
    }
    if (act === 'pick-contact') {
        letterThreadId = ensureThreadFor(name, kind).id;
        render();
        return;
    }
    if (act === 'open-thread') {
        letterThreadId = id;
        const t = getThread(letterThreadId);
        if (t) t.unread = false;
        render();
        return;
    }
    if (act === 'close-thread') {
        letterThreadId = null;
        render();
        return;
    }
    if (act === 'drop-thread') {
        if (!letterThreadId) return;
        if (!confirm('Убрать эту переписку? Письма останутся в истории чата.')) return;
        removeThread(letterThreadId);
        letterThreadId = null;
        render();
        return;
    }
    if (act === 'send-letter') {
        const box = document.querySelector('.folio-letter-input');
        const text = (box?.value || '').trim();
        if (!text) { alert('Пустое письмо не улетит.'); return; }
        if (!letterThreadId) return;
        const target = letterThreadId;
        await withBusy(async () => {
            const reply = await sendLetter(target, text);
            if (!reply) alert('Голубь не долетел — ответ не получен.');
        });
        return;
    }
    if (act === 'factory-reset') {
        if (!confirm('Очистить папку канцелярии в этой ролевой? Газета, доска и кошель пропадут. Чат и расширения не тронут.')) return;
        factoryReset();
        render();
        return;
    }
    if (act === 'refute' && card) {
        setRefuted(card.dataset.id, true);
        render();
        return;
    }
    if (act === 'take' && card) {
        takeNotice(card.dataset.id);
        render();
        return;
    }
    if (act === 'drop' && card) {
        removeNotice(card.dataset.id);
        render();
        return;
    }
}

function onReaction(btn) {
    const card = btn.closest('.folio-card');
    if (!card) return;
    react(card.dataset.id, btn.dataset.react);
    render();
}

function onChange(el) {
    const s = getSettings();
    switch (el.dataset.act) {
        case 'set-profile':
            s.generationProfile = el.value;
            saveSettings();
            render();
            break;
        case 'set-ambient':
            s.ambientTriggers = el.checked;
            saveSettings();
            break;
        case 'set-inject':
            s.injectPrompt = el.checked;
            saveSettings();
            updateFolioInjection();
            break;
        default:
            break;
    }
}

function onCommit(el) {
    if (el.dataset.act === 'set-city') {
        getSettings().city = el.value.trim();
        saveSettings();
    }
}

// ── Окно ───────────────────────────────────────────────────────

export function isOpen() {
    return !!root?.classList.contains('is-open');
}

export function open() {
    root.classList.add('is-open');
    markRead();
    render();
}
export function close() {
    root?.classList.remove('is-open');
}
export function toggle() {
    isOpen() ? close() : open();
}

export function initUI() {
    if (document.getElementById('travelers-folio-root')) return;
    root = document.createElement('div');
    root.id = 'travelers-folio-root';
    root.className = 'folio-root';
    root.innerHTML = `
        <button class="folio-fab" title="Дорожная канцелярия" aria-label="Дорожная канцелярия">
            ⚜️<span class="folio-badge">0</span>
        </button>
        <div class="folio-modal">
            <div class="folio-backdrop"></div>
            <div class="folio-book" role="dialog" aria-label="Дорожная канцелярия">
                <div class="folio-header">
                    <span class="folio-crest">⚜️</span>
                    <span class="folio-title">Канцелярия</span>
                    <button class="folio-close" aria-label="Закрыть">✕</button>
                </div>
                <div class="folio-tabs">
                    ${TABS.map(t => `<button class="folio-tab" data-tab="${t.id}">${t.label}</button>`).join('')}
                </div>
                <div class="folio-body"></div>
            </div>
        </div>`;
    document.body.appendChild(root);

    root.querySelector('.folio-fab').addEventListener('click', toggle);
    root.querySelector('.folio-close').addEventListener('click', close);
    root.querySelector('.folio-backdrop').addEventListener('click', close);

    root.querySelector('.folio-tabs').addEventListener('click', (e) => {
        const tab = e.target.closest('.folio-tab');
        if (!tab) return;
        activeTab = tab.dataset.tab;
        render();
    });

    const body = root.querySelector('.folio-body');
    body.addEventListener('change', (e) => { if (e.target.dataset?.act) onChange(e.target); });
    body.addEventListener('blur', (e) => { if (e.target.dataset?.act) onCommit(e.target); }, true);
    body.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        const el = e.target;
        if (el.dataset?.act === 'set-city') { onCommit(el); el.blur(); }
    });
    body.addEventListener('click', (e) => {
        const btn = e.target.closest('button');
        if (!btn) return;
        if (btn.dataset.act) onAction(btn.dataset.act, btn, btn.closest('.folio-card'));
        else if (btn.dataset.react) onReaction(btn);
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && isOpen()) close();
    });

    const s = getSettings();
    root.classList.toggle('is-enabled', !!s.enabled && s.showFab !== false);
    render();
}