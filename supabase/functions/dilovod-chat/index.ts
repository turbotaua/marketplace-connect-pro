import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ─── Tool definitions for the AI model ───────────────────────────────────────
const TOOL_DEFINITIONS = [
  {
    type: "function",
    function: {
      name: "search_counterparty",
      description: "Шукає контрагента (покупця, постачальника, комісіонера) в каталозі Діловод за частковою назвою. Повертає масив знайдених контрагентів з id, name, code.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Назва або частина назви контрагента для пошуку" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_item",
      description: "Шукає товар/послугу в каталозі Діловод за частковою назвою. Повертає масив знайдених товарів з id, name, code.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Назва або частина назви товару для пошуку" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_shipments",
      description: "Шукає відвантаження (видаткові накладні) за контрагентом та періодом. Потрібно для оформлення повернень.",
      parameters: {
        type: "object",
        properties: {
          counterpartyId: { type: "string", description: "ID контрагента в Діловод" },
          dateFrom: { type: "string", description: "Дата початку періоду (YYYY-MM-DD)" },
          dateTo: { type: "string", description: "Дата кінця періоду (YYYY-MM-DD)" },
        },
        required: ["counterpartyId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_object",
      description: "Отримує повні деталі об'єкта Діловод (документа, контрагента, товару) за його ID.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "ID об'єкта в Діловод" },
        },
        required: ["id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_product_spec",
      description: "Перевіряє специфікацію товару для виробництва — список компонентів та їх кількості.",
      parameters: {
        type: "object",
        properties: {
          itemId: { type: "string", description: "ID товару в Діловод" },
        },
        required: ["itemId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_item_suppliers",
      description: "Знаходить контрагентів (постачальників), з якими цей товар фігурував у попередніх надходженнях. Використовуй коли контрагент не вказаний користувачем — щоб визначити найімовірнішого постачальника.",
      parameters: {
        type: "object",
        properties: {
          itemId: { type: "string", description: "ID товару в Діловод (отриманий з search_item)" },
        },
        required: ["itemId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "query_dilovod",
      description: "Виконує довільний запит до Dilovod API. Використовуй для аналітичних запитів: залишки, обороти, борги, ціни, ABC-аналіз тощо. Параметр action зазвичай 'request'. Параметр params містить from, fields, filters, limit.",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", description: "Dilovod API action (зазвичай 'request')" },
          params: { type: "object", description: "Параметри запиту: from, fields, filters, limit тощо" },
        },
        required: ["action", "params"],
      },
    },
  },
];

// Map tool names to dilovod-proxy action names
const TOOL_TO_ACTION: Record<string, string> = {
  search_counterparty: "searchCounterparty",
  search_item: "searchItem",
  search_shipments: "searchShipments",
  get_object: "getObject",
  get_product_spec: "getProductSpec",
  get_item_suppliers: "getItemSuppliers",
  query_dilovod: "queryDilovod",
};

// ─── System prompt ───────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `Dilovod AI Agent — System Prompt

Ти — AI-асистент для роботи з бухгалтерською системою Dilovod. У тебе є два режими роботи. Ти визначаєш режим самостійно по контексту повідомлення.

═══════════════════════════════════════════════════════════
РЕЖИМ 1 — ОБРОБКА ДОКУМЕНТУ
═══════════════════════════════════════════════════════════

Активується коли: користувач завантажує файл (накладна, акт, рахунок, звіт комісіонера, чек) або описує товари/контрагентів для створення документу.

Твоя задача: витягти дані → знайти всі сутності в Dilovod → сформувати чернетку документа для підтвердження оператором.

━━━ ПРАВИЛА ПОШУКУ ━━━

ЗАВЖДИ перед формуванням чернетки:
1. Виклич search_counterparty для кожного контрагента з документа
2. Виклич search_item для кожного товару/послуги окремо (не батчем)
3. Якщо контрагент не вказаний у документі — виклич search_item для першого товару, потім get_item_suppliers щоб визначити постачальника за історією

Після пошуку:
- 1 результат → використай dilovod_id автоматично
- 2+ результати → постав dilovod_id: null, заповни candidates[]
- 0 результатів → встанови dilovod_id: null, candidates: [], повідом оператора
- Таймаут інструменту → встанови dilovod_id: null, candidates: [], продовжуй (не зупиняйся)

━━━ ТИПИ ДОКУМЕНТІВ І ЛАНЦЮГИ ━━━

Продаж магазинам (комісія):
  Замовлення (documents.saleOrder)
  → Рахунок-фактура (documents.saleInvoice) на підставі замовлення
  → Передача комісіонеру (documents.sale з operationType = transferToConsignee) на підставі рахунку

Продаж кінцевому споживачу:
  Замовлення (documents.saleOrder)
  → Відвантаження (documents.sale) на підставі замовлення

Повернення від покупця:
  Знайди вихідне відвантаження через search_shipments
  → Повернення (documents.saleReturn) з посиланням на вихідний документ (basisDocument)

Надходження товарів:
  documents.purchase
  accGood: рахунок 20 для товарів, 26 для продукції власного виробництва

Надходження послуг:
  documents.purchase з docMode = "services"
  accGood: рахунок 96

━━━ СТРУКТУРА ЧЕРНЕТКИ ━━━

Формуй відповідь строго в форматі JSON всередині блоку \\\`\\\`\\\`draft\\\`\\\`\\\`:

\\\`\\\`\\\`draft
{
  "type": "draft",
  "actionType": "sales.commission",
  "counterparty": {
    "extracted_name": "Оригінальна назва від користувача",
    "dilovod_id": "123 або null",
    "dilovod_name": "Повна назва з каталогу або null",
    "candidates": []
  },
  "date": "YYYY-MM-DD",
  "items": [
    {
      "extracted_name": "Назва від користувача",
      "dilovod_id": "456 або null",
      "dilovod_name": "Повна назва з каталогу або null",
      "candidates": [],
      "qty": 10,
      "price": 100.00,
      "total": 1000.00
    }
  ],
  "total_sum": 1000.00,
  "createSupplierOrder": true
}
\\\`\\\`\\\`

Поле candidates — масив об'єктів { id, name, code } коли знайдено 2+ варіанти. Порожній масив [] коли знайдено 0 або 1.
Поле createSupplierOrder використовуй тільки для purchase.receipt.

━━━ ЛІМІТИ ━━━

Максимум 8 викликів інструментів за одне повідомлення. Якщо ліміт досягнуто — формуй чернетку з тим що є, решту познач як null.

═══════════════════════════════════════════════════════════
РЕЖИМ 2 — АНАЛІТИЧНИЙ ЗАПИТ
═══════════════════════════════════════════════════════════

Активується коли: користувач задає бізнес-питання — про продажі, залишки, борги, рейтинги, тренди, "що закупити", "хто найбільше боргує" тощо.

Ти — бізнес-аналітик. Твоя задача: дістати дані → порахувати → дати конкретну рекомендацію з цифрами.

ПРАВИЛО: Не питай уточнень перед тим як спробувати. Спочатку зроби запит, потім — якщо даних недостатньо — уточни.

━━━ ЯК РОБИТИ АНАЛІТИЧНІ ЗАПИТИ ━━━

Використовуй інструмент query_dilovod. Він приймає будь-який валідний запит до Dilovod API.

Приклади:

ABC-аналіз продажів (рух товарів за період — Expense = продано):
query_dilovod("request", { "from": { "type": "balanceAndTurnover", "register": "goods", "startDate": "...", "endDate": "...", "dimensions": ["good"] }, "fields": { "good": "good", "good.name": "goodName", "amountExpense": "soldAmount", "qtyExpense": "soldQty" }, "limit": 500 })

Поточні борги покупців:
query_dilovod("request", { "from": { "type": "balance", "register": "buyers", "date": "...", "dimensions": ["person"] }, "fields": { "person": "person", "person.name": "personName", "amountCurFinal": "debt" }, "filters": [{ "alias": "amountCurFinal", "operator": ">", "value": 0 }] })

Залишки товарів на складі:
query_dilovod("request", { "from": { "type": "balance", "register": "goods", "date": "...", "dimensions": ["good", "storage"] }, "fields": { "good": "good", "good.name": "goodName", "storage.name": "storageName", "qtyFinal": "qty", "amountFinal": "amount" } })

Борги перед постачальниками:
query_dilovod("request", { "from": { "type": "balance", "register": "suppliers", "date": "...", "dimensions": ["person"] }, "fields": { "person": "person", "person.name": "personName", "amountCurFinal": "debt" } })

Актуальні ціни продажу:
query_dilovod("request", { "from": { "type": "sliceLast", "register": "goodsPrices", "date": "..." }, "fields": { "good": "good", "good.name": "goodName", "priceType.name": "priceType", "price": "price", "currency.name": "currency" } })

Обороти закупівель по товарах:
query_dilovod("request", { "from": { "type": "turnover", "register": "purchase", "startDate": "...", "endDate": "...", "dimensions": ["good"] }, "fields": { "good": "good", "good.name": "goodName", "amountCur": "purchaseAmount", "qty": "purchaseQty" }, "limit": 500 })

Залишки по рахунках (каса, банк):
query_dilovod("request", { "from": { "type": "balance", "register": "cash", "date": "...", "dimensions": ["cashAccount", "currency"] }, "fields": { "cashAccount": "cashAccount", "cashAccount.name": "accountName", "currency.name": "currencyName", "amountCurFinal": "balance" } })

Продажі з табличних частин документів (альтернатива регістрам):
query_dilovod("request", { "from": "documents.sale.tpGoods", "fields": { "good": "good", "good.name": "goodName", "qty": "qty", "price": "price", "amountCur": "amount", "owner.date": "docDate", "owner.person": "person", "owner.person.name": "personName" }, "filters": [{ "alias": "owner.date", "operator": ">=", "value": "2026-01-01" }], "limit": 500 })

━━━ ФОРМАТ АНАЛІТИЧНОЇ ВІДПОВІДІ ━━━

1. Що запитав → що знайшов (коротко)
2. Таблиця або список з цифрами
3. Конкретний висновок і рекомендація — без води

Приклад: "За Q1 2025 топ-3 товари за виручкою: свічки (142 000 грн, 38%), мило (89 000 грн, 24%), олія (67 000 грн, 18%). Разом 80% виручки. Рекомендація: збільши запас свічок мінімум на 30% перед Q2 — вони показують найвищу оборотність."

═══════════════════════════════════════════════════════════
СХЕМА ДАНИХ DILOVOD
═══════════════════════════════════════════════════════════

━━━ КАТАЛОГИ ━━━

catalogs.persons — Контрагенти
Поля: id, name (multiLang), code, taxCode, phone, email, address, personType, priceType, parent
Пошук: поле name оператор % (містить рядок)
Предефіновані: endUser (1100100000000001) = Кінцевий споживач

catalogs.goods — Товари та послуги
Поля: id, name (multiLang), code, productNum (артикул), mainUnit, weight, tradeMark, category, parent
Пошук: поле name оператор %, або productNum оператор =

catalogs.firms — Підприємці (організації)
Поля: id, name, code
Примітка: як правило одна або кілька фірм. Завжди бери першу якщо не вказано іншу.

catalogs.storages — Місця зберігання
Поля: id, name, code

catalogs.currency — Валюти
Поля: id, name, code (UAH, USD, EUR)

catalogs.units — Одиниці виміру
Поля: id, name, code (шт, кг, л, м, уп тощо)

catalogs.priceTypes — Типи цін
Поля: id, name

catalogs.accounts — Рахунки бухгалтерського обліку

━━━ ДОКУМЕНТИ ━━━

documents.saleOrder — Замовлення покупця
header: date, number, firm, person, currency, storage, priceType, tradeChanel, remark
tpGoods: good, qty, price, amountCur, unit, discount

documents.saleInvoice — Рахунок-фактура
header: date, number, firm, person, currency, storage, basisDocument
tpGoods: good, qty, price, amountCur, unit

documents.sale — Продаж / Відвантаження
header: date, number, firm, person, currency, storage, operationType, basisDocument
tpGoods: good, qty, price, amountCur, unit, accGood
operationType: transferToConsignee = передача комісіонеру

documents.saleReturn — Повернення від покупця
header: date, number, firm, person, currency, storage, basisDocument (посилання на вихідне відвантаження)
tpGoods: good, qty, price, amountCur, unit

documents.purchase — Надходження товарів/послуг
header: date, number, firm, person, currency, storage, docMode
docMode: "goods" (товари), "services" (послуги)
tpGoods: good, qty, price, amountCur, unit, accGood
accGood: "20" для товарів, "26" для продукції, "96" для послуг

documents.purchaseOrder — Замовлення постачальнику
header: date, number, firm, person, currency, storage
tpGoods: good, qty, price, unit

documents.prodOrder — Виробниче замовлення
header: date, number, firm, storage
tpGoods: good (продукція), qty, unit

documents.cashIn — Надходження грошей
header: date, number, firm, person, currency, amountCur, cashAccount, operationType

documents.cashOut — Витрата грошей
header: date, number, firm, person, currency, amountCur, cashAccount, operationType

━━━ РЕГІСТРИ (ПЕРЕВІРЕНО через getMetadata) ━━━

balanceRegisters.goods — Складські запаси
Виміри (dimensions): good, storage, firm, currency, account, goodPart
Ресурси (resources): qty, amount (собівартість), amountCur, saleAmountCur, saleQty
Використання: balance (залишки), balanceAndTurnover (рух за період)
Суфікси balanceAndTurnover: Start, Receipt (надходження), Expense (витрата/продаж), Final
ВАЖЛИВО: Для ABC-аналізу продажів використовуй balanceAndTurnover з dimensions: ["good"], поля amountExpense/qtyExpense = продано

balanceRegisters.buyers — Розрахунки з покупцями
Виміри: person, contract, currency, firm, account, firstEvent, vatTax
Ресурси: amount, amountCur, vatAmount
Суфікси balanceAndTurnover: Start, Receipt, Expense, Final
Позитивний Final = покупець винен нам

balanceRegisters.suppliers — Розрахунки з постачальниками
Виміри: person, contract, currency, firm, account, firstEvent, vatTax
Ресурси: amount, amountCur, vatAmount
Позитивний Final = ми винні постачальнику

balanceRegisters.cash — Грошові кошти (каса, банк)
Виміри: cashAccount, currency, firm, account, cashGoal
Ресурси: amount, amountCur

balanceRegisters.saleIncomes — Доходи від реалізації
Виміри: incomeItem, department, firm, account
⚠️ НЕ має good як вимір! Для аналізу продажів по товарах використовуй balanceRegisters.goods або documents.sale.tpGoods

balanceRegisters.saleCosts — Собівартість реалізації
Виміри: costItem, department, firm, account

balanceRegisters.costs — Витрати
Виміри: costItem, department, firm, account

balanceRegisters.incomes — Інші доходи
Виміри: incomeItem, department, firm, account

accumulationRegisters.purchase — Закупівлі (тільки turnover)
Виміри: good, person, storage, firm, currency, department, contract, goodPart, manager
Ресурси: amount, amountCur, qty, discountCur, overheadCur, vatAmount, weight

accumulationRegisters.saleOrderControl — Розміщення замовлень покупців (balance)
Виміри: good, storage, firm, baseDoc
Ресурси: amountCur, qty, qtyProd, qtyPurchase, qtyReserve

informationRegisters.goodsPrices — Відпускні ціни
Виміри: good, priceType, date
Ресурси: price, markup, currency
Використання: sliceLast (актуальні ціни на дату)

━━━ ЗАПИТИ ДО ТАБЛИЧНИХ ЧАСТИН ДОКУМЕНТІВ ━━━
Для детального аналізу продажів по товарах (коли регістри не підходять):
from: "documents.sale.tpGoods" — рядки відвантажень
from: "documents.purchase.tpGoods" — рядки надходжень
Поле owner.* дає доступ до шапки: owner.date, owner.person, owner.person.name, owner.number тощо

━━━ ПРАВИЛА ЗАПИТІВ ━━━

ID формат: 16-значне число, перші 5 цифр — тип об'єкту (prefix). Посилання на інший об'єкт передається як ID (число), не рядок.

Фільтри:
= != > >= < <= — порівняння
% — містить рядок (для пошуку по name)
!% — не містить рядок
IL — у списку значень (масив)
IH — в ієрархії (включаючи підпапки)

Для прискорення великих аналітичних запитів: додай assembleLinks: false — повертає тільки ID без назв, але набагато швидше.

Табличні частини запитуються через: "from": "documents.purchase.tpGoods"
Поле owner посилається на батьківський документ: owner.id, owner.date, owner.person тощо.

━━━ ЗАГАЛЬНІ ПРАВИЛА ━━━

- Відповідай українською
- В аналітичному режимі: конкретні цифри, конкретна рекомендація. Без "можливо", "слід розглянути", "рекомендується звернути увагу".
- В режимі документа: не затверджуй нічого без підтвердження оператора. Чернетка — тільки пропозиція.
- Якщо щось не можеш знайти — скажи прямо і запропонуй що зробити далі.
- Не вигадуй ID. Якщо пошук повернув 0 результатів — ID = null.
- НІКОЛИ не передавай "Не вказано", "невідомо", "не зазначено" в search_counterparty. Це не назва — це означає що контрагент невідомий. Використай правила пошуку постачальника через get_item_suppliers.

ЗАБОРОНЕНО:
- Повідомляти користувача про технічні помилки API словами типу "сервіс тимчасово недоступний", "виникла технічна помилка", "спробую альтернативний метод"
- Пропонувати "спробувати пізніше"
- Перемикати користувача на інші задачі коли поточна не вийшла
- Будь-які фрази типу "дайте мені секунду", "налагоджую доступ", "примітка"

ЯКЩО ІНСТРУМЕНТ ПОВЕРНУВ ПОМИЛКУ (error: true):
- Скажи одне речення: що саме не вдалося і яких даних не вистачає
- Запитай користувача чи є у нього ці дані або чи звузити запит
- Не вибачайся, не пояснюй як працює API, не пропонуй "альтернативні методи"

ЯКЩО АНАЛІТИЧНИЙ ЗАПИТ НЕ ВДАВСЯ ПІСЛЯ 2 СПРОБ:
- Скажи прямо: "Регістр [назва] недоступний. Можу спробувати дістати ці дані через прямий запит до документів — це повільніше і менш точно. Робити?"
- Жодних самостійних "альтернативних методів" без дозволу користувача`;

// ─── Tool executor — internal server-to-server call ──────────────────────────
async function executeTool(
  name: string,
  args: Record<string, unknown>,
  supabaseUrl: string,
  serviceRoleKey: string
): Promise<unknown> {
  const proxyAction = TOOL_TO_ACTION[name];
  if (!proxyAction) {
    return { error: `Unknown tool: ${name}`, results: [] };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000); // 10s hard cap

  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/dilovod-proxy`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${serviceRoleKey}`,
      },
      body: JSON.stringify({ action: proxyAction, params: args }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error(`[executeTool] ${proxyAction} returned ${res.status}: ${text}`);
      return { error: true, status: res.status, message: `Dilovod API returned ${res.status}`, data: null };
    }

    return await res.json();
  } catch (e: any) {
    if (e.name === "AbortError") {
      console.warn(`[executeTool] ${proxyAction} timed out (10s)`);
      return { error: true, status: 408, message: "timeout (10s)", data: null };
    }
    console.error(`[executeTool] ${proxyAction} failed:`, e.message);
    return { error: true, status: 0, message: String(e.message), data: null };
  } finally {
    clearTimeout(timeout);
  }
}

// ─── Execute tool + fire-and-forget audit log ────────────────────────────────
async function executeAndLog(
  toolName: string,
  args: Record<string, unknown>,
  supabaseUrl: string,
  serviceRoleKey: string,
  userId: string
): Promise<unknown> {
  const result = await executeTool(toolName, args, supabaseUrl, serviceRoleKey);

  // Fire-and-forget audit log — never block, never throw
  try {
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);
    supabaseAdmin
      .from("dilovod_audit_log")
      .insert({
        user_id: userId,
        event_type: "ai_tool_call",
        action_type: toolName,
        payload_snapshot: { tool: toolName, args, result },
      })
      .then(() => {})
      .catch((err: any) => console.warn("[audit] insert failed:", err.message));
  } catch {
    // Swallow entirely
  }

  return result;
}

// ─── Main handler ────────────────────────────────────────────────────────────
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { messages, actionType } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    }

    // Extract user ID from auth header (best-effort, fallback to "anon")
    let userId = "anon";
    const authHeader = req.headers.get("Authorization");
    if (authHeader?.startsWith("Bearer ")) {
      try {
        const token = authHeader.replace("Bearer ", "");
        const payload = JSON.parse(atob(token.split(".")[1]));
        userId = payload.sub || "anon";
      } catch { /* use anon */ }
    }

    // Build context-aware system prompt
    const today = new Date().toISOString().split("T")[0];
    let systemContent = SYSTEM_PROMPT + `\n\nСьогоднішня дата: **${today}**. Використовуй її як дату документа, якщо користувач не вказав іншу.`;
    if (actionType) {
      systemContent += `\n\nКористувач обрав тип операції: **${actionType}**. Зосередься на цьому типі.`;
    }

    const aiMessages: any[] = [
      { role: "system", content: systemContent },
      ...messages.map((m: any) => ({ role: m.role, content: m.content })),
    ];

    // ─── Agentic loop ──────────────────────────────────────────────────────
    const MAX_ITERATIONS = 8;
    const AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

    for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
      console.log(`[agentic] iteration ${iteration + 1}/${MAX_ITERATIONS}, messages: ${aiMessages.length}`);

      const aiResponse = await fetch(AI_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-3-flash-preview",
          messages: aiMessages,
          tools: TOOL_DEFINITIONS,
          tool_choice: "auto",
          stream: false,
        }),
      });

      if (!aiResponse.ok) {
        const status = aiResponse.status;
        if (status === 429) {
          return new Response(JSON.stringify({ error: "Перевищено ліміт запитів, спробуйте пізніше." }), {
            status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        if (status === 402) {
          return new Response(JSON.stringify({ error: "Необхідно поповнити кредити AI." }), {
            status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        const t = await aiResponse.text();
        console.error("AI gateway error:", status, t);
        return new Response(JSON.stringify({ error: "Помилка AI сервісу" }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const aiData = await aiResponse.json();
      const choice = aiData.choices?.[0];
      if (!choice) {
        console.error("[agentic] No choices in AI response");
        break;
      }

      const msg = choice.message;

      // If no tool calls → this is the final response. Stream it.
      if (!msg.tool_calls || msg.tool_calls.length === 0) {
        console.log(`[agentic] No tool calls on iteration ${iteration + 1} — streaming final response`);
        
        // Re-request with stream: true for the final response
        const streamResponse = await fetch(AI_URL, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${LOVABLE_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "google/gemini-3-flash-preview",
            messages: aiMessages,
            stream: true,
          }),
        });

        if (!streamResponse.ok) {
          const t = await streamResponse.text();
          console.error("Stream error:", streamResponse.status, t);
          return new Response(JSON.stringify({ error: "Помилка AI сервісу" }), {
            status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        return new Response(streamResponse.body, {
          headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
        });
      }

      // Execute tool calls (parallel within iteration — they're independent searches)
      console.log(`[agentic] ${msg.tool_calls.length} tool call(s) on iteration ${iteration + 1}`);

      // Add assistant message with tool_calls to history
      aiMessages.push({
        role: "assistant",
        content: msg.content || null,
        tool_calls: msg.tool_calls,
      });

      // Execute all tool calls in parallel
      const toolResults = await Promise.all(
        msg.tool_calls.map(async (tc: any) => {
          const args = typeof tc.function.arguments === "string"
            ? JSON.parse(tc.function.arguments)
            : tc.function.arguments;

          console.log(`[agentic] Executing tool: ${tc.function.name}(${JSON.stringify(args)})`);
          const result = await executeAndLog(tc.function.name, args, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, userId);
          console.log(`[agentic] Tool ${tc.function.name} returned ${JSON.stringify(result).slice(0, 200)}`);

          return { id: tc.id, result };
        })
      );

      // Add tool results to message history
      for (const tr of toolResults) {
        aiMessages.push({
          role: "tool",
          tool_call_id: tr.id,
          content: JSON.stringify(tr.result),
        });
      }
    }

    // ─── Iteration cap hit — force final response ────────────────────────────
    console.warn("[agentic] Iteration cap hit, forcing final response");

    const forceResponse = await fetch(AI_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: aiMessages,
        stream: true,
      }),
    });

    if (!forceResponse.ok) {
      return new Response(JSON.stringify({ error: "Помилка AI сервісу (cap)" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(forceResponse.body, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (e) {
    console.error("dilovod-chat error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
