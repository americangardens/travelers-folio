/**
 * Проверка доменной логики без SillyTavern: две оси газеты, парсеры, кошелёк.
 * Запуск: node test/logic.test.mjs
 *
 * Чистые функции вынимаются из исходников и выполняются с заглушками —
 * так тесты ловят ошибки формул, не требуя запущенного ST.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

/** Вырезает тело функции из исходника по имени. */
function extract(src, name) {
    const start = src.indexOf(`function ${name}(`);
    if (start < 0) throw new Error(`нет функции ${name}`);
    let i = src.indexOf('{', start), depth = 0;
    for (; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}') { depth--; if (!depth) { i++; break; } }
    }
    return src.slice(start, i);
}

let failed = 0;
function check(name, actual, expected) {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    if (!ok) failed++;
    console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${ok ? '' : `\n        ожидал ${JSON.stringify(expected)}, получил ${JSON.stringify(actual)}`}`);
}
const section = (t) => console.log(`\n— ${t} —`);
const pick = (a) => ({ truth: a.truth, reach: a.reach });

// ── Заглушки, повторяющие константы модулей ────────────────────

const DAY_MS = 86400000;
const RUMOR_KINDS = {
    herald: { truth: 55, truthDecay: 8,  reach: 90, reachDecay: 12 },
    court:  { truth: 65, truthDecay: 5,  reach: 45, reachDecay: 10 },
    market: { truth: 45, truthDecay: 10, reach: 70, reachDecay: 8 },
    tavern: { truth: 25, truthDecay: 15, reach: 80, reachDecay: 6 },
    street: { truth: 35, truthDecay: 12, reach: 65, reachDecay: 9 },
};
const OFFICIAL_KINDS = {
    edict:    { truth: 95, truthDecay: 0, reach: 20, reachDecay: 8 },
    manifest: { truth: 95, truthDecay: 0, reach: 30, reachDecay: 8 },
    tax:      { truth: 95, truthDecay: 0, reach: 25, reachDecay: 8 },
    priest:   { truth: 85, truthDecay: 0, reach: 35, reachDecay: 7 },
};
const ALL_KINDS = { ...RUMOR_KINDS, ...OFFICIAL_KINDS };
const REACTION_DELTA = { support: 2, doubt: -3, spread: 4 };

const clamp = (v, a = 0, b = 100) => Math.max(a, Math.min(b, v));
const band = (v, stops) => { for (const [l, n] of stops) if (v >= l) return n; return stops[stops.length - 1][1]; };
const TRUTH_BANDS = [[90, 'sure'], [65, 'likely'], [40, 'maybe'], [1, 'doubtful'], [0, 'dead']];
const REACH_BANDS = [[70, 'wide'], [40, 'some'], [1, 'few'], [0, 'none']];
const TRUTH_LABEL = {
    sure: 'Почти наверняка', likely: 'Скорее правда', maybe: 'Возможно правда',
    doubtful: 'Сомнительно', dead: 'Никто не подтвердил', refuted: 'Опровергнуто',
};
const REACH_LABEL = { wide: 'Все обсуждают', some: 'Обсуждают', few: 'Потихо', none: 'Только в канцелярии' };
const kindOf = (item) => ALL_KINDS[item.kind] || RUMOR_KINDS.street;

const gazetteSrc = read('modules/gazette.js');
const assess = new Function(
    'ALL_KINDS', 'REACTION_DELTA', 'clamp', 'band', 'TRUTH_BANDS', 'REACH_BANDS',
    'TRUTH_LABEL', 'REACH_LABEL', 'kindOf', 'DAY_MS',
    extract(gazetteSrc, 'assess') + '; return assess;'
)(ALL_KINDS, REACTION_DELTA, clamp, band, TRUTH_BANDS, REACH_BANDS, TRUTH_LABEL, REACH_LABEL, kindOf, DAY_MS);

const parseLines = new Function('RUMOR_KEYS', 'OFFICIAL_KEYS',
    extract(gazetteSrc, 'parseLines') + '; return parseLines;')(
    Object.keys(RUMOR_KINDS), Object.keys(OFFICIAL_KINDS));

const purseSrc = read('modules/purse.js');
const parseCur = new Function(extract(purseSrc, 'parse') + '; return parse;')();

// ── 1. Достоверность ───────────────────────────────────────────

section('Достоверность слуха');
const now = Date.now();
check('свежий рыночный: правда 45, охват 70',
    pick(assess({ kind: 'market', createdAt: now, reactions: [] })), { truth: 45, reach: 70 });
check('таверный за 2 суток: правда 0, охват 68',
    pick(assess({ kind: 'tavern', createdAt: now - 2 * DAY_MS, reactions: [] })), { truth: 0, reach: 68 });
check('8 подтверждений = +16 правды',
    assess({ kind: 'market', createdAt: now, reactions: Array(8).fill({ type: 'support' }) }).truth, 61);
check('6 сомнений = −18 правды',
    assess({ kind: 'market', createdAt: now, reactions: Array(6).fill({ type: 'doubt' }) }).truth, 27);
check('правда не падает ниже нуля',
    assess({ kind: 'tavern', createdAt: now - 30 * DAY_MS, reactions: [] }).truth, 0);
check('правда не растёт выше ста',
    assess({ kind: 'edict', createdAt: now, reactions: Array(99).fill({ type: 'support' }) }).truth, 100);

// ── 2. Охват ───────────────────────────────────────────────────

section('Охват');
check('10 пересказов = +40 охвата',
    assess({ kind: 'market', createdAt: now, reactions: Array(10).fill({ type: 'spread' }) }).reach, 100);
check('охват слуха и указа различается',
    [assess({ kind: 'street', createdAt: now, reactions: [] }).reach,
     assess({ kind: 'edict', createdAt: now, reactions: [] }).reach], [65, 20]);

// ── 3. Официальное ─────────────────────────────────────────────

section('Официальное: правда без угасания');
check('указ через год всё ещё правдив',
    assess({ kind: 'edict', createdAt: now - 365 * DAY_MS, reactions: [] }).truth, 95);
check('но указ почти никто не обсуждает',
    assess({ kind: 'edict', createdAt: now - 365 * DAY_MS, reactions: [] }).reach, 0);
check('проповедь: правда 85, охват 35',
    pick(assess({ kind: 'priest', createdAt: now, reactions: [] })), { truth: 85, reach: 35 });

// ── 4. Две оси независимы ──────────────────────────────────────

section('Две оси независимы');
check('сомнения не трогают охват',
    assess({ kind: 'market', createdAt: now, reactions: Array(5).fill({ type: 'doubt' }) }).reach, 70);
check('подтверждения не трогают охват',
    assess({ kind: 'market', createdAt: now, reactions: Array(5).fill({ type: 'support' }) }).reach, 70);
check('пересказ не трогает правду',
    assess({ kind: 'tavern', createdAt: now, reactions: Array(5).fill({ type: 'spread' }) }).truth, 25);

// ── 5. Метки ───────────────────────────────────────────────────

section('Метки');
check('опровергнутый: правда 0, метка «Опровергнуто»',
    [assess({ kind: 'street', createdAt: now, reactions: [], refuted: true }).truth,
     assess({ kind: 'street', createdAt: now, reactions: [], refuted: true }).truthLabel], [0, 'Опровергнуто']);
check('указ = «Почти наверняка»', assess({ kind: 'edict', createdAt: now, reactions: [] }).truthLabel, 'Почти наверняка');
check('угасло = «Никто не подтвердил»',
    assess({ kind: 'tavern', createdAt: now - 10 * DAY_MS, reactions: [] }).truthLabel, 'Никто не подтвердил');
check('широкий охват = «Все обсуждают»',
    assess({ kind: 'market', createdAt: now, reactions: Array(3).fill({ type: 'spread' }) }).reachLabel, 'Все обсуждают');

// ── 6. Парсер выпуска ──────────────────────────────────────────

section('Разбор выпуска');
check('слухи и документы разобраны, мусор отброшен', parseLines([
    '```',
    'herald|Ночью у моста видели караван с севера|Глашатай Илья|Королевские ворота',
    'market|У дверей гильдии не было стражи|Торговец Оддо|Рыночная площадь',
    'edict|Указ|Законный сургуч|Со всеми подданными повелеваю награждать тех, кто укроет беглого.',
    'nonsense|строка с неизвестным типом|текст|место',
    'мусор без разделителей',
].join('\n')), [
    { kind: 'herald', text: 'Ночью у моста видели караван с севера', source: 'Глашатай Илья', place: 'Королевские ворота' },
    { kind: 'market', text: 'У дверей гильдии не было стражи', source: 'Торговец Оддо', place: 'Рыночная площадь' },
    { kind: 'edict', text: 'Указ. Со всеми подданными повелеваю награждать тех, кто укроет беглого.', seal: 'Законный сургуч' },
]);

