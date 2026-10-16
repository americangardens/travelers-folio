/**
 * Газета — слухи и официальные документы в одном выпуске.
 *
 * ДВА ИЗМЕРЕНИЯ, а не одно. Это ключевая идея модуля:
 *
 *   достоверность (truth)   — насколько это правда. Указ высокая и не падает.
 *                              Слух низкая и угасает со временем.
 *   охват (reach)          — насколько это разлетелось по городу.
 *                              Указ охвата не имеет: его читали и забыли.
 *                              Слух распространяется, но редко бывает правдой.
 *
 * Оси независимы. Слух в 80% охвата и 20% правды — обычное дело.
 * Указ в 95% правды и 10% охвата — тоже. Реакции толпы двигают обе.
 */

import { generateWithProfile } from '../core/generation.js';
import { getMeta, saveMeta, getSettings, getCharacterName } from '../core/state.js';

// ── Слухи: источник задаёт старт обеих осей ────────────────────
// truth — достоверность, truthDecay — сколько % в сутки.
// reach — охват, reachDecay — сколько % в сутки.
export const RUMOR_KINDS = {
    herald: { truth: 55, truthDecay: 8,  reach: 90, reachDecay: 12, icon: '📯', label: 'Глашатай', place: 'Королевские ворота' },
    court:  { truth: 65, truthDecay: 5,  reach: 45, reachDecay: 10, icon: '🎭', label: 'Сплетни знати', place: 'Двор' },
    market: { truth: 45, truthDecay: 10, reach: 70, reachDecay: 8,  icon: '🛒', label: 'Рыночная болтовня', place: 'Рыночная площадь' },
    tavern: { truth: 25, truthDecay: 15, reach: 80, reachDecay: 6,  icon: '🍺', label: 'Таверные байки', place: 'Таверна' },
    street: { truth: 35, truthDecay: 12, reach: 65, reachDecay: 9,  icon: '🗣️', label: 'Уличный шёпот', place: 'Улицы' },
};

// ── Официальное: правда высокая, охвата почти нет ───────────────
export const OFFICIAL_KINDS = {
    edict:    { truth: 95, truthDecay: 0, reach: 20, reachDecay: 8, icon: '👑', label: 'Королевский указ', place: 'Канцелярия' },
    manifest: { truth: 95, truthDecay: 0, reach: 30, reachDecay: 8, icon: '📜', label: 'Манифест', place: 'Королевские ворота' },
    tax:      { truth: 95, truthDecay: 0, reach: 25, reachDecay: 8, icon: '🧾', label: 'Сбор и подать', place: 'Казна' },
    priest:   { truth: 85, truthDecay: 0, reach: 35, reachDecay: 7, icon: '⛪', label: 'Проповедь', place: 'Храм' },
};

export const ALL_KINDS = { ...RUMOR_KINDS, ...OFFICIAL_KINDS };

export function isOfficial(kind) {
    return !!OFFICIAL_KINDS[kind];
}

export const REACTION_DELTA = { support: +2, doubt: -3, spread: +4 };

const DAY_MS = 24 * 60 * 60 * 1000;
const uid = () => 'g-' + Math.random().toString(36).slice(2, 10);
const clamp = (v, min = 0, max = 100) => Math.max(min, Math.min(max, v));

function band(v, stops) {
    for (const [limit, name] of stops) if (v >= limit) return name;
    return stops[stops.length - 1][1];
}

const TRUTH_BANDS = [[90, 'sure'], [65, 'likely'], [40, 'maybe'], [1, 'doubtful'], [0, 'dead']];
const REACH_BANDS = [[70, 'wide'], [40, 'some'], [1, 'few'], [0, 'none']];

const TRUTH_LABEL = {
    sure: 'Почти наверняка', likely: 'Скорее правда', maybe: 'Возможно правда',
    doubtful: 'Сомнительно', dead: 'Никто не подтвердил', refuted: 'Опровергнуто',
};
const REACH_LABEL = {
    wide: 'Все обсуждают', some: 'Обсуждают', few: 'Потихо', none: 'Только в канцелярии',
};

function kindOf(item) {
    return ALL_KINDS[item.kind] || RUMOR_KINDS.street;
}

/**
 * Считает обе оси. Одна функция на всё — иначе формулы разъедутся.
 * @returns {{truth:number, reach:number, truthLabel:string, reachLabel:string,
 *            truthBand:string, reachBand:string}}
 */
