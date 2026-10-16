/**
 * Почтовые голуби — переписка с чаром и NPC.
 *
 * ГЛАВНОЕ ОТЛИЧИЕ ОТ ГАЗЕТЫ: газета — фон, её читают молча.
 * Письмо — событие, поэтому оно может попасть в историю чата.
 *
 * ЭКОНОМИЯ КОНТЕКСТА. На одно письмо в чат уходит РОВНО ОДНО сообщение:
 *   • твой текст письма уходит как действие игрока (sendMessageAsUser);
 *   • ответ адресата НЕ занимает место в истории — он лежит здесь, в папке,
 *     и подмешивается в промпт коротким срезом.
 * Поэтому длинная переписка не раздувает историю: 20 писем = 20 сообщений,
 * а не 40+.
 *
 * Групповых чатов и реакций нет намеренно: письмо — это диалог один на один.
 */

import { sendMessageAsUser, saveChatConditional } from '../../../../../script.js';
import { generateWithProfile } from '../core/generation.js';
import { getMeta, saveMeta, getSettings, getCharacterName } from '../core/state.js';

const uid = () => 'l-' + Math.random().toString(36).slice(2, 10);

/** Письмо, написанное тобой, уходит в чат как действие игрока. */
const LETTER_PREFIX = '[письмо] ';

// ── Собеседники ────────────────────────────────────────────────

/**
 * Список адресатов. Кто именно — решает модель по лорбуку и истории,
 * поэтому собеседники соответствуют миру, а не жёсткому списку.
 */
