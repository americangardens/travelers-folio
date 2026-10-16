/**
 * Инструкции для модели. Канцелярия подсказывает модели, что в мире есть
 * газета, доска объявлений и кошель, — но не диктует сюжет.
 *
 * В промпт уходит только срез: несколько самых свежих записей. Вся коллекция
 * в чат не попадает, иначе контекст разрастается.
 */

import { setExtensionPrompt, extension_prompt_types, extension_prompt_roles } from '../../../../../script.js';
import { getSettings, getCharacterName } from './state.js';
import { listGazette, assess, isOfficial } from '../modules/gazette.js';
import { listNotices } from '../modules/board.js';
import { purseLine } from '../modules/purse.js';

const CHAT_KEY = 'travelersFolioChat';
const SYS_KEY = 'travelersFolioSys';

const SYS_RULES = `В этом мире персонаж узнаёт новости из газеты, с доски объявлений и от других людей.
Правила:
- Слухи приходят отовсюду и часто неверны. Персонаж может ошибаться, пересказывать неправду или сомневаться.
- Официальные документы достоверны, но их могли прочитать не все: о них знают, но не обсуждают.
- Газета — это бумага. Никто не знает про приложение, телефон, уведомления или интерфейс.
- Достоверность и популярность — разные вещи. Правдивая новость может быть никому не известна.
- Персонаж узнаёт новости только от других персонажей или воочию.`;

function gazetteDigest() {
    let items;
    try { items = listGazette(); } catch (e) { return ''; }
    const lines = items.slice(0, 5).map(item => {
        const a = assess(item);
        const tag = isOfficial(item.kind) ? 'документ' : 'слух';
        return `- [${tag}, правда ${a.truth}%, охват ${a.reach}%] ${item.text}`;
    });
    if (!lines.length) return '';
    return `Из последнего выпуска газеты:\n${lines.join('\n')}`;
}

function boardDigest() {
    let notices;
    try { notices = listNotices(); } catch (e) { return ''; }
    const open = notices.filter(n => !n.taken).slice(0, 3);
    if (!open.length) return '';
    return `На доске объявлений:\n${open.map(n => `- ${n.title} (${n.author})`).join('\n')}`;
}

function purseDigest() {
    try {
        const line = purseLine();
        return line ? `В кошеле: ${line}.` : '';
    } catch (e) {
        return '';
    }
}

function updateFolioInjection() {
    const s = getSettings();
    if (!s.enabled || !s.injectPrompt) {
        setExtensionPrompt(CHAT_KEY, '', extension_prompt_types.IN_CHAT, 0);
        setExtensionPrompt(SYS_KEY, '', extension_prompt_types.IN_PROMPT, 0);
        return;
    }

    setExtensionPrompt(SYS_KEY, SYS_RULES, extension_prompt_types.IN_PROMPT, 0);

    const parts = ['Открытая канцелярия. Бумаги в папке — всё, что персонаж знает из города.'];
    for (const digest of [gazetteDigest(), boardDigest(), purseDigest()]) {
        if (digest) parts.push(digest);
    }
    setExtensionPrompt(CHAT_KEY, parts.join('\n\n'), extension_prompt_types.IN_CHAT, 0, false, extension_prompt_roles.USER);
}

export { updateFolioInjection, gazetteDigest, boardDigest, purseDigest, getCharacterName };