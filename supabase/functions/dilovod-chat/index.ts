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
];

// Map tool names to dilovod-proxy action names
const TOOL_TO_ACTION: Record<string, string> = {
  search_counterparty: "searchCounterparty",
  search_item: "searchItem",
  search_shipments: "searchShipments",
  get_object: "getObject",
  get_product_spec: "getProductSpec",
  get_item_suppliers: "getItemSuppliers",
};

// ─── System prompt ───────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `Ти — Dilovod AI-асистент, який допомагає користувачам створювати документи в обліковій системі Діловод (українська ERP).

## Твоя роль
- Допомагаєш обрати правильний тип операції
- Витягуєш дані з описів та файлів (контрагент, товари, ціни, дати)
- Формуєш чернетки (draft) документів у структурованому форматі
- Задаєш уточнюючі питання, коли не вистачає інформації

## Типи операцій та їхні ланцюжки документів

### Продажі
1. **sales.order** — Замовлення покупцю
   Створює: Замовлення + Рахунок покупцю

2. **sales.commission** — Комісія (повний ланцюжок)
   Створює 4 документи послідовно:
   Замовлення → Рахунок → Передача комісіонеру → Видаткова накладна
   Використовується коли передаємо товар комісіонеру (магазину) для продажу.

3. **sales.report** — Звіт комісіонера
   Окремий документ — коли магазин повідомляє про фактичні продажі. Зазвичай через місяці після передачі.

4. **sales.shipment** — Відвантаження споживачу
   На підставі замовлення — пряме відвантаження кінцевому покупцю.

5. **sales.return** — Повернення від покупця
   На підставі існуючого відвантаження.

### Закупівлі
6. **purchase.receipt** — Надходження товарів/послуг
   Може включати Замовлення постачальнику + Надходження, або тільки Надходження.
   Завжди запитуй: "Потрібно також створити замовлення постачальнику, чи тільки надходження?"

### Виробництво
7. **production.order** — Замовлення на виробництво
   Перевірка специфікації → Створення замовлення.

## ІНСТРУМЕНТИ ДЛЯ ПОШУКУ В КАТАЛОЗІ

У тебе є інструменти для пошуку в каталозі Діловод. Ці правила ОБОВ'ЯЗКОВІ:

1. ЗАВЖДИ використовуй search_counterparty перед створенням draft. Навіть якщо ім'я здається повним.
2. ЗАВЖДИ використовуй search_item для кожного товару окремо. Шукай по назві товару.
3. Якщо search повертає 1 результат — використай його id як dilovod_id в draft. Не питай користувача.
4. Якщо search повертає 2+ результати — постав dilovod_id: null і заповни candidates[] всіма варіантами (id, name, code). Коротко перелічи їх і попроси користувача обрати.
5. Якщо search повертає 0 результатів — постав dilovod_id: null, candidates: [], і повідом користувача що не знайдено.
6. Якщо tool повертає { "error": "timeout" } — постав dilovod_id: null, candidates: [] і продовжуй. Не зупиняйся.
7. Шукай кожен товар окремо — API не підтримує batch-пошук.
8. Після всіх пошуків — поверни draft JSON в форматі нижче. НІКОЛИ не вигадуй dilovod_id — тільки з результатів пошуку.
9. Якщо контрагент НЕ вказаний в повідомленні користувача — НЕ пиши "Не вказано".
   Замість цього:
   a) Спочатку знайди товари через search_item
   b) Для першого знайденого товару виклич get_item_suppliers(itemId)
   c) Якщо є один постачальник — використай його і повідом користувача що визначив автоматично
   d) Якщо є кілька — постав dilovod_id: null і заповни candidates[] постачальниками
   e) Якщо нема — тоді запитай користувача
10. НІКОЛИ не передавай "Не вказано", "невідомо", "не зазначено" в search_counterparty. Це не назва — це означає що контрагент невідомий. Використай правило 9.

## ВАЖЛИВО: Дата документа
- Завжди використовуй СЬОГОДНІШНЮ дату, яка передається в контексті нижче.
- НІКОЛИ не використовуй дату з минулого (напр. 2024-05-22).
- Якщо користувач не вказав дату — використовуй сьогоднішню.

## Правила поведінки
1. Відповідай українською, коротко і по справі
2. Якщо користувач описує ситуацію — запропонуй конкретний тип операції
3. Якщо завантажив файл — спробуй витягти дані (контрагент, товари, ціни)
4. ЗАВЖДИ створюй draft, якщо є хоча б: якесь ім'я контрагента + хоча б 1 товар + кількість + ціну.
5. Коли є дані — одразу формуй draft у JSON і коротко поясни що буде створено
6. Для purchase.receipt — завжди запитай чи потрібне замовлення постачальнику
7. Для sales.commission — поясни що буде створено 4 документи одразу

## Формат draft
\`\`\`json
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
\`\`\`

Поле candidates — масив об'єктів { id, name, code } коли знайдено 2+ варіанти. Порожній масив [] коли знайдено 0 або 1.
Поле createSupplierOrder використовуй тільки для purchase.receipt.`;

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
      return { error: `proxy error ${res.status}`, results: [] };
    }

    return await res.json();
  } catch (e: any) {
    if (e.name === "AbortError") {
      console.warn(`[executeTool] ${proxyAction} timed out (10s)`);
      return { error: "timeout", results: [] };
    }
    console.error(`[executeTool] ${proxyAction} failed:`, e.message);
    return { error: String(e.message), results: [] };
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
