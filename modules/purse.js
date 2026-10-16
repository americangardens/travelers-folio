/**
 * Кошель — монеты придумывает модель, а не расширение.
 *
 * Жёстко прописать «золотые/серебряные» — значит насиловать любой мир:
 * в Виченце это флорины, в Мекохо — тезтланти, где-то на севере — эйр.
 * Поэтому валюта генерируется из контекста ролевой и хранится в чате.
 *
 * До генерации кошель пустой: никаких золотых из воздуха.
 */

import { generateWithProfile } from '../core/generation.js';
import { getMeta, saveMeta, getSettings, getCharacterName } from '../core/state.js';

const uid = () => 't-' + Math.random().toString(36).slice(2, 10);

export function getPurse() {
    return getMeta().purse;
}

export function hasCurrency() {
    return !!getPurse().currency?.generated;
}

/** Номиналы по возрастанию стоимости — нужно для арифметики. */
export function denominationScale() {
    const cur = getPurse().currency;
    if (!cur?.generated || !Array.isArray(cur.denominations)) return [];
    return [...cur.denominations].sort((a, b) => a.value - b.value);
}

const CURRENCY_PROMPT = `Придумай денежную систему для этого мира.

Мир и ролевая (краткое содержание):
{{SITUATION}}

Город/страна: {{CITY}}
Главный персонаж: {{CHAR}}

Нужно 3–4 номинала, от мелкой монеты до крупной.

Формат строго, каждая строка — один номинал:
"<name>|<plural>|<value>"

- name — название одной монеты: "медяк", "монета с гусом", "золотой"
- plural — название счётного множества или принятая форма: "медяков", "золотых"
- value — сколько базовых монет в номинале. Первая строка всегда value=1,
  каждая следующая больше предыдущей и обычно кратна ей (1, 10, 50).

ВАЖНО: бери название из мира ролевой, не придумывай абстрактное.
После строк добавь последней строкой общую единицу, у неё два поля:
"<unit>|<plural_of_unit>" — например "монета|монет".

Пример:
медяк|медяков|1
серебряк|серебряков|10
золотой|золотых|50
монета|монет

Ничего кроме этих строк: без пояснений и нумерации.`;

function situation() {
    try {
        const chat = SillyTavern.getContext()?.chat || [];
        const recent = chat.filter(m => !m.is_system).slice(-10);
        if (!recent.length) return 'История только начинается.';
        return recent
            .map(m => `${m.is_user ? 'игрок' : 'персонаж'}: ${String(m.mes || '').slice(0, 200)}`)
            .join('\n');
    } catch (e) {
        return 'История только начинается.';
    }
}

function parse(raw) {
    const rows = [];
    let unit = '', plural = '';
    for (const line of String(raw || '').split('\n')) {
        const t = line.trim();
        if (!t || t.startsWith('```')) continue;
        const parts = t.split('|').map(x => x.trim());

        // Общая единица идёт последней строкой и имеет только два поля:
        // "монета|монет". Проверяем её ПЕРЕД фильтром по длине.
        if (parts.length === 2 && parts[0] && parts[1] && !Number.isFinite(Number(parts[1]))) {
            unit = parts[0]; plural = parts[1];
            continue;
        }
        if (parts.length < 3) continue;

        const value = Number(parts[2]);
        if (!Number.isFinite(value) || value <= 0) continue;
        if (!parts[0] || !parts[1]) continue;
        rows.push({ name: parts[0], plural: parts[1], value });
    }
    if (!rows.length) return null;

    // Модель может ошибиться в порядке — чиним. Значения не округляем:
// в реальных мирах номиналы не обязаны быть кратны друг другу (1, 3, 14),
// а каскадное округление портило бы исходные числа.
    rows.sort((a, b) => a.value - b.value);
    rows[0].value = 1;
    for (let i = 1; i < rows.length; i++) {
        // Номиналы должны строго возрастать, иначе арифметика бессмысленна.
        if (rows[i].value <= rows[i - 1].value) rows[i].value = rows[i - 1].value + 1;
    }
    if (!unit) { unit = rows[0].name; plural = rows[0].plural; }
    return { unit, plural, denominations: rows };
}

/** Один раз за чат: придумать валюту мира. */
export async function generateCurrency() {
    const s = getSettings();
    const prompt = CURRENCY_PROMPT
        .replace('{{SITUATION}}', situation())
        .replace('{{CITY}}', s.city || 'страна из ролевой')
        .replace('{{CHAR}}', getCharacterName() || 'герой истории');

    const raw = await generateWithProfile(prompt, { responseLength: Math.min(s.maxTokens, 250) });
    const parsed = parse(raw);
    if (!parsed) return null;

    const purse = getPurse();
    purse.currency = { ...parsed, generated: true, createdAt: Date.now() };
    purse.amounts = {};
    purse.ledger = [];
    saveMeta();
    return purse.currency;
}

// ── Арифметика ─────────────────────────────────────────────────
// Суммы считаем в базовых монетах, а amounts хранит количество КАЖДОГО номинала.

function totalBase() {
    const purse = getPurse();
    let sum = 0;
    for (const d of denominationScale()) sum += (purse.amounts[d.name] || 0) * d.value;
    return sum;
}

function splitAmount(baseTotal) {
    const out = {};
    let left = Math.max(0, Math.round(baseTotal));
    const scale = denominationScale();
    for (let i = scale.length - 1; i >= 0; i--) {
        const d = scale[i];
        const count = Math.floor(left / d.value);
        if (count > 0) out[d.name] = count;
        left -= count * d.value;
    }
    return out;
}

export function earn(baseAmount, reason = '') {
    if (!hasCurrency() || baseAmount <= 0) return false;
    const purse = getPurse();
    for (const [name, count] of Object.entries(splitAmount(baseAmount))) {
        purse.amounts[name] = (purse.amounts[name] || 0) + count;
    }
    if (reason) pushLedger(reason, baseAmount);
    saveMeta();
    return true;
}

export function spend(baseAmount, reason = '') {
    if (!hasCurrency() || baseAmount <= 0) return false;
    if (totalBase() < baseAmount) return false;
    const purse = getPurse();
    let left = Math.round(baseAmount);
    // Сначала тратим мелочь, чтобы сдача не терялась.
    for (const d of denominationScale()) {
        const have = purse.amounts[d.name] || 0;
        const take = Math.min(have, Math.floor(left / d.value));
        purse.amounts[d.name] = have - take;
        left -= take * d.value;
    }
    if (reason) pushLedger(reason, -baseAmount);
    saveMeta();
    return true;
}

function pushLedger(reason, delta) {
    const purse = getPurse();
    if (!Array.isArray(purse.ledger)) purse.ledger = [];
    purse.ledger.unshift({ id: uid(), reason, delta, at: Date.now() });
    purse.ledger.length = Math.min(purse.ledger.length, 30);
}

export function listLedger() {
    return getPurse().ledger || [];
}

export function purseLine() {
    if (!hasCurrency()) return '';
    const purse = getPurse();
    const parts = denominationScale()
        .map(d => ({ d, n: purse.amounts[d.name] || 0 }))
        .filter(x => x.n > 0)
        .map(x => `${x.n} ${x.d.plural}`);
    return parts.length ? parts.join(', ') : 'пусто';
}

export function purseTotal() {
    return totalBase();
}