// ── 7. Валюта ──────────────────────────────────────────────────

section('Валюта от модели');
check('номиналы разобраны, единица отделена', parseCur([
    'медяк|медяков|1',
    'серебряк|серебряков|10',
    'золотой|золотых|50',
    'монета|монет',
].join('\n')), {
    unit: 'монета', plural: 'монет',
    denominations: [
        { name: 'медяк', plural: 'медяков', value: 1 },
        { name: 'серебряк', plural: 'серебряков', value: 10 },
        { name: 'золотой', plural: 'золотых', value: 50 },
    ],
});
check('перепутанный порядок чинится',
    parseCur(['золотой|золотых|50', 'медяк|медяков|1', 'серебряк|серебряков|10'].join('\n')).denominations.map(d => d.value), [1, 10, 50]);
check('некратные номиналы сохраняются как есть',
    parseCur(['медяк|медяков|1', 'серебряк|серебряков|7', 'золотой|золотых|50'].join('\n')).denominations.map(d => d.value), [1, 7, 50]);
check('одинаковые номиналы разводятся, чтобы не ломалась арифметика',
    parseCur('медяк|медяков|1\nсеребряк|серебряков|1\nзолотой|золотых|1').denominations.map(d => d.value), [1, 2, 3]);
check('обратный порядок сортируется',
    parseCur('золотой|золотых|100\nмедяк|медяков|1').denominations.map(d => d.value), [1, 100]);