export function listThreads() {
    const meta = getMeta();
    return [...meta.letters].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

export function getThread(id) {
    return getMeta().letters.find(t => t.id === id) || null;
}

/**
 * Создать переписку с адресатом или вернуть существующую.
 * Имя — и есть идентификатор: один поток на человека.
 */
export function ensureThreadFor(name, kind = 'npc') {
    const meta = getMeta();
    const found = meta.letters.find(t => t.name === name);
    if (found) return found;

    const thread = {
        id: name,
        name,
        kind: ['character', 'npc', 'courier'].includes(kind) ? kind : 'npc',
        messages: [],
        updatedAt: Date.now(),
        unread: false,
    };
    meta.letters.push(thread);
    saveMeta();
    return thread;
}

function ensureThread(id) {
    let t = getThread(id);
    if (t) return t;
    t = { id, name: id, kind: 'npc', messages: [], updatedAt: Date.now(), unread: false };
    getMeta().letters.push(t);
    return t;
}

/** Непрочитанные — для бейджа. */
export function unreadThreads() {
    return getMeta().letters.filter(t => t.unread).length;
}

export function markThreadsRead() {
    for (const t of getMeta().letters) t.unread = false;
    saveMeta();
}

function trimThread(thread) {
    const s = getSettings();
    const limit = s.maxLettersPerThread || 40;
    if (thread.messages.length > limit) {
        thread.messages.splice(0, thread.messages.length - limit);
    }
}

// ── Переписка ──────────────────────────────────────────────────

/**
 * Отправить письмо. Текст уходит в чат одним сообщением,
 * ответ адресата возвращается в папку, а не в историю.
 *
 * @param {string} threadId
 * @param {string} text письмо игрока
 * @returns {Promise<string|null>} ответ адресата
 */
export async function sendLetter(threadId, text) {
    const body = String(text || '').trim();
    if (!body) return null;

    const thread = ensureThread(threadId);

    thread.messages.push({ role: 'you', text: body, at: Date.now() });
    thread.updatedAt = Date.now();
    thread.unread = false;
    trimThread(thread);

    // Одно сообщение в чат — это и есть плата за письмо.
    await sendMessageAsUser(`${LETTER_PREFIX}${body}`);
    saveMeta();
    saveChatConditional();

    const reply = await generateReply(thread);
    if (reply) {
        thread.messages.push({ role: 'them', text: reply, at: Date.now() });
        thread.updatedAt = Date.now();
        thread.unread = true;
        trimThread(thread);
        saveMeta();
    }
    return reply;
}

const REPLY_PROMPT = `Ты — {{WHO}}. Тебе только что доставили письмо, написанное в стиле средневековой ролевой.

Твоя личность:
{{WHO}}

Что происходит в мире сейчас (краткое содержание ролевой):
{{SITUATION}}

Предыдущие письма этой переписки:
{{THREAD}}

Только что пришло письмо:
{{LETTER}}

Напиши ответ. Требования:
- Только текст письма, без заголовка, без подписи, без пояснений.
- 2–4 предложения. Голос персонажа: как он говорит в ролевой.
- Никакой современной техники и терминов.
- Если письмо просило о чём-то — ответь по существу, но не обязан соглашаться.
- Можно оставить долгое молчание: ответь коротко и сухо.`;

function situation() {
    try {
        const chat = SillyTavern.getContext()?.chat || [];
        const recent = chat.filter(m => !m.is_system).slice(-8);
        if (!recent.length) return 'История только начинается.';
        return recent
            .map(m => `${m.is_user ? 'игрок' : 'персонаж'}: ${String(m.mes || '').slice(0, 200)}`)
            .join('\n');
    } catch (e) {
        return 'История только начинается.';
    }
}

/** История переписки в промпт: только последние реплики, без разметки. */
export function threadTranscript(thread, limit = 6) {
    return (thread.messages || [])
        .slice(-limit)
        .map(m => `${m.role === 'you' ? 'Игрок' : thread.name}: ${m.text}`)
        .join('\n');
}

async function generateReply(thread) {
    const s = getSettings();
    const last = [...thread.messages].reverse().find(m => m.role === 'you');
    if (!last) return null;

    const prompt = REPLY_PROMPT
        .replace('{{WHO}}', thread.name)
        .replace('{{SITUATION}}', situation())
        .replace('{{THREAD}}', threadTranscript(thread) || '(это первое письмо)')
        .replace('{{LETTER}}', last.text);

    const raw = await generateWithProfile(prompt, { responseLength: Math.min(s.maxTokens, 250) });
    return cleanReply(raw);
}

/** Модель может вернуть лишнее — выкидываем всё до текста письма. */
export function cleanReply(raw) {
    let text = String(raw || '').trim();
    if (!text) return null;

    // Убираем обращения вида "Ответ:" / "Имя —" и markdown-заголовки.
    text = text.replace(/^(?:ответ|отв\.?|письмо|реплика)\s*[:—-]\s*/i, '');
    // ВАЖНО: [ \t], а не \s — иначе съедает переносы строк и склеивает абзацы.
    text = text.replace(/^#{1,6}[ \t]*/gm, '');
    // Заголовок-обёртка вида "Письмо" / "Ответ" отдельной строкой — в текст не годится.
    text = text.replace(/^(?:письмо|ответ|отв\.?|реплика|письмо к [\w]+)[ \t]*$/im, '');
    text = text.replace(/\*\*/g, '');
    // Строки-цитаты в начале письма выбрасываем целиком.
    text = text.split('\n').filter(line => !/^[ \t]*>/.test(line)).join('\n');
    text = text.replace(/^\s*[-—]\s*/, '');
    // Хвост вида "— Илья" или "С уважением, Илья"
    text = text.replace(/(?:\n|^)[ \t]*(?:—[ \t]*)?(?:с уважением|с любовью|ваш[а-я]*|искренне)[^\n]*$/i, '');
    text = text.replace(/(?:\n|^)[ \t]*—[ \t]*[^\n—]{1,40}$/, '');
    text = text.trim();

    if (text.length > 2000) text = text.slice(0, 2000).trim();
    if (!text) return null;

    // Если осталось меньше двух слов — модель, похоже, ответила пустотой.
    if (text.split(/\s+/).filter(Boolean).length < 2) return null;
    return text;
}

// ── Генерация списка адресатов ─────────────────────────────────

const ROSTER_PROMPT = `Кто в этом мире может писать письма? Предложи 3–4 адресата, с которыми интересно вести переписку.

Мир и ролевая (краткое содержание):
{{SITUATION}}

Город: {{CITY}}
Главный персонаж: {{CHAR}}

Формат строго, одна строка на адресата:
"<name>|<kind>|<one_line>"

- name — имя персонажа так, как его зовут в мире
- kind — одно из: character (сам {{CHAR}}), npc (прохожий, торговец, коллега, родня), courier (гонер, курьер)
- one_line — кто это и почему он может писать, одно предложение

Кого НЕ предлагать: вымышленных персонажей из другой вселенной, современных людей, абстрактных сущностей.
Ничего кроме этих строк.`;

function parseRoster(raw) {
    const out = [];
    for (const line of String(raw || '').split('\n')) {
        const t = line.trim();
        if (!t || t.startsWith('```') || !t.includes('|')) continue;
        const [name, kind, note] = t.split('|').map(x => x.trim());
        if (!name || !note) continue;
        const k = ['character', 'npc', 'courier'].includes(kind) ? kind : 'npc';
        out.push({ name, kind: k, note });
    }
    return out;
}

/** Список адресатов, придуманный моделью. Не сохраняется — показывается для выбора. */
export async function generateRoster() {
    const s = getSettings();
    const prompt = ROSTER_PROMPT
        .replace('{{SITUATION}}', situation())
        .replace('{{CITY}}', s.city || 'город из ролевой')
        .replace('{{CHAR}}', getCharacterName() || 'главный персонаж');

    const raw = await generateWithProfile(prompt, { responseLength: Math.min(s.maxTokens, 250) });
    return parseRoster(raw);
}

export function removeThread(id) {
    const meta = getMeta();
    const i = meta.letters.findIndex(t => t.id === id);
    if (i < 0) return false;
    meta.letters.splice(i, 1);
    saveMeta();
    return true;
}

export { LETTER_PREFIX, getCharacterName };