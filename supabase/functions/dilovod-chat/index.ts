import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

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
   Може включати Замовлення постачальнику + Надходження, або тільки Надходження (якщо замовлення не вводили / забули).
   Завжди запитуй: "Потрібно також створити замовлення постачальнику, чи тільки надходження?"

### Виробництво
7. **production.order** — Замовлення на виробництво
   Перевірка специфікації → Створення замовлення.

## Обов'язкові поля для draft
- **counterparty**: назва контрагента (покупець, постачальник, комісіонер)
- **date**: дата документа
- **items**: список товарів з полями: назва, кількість, ціна

## ВАЖЛИВО: Дата документа
- Завжди використовуй СЬОГОДНІШНЮ дату, яка передається в контексті нижче.
- НІКОЛИ не використовуй дату з минулого (напр. 2024-05-22).
- Якщо користувач не вказав дату — використовуй сьогоднішню.

## Правила поведінки
1. Відповідай українською, коротко і по справі
2. Якщо користувач описує ситуацію — запропонуй конкретний тип операції
3. Якщо завантажив файл — спробуй витягти дані (контрагент, товари, ціни)
4. Не створюй draft поки не маєш: контрагент + хоча б 1 товар + кількість + ціну
5. Коли всі дані є — сформуй draft у форматі JSON і поясни що буде створено
6. Для purchase.receipt — завжди запитай чи потрібне замовлення постачальнику
7. Для sales.commission — поясни що буде створено 4 документи одразу

## Формат draft (коли є всі дані)
Коли маєш достатньо інформації, поверни JSON блок у форматі:
\`\`\`json
{
  "type": "draft",
  "actionType": "sales.commission",
  "counterparty": { "extracted_name": "ТОВ Магазин" },
  "date": "YYYY-MM-DD",
  "items": [
    { "extracted_name": "Товар 1", "qty": 10, "price": 100.00, "total": 1000.00 }
  ],
  "total_sum": 1000.00,
  "createSupplierOrder": true
}
\`\`\`
Поле createSupplierOrder використовуй тільки для purchase.receipt.`;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { messages, actionType } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    // Build context-aware system prompt with current date
    const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
    let systemContent = SYSTEM_PROMPT + `\n\nСьогоднішня дата: **${today}**. Використовуй її як дату документа, якщо користувач не вказав іншу.`;
    if (actionType) {
      systemContent += `\n\nКористувач обрав тип операції: **${actionType}**. Зосередься на цьому типі.`;
    }

    const aiMessages = [
      { role: "system", content: systemContent },
      ...messages.map((m: any) => ({ role: m.role, content: m.content })),
    ];

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
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

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Перевищено ліміт запитів, спробуйте пізніше." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "Необхідно поповнити кредити AI." }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const t = await response.text();
      console.error("AI gateway error:", response.status, t);
      return new Response(JSON.stringify({ error: "Помилка AI сервісу" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(response.body, {
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
