
QA покриття (виконано)
- ✅ Авторизація/guard сторінок
- ✅ Chat send + streaming + resolve draft + disambiguation
- ✅ Sidebar сесій (створення/перезавантаження/історія)
- ✅ Запити до backend functions (chat/proxy)
- ✅ /marketplaces overview
- ⚠️ Не покрито e2e: реальне створення документів (кнопки підтвердження відсутні в UI)

Знайдені проблеми (що не працює / погано / незручно)

P0
1) Довгі запити закінчуються "Час очікування відповіді вичерпано (30с)" і користувач залишається без нормального recovery-flow.
2) У payload на /dilovod-chat дублюється останнє user-повідомлення (в одному запиті воно передається двічі).

P1
3) Історія сесій засмічується дублями однакових запитів; є "биті" сесії з 1 user без assistant.
4) Пошук контрагента часто повертає 0 (напр. "Тест Тестинг"), через це постійний manual disambiguation.
5) AI стабільно генерує застарілу дату `2024-05-22` у draft.
6) У консолі масові React warning `Function components cannot be given refs` (ActionTags, ChatThread/Markdown, FileUpload + інші), шумить дебаг і ускладнює діагностику.

P2
7) Невідповідність actionType: UI використовує `sales.shipment`, а backend chain-гілка очікує `sales.end_consumer`.
8) У draft-flow немає явного "Підтвердити/Створити документи" e2e кроку (UX-розрив: чернетка є, виконання немає).
9) Sidebar показує багато однотипних назв; немає дедуплікації/групування схожих запитів.

План виправлень (коротко, по кроках)

1) Стабілізувати send-flow у `src/pages/Dilovod.tsx`
- Будувати `historyForAI` з snapshot до `saveMessage(user)` або не додавати вручну user, якщо він уже в state.
- Додати idempotency guard на рівні контент+timestamp (debounce 500–800ms).
- На timeout зберігати assistant error-message у чаті (не тільки toast), щоб стан був прозорий.

2) Посилити стрім у `src/lib/streamChat.ts`
- Розділити таймаути: connect timeout, first-byte timeout, full-stream timeout.
- Додати retry (1 раз) для transient timeout/abort.
- Передавати user access token (якщо є сесія), а не тільки publishable key.

3) Нормалізація та fallback для контрагентів у `src/lib/draftResolver.ts`
- Для counterparty: normalize + contains + токенний fallback (аналог item smartSearch).
- Кешувати останні вибори disambiguation локально для авто-підстановки в наступних схожих запитах.

4) Виправити mapping actionType
- Уніфікувати `sales.shipment` ↔ `sales.end_consumer` в одному контракті (UI, resolver, backend proxy, prompt).

5) Прибрати ref-warning шум
- Перевірити компоненти, які отримують `ref` непрямо (ActionTags, ChatThread/ReactMarkdown, FileUpload, Toaster wrappers).
- Де потрібно — `forwardRef`, де не потрібно — прибрати прокидання ref.

6) Очистити UX історії сесій у `src/hooks/useChatSessions.ts`
- Дедуп identical user messages (hash content + коротке вікно часу).
- Приховати/позначити orphan-сесії (user-only після timeout).
- Додати кнопку "Очистити дублікати" у sidebar.

7) Поставити e2e execution крок
- Додати на DraftCard кнопку "Підтвердити" і виклик createChain.
- Після виконання показувати confirmation message з IDs документів.

8) Обов’язковий регресійний QA після фіксів
- send 10 разів підряд: без дублювань у payload/DB.
- сценарій повільного AI: немає "вічного" зависання, є зрозумілий fallback.
- item + counterparty resolve: авто-матч/дизамбіг працюють стабільно.
- refresh сторінки: сесія та історія консистентні.
- перевірити flow end-to-end вручну: від вводу запиту до створення документів.