export function assess(item) {
    const k = kindOf(item);
    const ageDays = Math.max(0, (Date.now() - (item.createdAt || Date.now())) / DAY_MS);

    let truth = k.truth - k.truthDecay * ageDays;
    let reach = k.reach - k.reachDecay * ageDays;

    for (const r of item.reactions || []) {
        const w = r.weight || 1;
        if (r.type === 'support') truth += REACTION_DELTA.support * w;
        else if (r.type === 'doubt') truth += REACTION_DELTA.doubt * w;
        else if (r.type === 'spread') reach += REACTION_DELTA.spread * w;
    }

    if (item.refuted) {
        return {
            truth: 0, reach: clamp(Math.round(reach), 0, 100),
            truthLabel: TRUTH_LABEL.refuted, reachLabel: REACH_LABEL.none,
            truthBand: 'refuted', reachBand: 'none',
        };
    }

    truth = clamp(Math.round(truth));
    reach = clamp(Math.round(reach));
    const truthBand = band(truth, TRUTH_BANDS);
    return {
        truth, reach,
        truthLabel: TRUTH_LABEL[truthBand],
        reachLabel: REACH_LABEL[band(reach, REACH_BANDS)],
        truthBand,
        reachBand: band(reach, REACH_BANDS),
    };
}

// ── Хранилище ───────────────────────────────────────────────────

