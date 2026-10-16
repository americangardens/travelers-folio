/**
 * Доска объявлений — то, что висит на заборе у ворот.
 *
 * В отличие от газеты, у объявления нет достоверности: это просто чьё-то
 * предложение. Есть срок («до субботы»), награда и автор — их и сравнивают.
 * Модель читает лорбук, карточку и историю чата, поэтому объявления
 * соответствуют миру, а не абстракции.
 */

import { generateWithProfile } from '../core/generation.js';
import { getMeta, saveMeta, getSettings, getCharacterName } from '../core/state.js';
import { timeAgo } from './gazette.js';

// job — ищет исполнителя, offer — предлагает товар, people — ищет людей.
export const NOTICE_KINDS = {
    job:    { icon: '⚒️', label: 'Работа',    hint: 'кто-то ищет исполнителя' },
    people: { icon: '🧭', label: 'Спутники',  hint: 'купцы, наёмники, провожатые' },
    offer:  { icon: '📦', label: 'Товар',     hint: 'продают или ищут' },
    board:  { icon: '🏠', label: 'Случай',    hint: 'место, вещь, событие' },
};

const KEYS = Object.keys(NOTICE_KINDS);
const uid = () => 'n-' + Math.random().toString(36).slice(2, 10);

export function listNotices({ kind = null } = {}) {
    const items = kind ? getMeta().board.filter(n => n.kind === kind) : getMeta().board;
    return [...items].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

export function unreadNotices() {
    return getMeta().board.filter(n => !n.read).length;
}

function trim() {
    const s = getSettings();
    const meta = getMeta();
    if (meta.board.length > s.maxNotices) {
        meta.board.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        meta.board.length = s.maxNotices;
    }
}

export function addNotice({ kind = 'board', title, text, author, place, reward = '' }) {
    const notice = {
        id: uid(),
        kind: NOTICE_KINDS[kind] ? kind : 'board',
        title: String(title || '').trim(),
        text: String(text || '').trim(),
        author: String(author || '').trim() || 'Неизвестный',
        place: String(place || '').trim(),
        reward: String(reward || '').trim(),
        createdAt: Date.now(),
        taken: false,
        read: false,
    };
    if (!notice.title) return null;
    getMeta().board.push(notice);
    trim();
    saveMeta();
    return notice;
}

/** Отметить, что персонаж взялся за объявление. */
export function takeNotice(id) {
    const n = getMeta().board.find(x => x.id === id);
    if (!n || n.taken) return false;
    n.taken = true;
    saveMeta();
    return true;
}

export function removeNotice(id) {
    const meta = getMeta();
    const i = meta.board.findIndex(x => x.id === id);
    if (i < 0) return false;
    meta.board.splice(i, 1);
    saveMeta();
    return true;
}

export function markNoticesRead() {
    for (const n of getMeta().board) n.read = true;
    saveMeta();
}

const BOARD_PROMPT = `Ты — доска объявлений у ворот города. Придумай, что сейчас там висит.

Что сейчас происходит (краткое содержание ролевой):
{{SITUATION}}

Город: {{CITY}}
Главный персонаж: {{CHAR}}
Валюта в этом мире: {{CURRENCY}}

Ровно {{COUNT}} объявлений, каждый — ОДНА строка.

Формат строки строго:
"<kind>|<title>|<text>|<author>|<place>|<reward>"

- kind ∈ {job, people, offer, board}
  job — ищет исполнителя (перенести, построить, выследить, добыть)
  people — ищет спутников, попутчиков, наёмников
  offer — продаёт или ищет товар (оружие, ткань, зелье, еда, скот)
  board — место, вещь или событие (ярмарка, праздник, странная находка)
- title — короткое имя объявления, до 5 слов, как заголовок на листке
- text — 1-2 предложения подробностей: что нужно и почему это стоит внимания
- author — кто написал: имя и ремесло ("Кузнец Хельга", "Капитан Братт")
- place — где встречаться или где вещь ("У ворот", "Трактир «Медведь»")
- reward — награда в валюте этой земли ("12 медяков", "кружель эля") или "вознаграждение"
- Никакой современной техники. Ничего кроме этих строк.

Пример:
people|Ищу спутника до Чёрных гор|Купец Айвен, иду с караваном через перевал. Одному тяжело, нужен человек с оружием. Заплачу половину выручки.|Капитан Братт|У ворот, перед почтой|15 серебряков`;

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

/** Валюта известна из кошелька, если модель её уже придумала. */
function currencyLabel() {
    const cur = getMeta().purse?.currency;
    if (cur?.generated && cur.plural) return cur.plural;
    return 'монеты этой земли — придумай правдоподобное название для этого мира';
}

export async function generateNotices(count = null) {
    const s = getSettings();
    const n = Math.max(1, Math.min(count ?? s.maxNoticesPerRefresh, s.maxNoticesPerRefresh));

    const prompt = BOARD_PROMPT
        .replace('{{SITUATION}}', situation())
        .replace('{{CITY}}', s.city || 'город из ролевой')
        .replace('{{CHAR}}', getCharacterName() || 'герой истории')
        .replace('{{CURRENCY}}', currencyLabel())
        .replace('{{COUNT}}', String(n));

    const raw = await generateWithProfile(prompt, { responseLength: Math.min(s.maxTokens, 400) });

    let added = 0;
    for (const line of String(raw || '').split('\n')) {
        const t = line.trim();
        if (!t || t.startsWith('```')) continue;
        const parts = t.split('|').map(x => x.trim());
        if (parts.length < 5) continue;
        const [kind, title, text, author, place] = parts;
        if (!KEYS.includes(kind) || !title) continue;
        const reward = parts[5] || '';
        if (addNotice({ kind, title, text, author, place, reward })) added++;
    }
    saveMeta();
    return added;
}

export { timeAgo };