check('первая монета всегда 1', parseCur(['полтинник|полтинников|5']).denominations[0].value, 1);
check('ответ без номиналов = null', parseCur('монета|монет\nпустой ответ'), null);
check('строка без названия монеты отброшена', parseCur('|10'), null);
check('ноль считается неденоминацией', parseCur('|монет\n'), null);

// ── 8. Арифметика ──────────────────────────────────────────────

section('Арифметика кошелька');
const scale = parseCur('медяк|медяков|1\nсеребряк|серебряков|10\nзолотой|золотых|50').denominations;
const split = (base) => {
    const out = {};
    let left = Math.max(0, Math.round(base));
    for (let i = scale.length - 1; i >= 0; i--) {
        const d = scale[i];
        const c = Math.floor(left / d.value);
        if (c > 0) out[d.name] = c;
        left -= c * d.value;
    }
    return out;
};
check('125 = 2 золотых, 2 серебряка, 5 медяков', split(125), { золотой: 2, серебряк: 2, медяк: 5 });
check('50 = ровно один золотой', split(50), { золотой: 1 });
check('нуль = пусто', split(0), {});
check('49 не даёт золотого', split(49), { серебряк: 4, медяк: 9 });
check('сумма не теряется',
    Object.entries(split(1234)).reduce((s, [n, c]) => s + c * scale.find(d => d.name === n).value, 0), 1234);

// ── Итог ───────────────────────────────────────────────────────

console.log(failed ? `\n${failed} проверок упало\n` : '\nВсе проверки прошли\n');
process.exit(failed ? 1 : 0);