export function listGazette({ kind = null } = {}) {
    const items = kind
        ? getMeta().gazette.filter(i => i.kind === kind)
        : getMeta().gazette;
    return [...items].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

export function unreadCount() {
    return getMeta().gazette.filter(i => !i.read).length;
}

function trim() {
    const s = getSettings();
    const meta = getMeta();
    if (meta.gazette.length > s.maxItems) {
        meta.gazette.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        meta.gazette.length = s.maxItems;
    }
}

export function addItem({ kind = 'street', text, source, place, seal = '' }) {
    const k = kindOf({ kind });
    const item = {
        id: uid(),
        kind,
        text: String(text || '').trim(),
        source: source || k.label,
        place: place || k.place,
        seal: seal || '',
        official: isOfficial(kind),
        createdAt: Date.now(),
        reactions: [],
        refuted: false,
        read: false,
    };
    if (!item.text) return null;
    getMeta().gazette.push(item);
    trim();
    saveMeta();
    return item;
}

export function getItem(id) {
    return getMeta().gazette.find(x => x.id === id) || null;
}

export function setRefuted(id, value = true) {
    const item = getItem(id);
    if (!item) return false;
    item.refuted = value;
    saveMeta();
    return true;
}

/** Реакция толпы. Локально, в чат не пишется. */
export function react(id, type) {
    const item = getItem(id);
    if (!item || !REACTION_DELTA[type]) return false;
    item.reactions.push({ type, at: Date.now() });
    saveMeta();
    return true;
}

export function reactionCounts(id) {
    const item = getItem(id);
    const out = { support: 0, doubt: 0, spread: 0 };
    for (const r of item?.reactions || []) if (out[r.type] !== undefined) out[r.type]++;
    return out;
}

export function markAllRead() {
    for (const i of getMeta().gazette) i.read = true;
    saveMeta();
}

// ── Время ───────────────────────────────────────────────────────

export function timeAgo(ts) {
    const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
    if (s < 60) return 'только что';
    if (s < 3600) return `${Math.floor(s / 60)} мин назад`;
    if (s < 86400) return `${Math.floor(s / 3600)} ч назад`;
    return `${Math.floor(s / 86400)} дн назад`;
}

// ── Генерация: один батч, две полосы ────────────────────────────

const GAZETTE_PROMPT = `Ты — «Вестник», газета одного города. Сделай ОДИН выпуск.

Что сейчас происходит (краткое содержание ролевой):
{{SITUATION}}

Город: {{CITY}}
Главный персонаж: {{CHAR}}

Выпуск состоит из двух полос. Формат каждой строки строго:

СЛУХИ (что передали из уст в уста, часто врёт):
herald|<краткий текст>|<кто несёт>|<где услышано>
court|<краткий текст>|<источник>|<место>
market|<краткий текст>|<источник>|<место>
tavern|<краткий текст>|<источник>|<место>
street|<краткий текст>|<источник>|<место>

ОФИЦИАЛЬНЫЕ ДОКУМЕНТЫ (правда, но их читают и забывают):
edict|<вид документа>|<печать>|<полный текст документа, 2-3 предложения>
manifest|<вид документа>|<печать>|<полный текст, 2-3 предложения>
tax|<вид документа>|<печать>|<полный текст, 2-3 предложения>
priest|<вид документа>|<печать>|<полный текст, 2-3 предложения>

Правила:
- Слухов ровно {{RUMORS}}, документов ровно {{OFFICIALS}}.
- Слухи могут противоречить друг другу.
- Никакой современной техники: газета, печать, свечи — только мир ролевой.
- Формат слуха: "тип|текст|источник|место". Формат документа: "тип|вид|печать|текст".
- Ничего кроме этих строк: без нумерации, заголовков и пояснений.

Пример строк:
herald|Говорят, ночью у моста несли караван с северных земель|Глашатай Илья|Королевские ворота
edict|Указ|Законный сургуч|Со всеми подданными королевства повелеваю: кто укроет беглого, получит награду.`;

function situation() {
    try {
        const chat = SillyTavern.getContext()?.chat || [];
        const recent = chat.filter(m => !m.is_system).slice(-10);
        if (!recent.length) return 'История только начинается, город живёт обычной жизнью.';
        return recent
            .map(m => `${m.is_user ? 'игрок' : 'персонаж'}: ${String(m.mes || '').slice(0, 200)}`)
            .join('\n');
    } catch (e) {
        return 'История только начинается.';
    }
}

const RUMOR_KEYS = Object.keys(RUMOR_KINDS);
const OFFICIAL_KEYS = Object.keys(OFFICIAL_KINDS);

function parseLines(raw) {
    const out = [];
    for (const line of String(raw || '').split('\n')) {
        const t = line.trim();
        if (!t || t.startsWith('```') || !t.includes('|')) continue;
        const parts = t.split('|').map(x => x.trim());
        if (parts.length < 4) continue;

        if (RUMOR_KEYS.includes(parts[0])) {
            const [, text, source, place] = parts;
            if (text) out.push({ kind: parts[0], text, source, place });
        } else if (OFFICIAL_KEYS.includes(parts[0])) {
            const [, title, seal, ...rest] = parts;
            const text = rest.join('|').trim();
            if (text) out.push({ kind: parts[0], text: `${title}. ${text}`, seal });
        }
    }
    return out;
}

/**
 * Батч-генерация выпуска: один запрос → слухи + документы.
 * @returns {Promise<{rumors:number, official:number}>}
 */
export async function generateIssue({ rumors = null, official = null } = {}) {
    const s = getSettings();
    const nRumors = Math.max(1, Math.min(rumors ?? s.maxPerRefresh, s.maxPerRefresh));
    const nOfficial = Math.max(0, Math.min(official ?? Math.max(1, Math.round(s.maxPerRefresh / 2)), s.maxPerRefresh));

    const prompt = GAZETTE_PROMPT
        .replace('{{SITUATION}}', situation())
        .replace('{{CITY}}', s.city || 'город из ролевой')
        .replace('{{CHAR}}', getCharacterName() || 'герой истории')
        .replace('{{RUMORS}}', String(nRumors))
        .replace('{{OFFICIALS}}', String(nOfficial));

    const raw = await generateWithProfile(prompt, { responseLength: Math.min(s.maxTokens, 400) });

    let nR = 0, nO = 0;
    for (const item of parseLines(raw)) {
        const created = addItem(item);
        if (!created) continue;
        if (created.official) nO++; else nR++;
    }
    saveMeta();
    return { rumors: nR, official: nO };
}

// ── Фоновые триггеры ───────────────────────────────────────────

const LOCATION_PATTERNS = [
    { re: /рынок|торгов(а|ую|ой) (площад|ряд)|лавк|прилавок/i, kinds: ['market', 'street'], place: 'Рыночная площадь' },
    { re: /таверн|трактир|пивн|кружеч|выпил/i, kinds: ['tavern'], place: 'Таверна' },
    { re: /двор(ец|а)|корол(ь|ев)|трон|палата/i, kinds: ['herald', 'court'], place: 'Дворц' },
    { re: /площад|улиц|переул|страж|ворот/i, kinds: ['street', 'market'], place: 'Улицы' },
    { re: /храм|церк|монах|пропов/i, kinds: ['priest'], place: 'Храм' },
];

export function ambientCheck(chatLength) {
    const s = getSettings();
    if (!s.enabled || !s.ambientTriggers) return false;
    if (chatLength % s.ambientEvery !== 0) return false;
    if (Math.random() > s.ambientChance) return false;

    let text = '';
    try {
        const chat = SillyTavern.getContext()?.chat || [];
        for (let i = chat.length - 1; i >= 0 && i >= chat.length - 3; i--) {
            if (chat[i]?.is_user) break;
            text += ' ' + String(chat[i]?.mes || '');
        }
    } catch (e) { return false; }
    if (!text.trim()) return false;

    for (const p of LOCATION_PATTERNS) {
        if (p.re.test(text)) {
            const kind = p.kinds[Math.floor(Math.random() * p.kinds.length)];
            addItem({ kind, place: p.place, text: text.trim().slice(0, 150) });
            return true;
        }
    }
    return false;
}