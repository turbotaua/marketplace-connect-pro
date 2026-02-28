
План виправлення (коротко, по кроках)

1) Зафіксувати прив’язку повідомлень до однієї сесії
- `src/hooks/useChatSessions.ts`
  - Додати `sessionIdRef` і використовувати його як single source of truth.
  - Додати `ensureSessionId()`; `saveMessage()` приймає `sessionIdOverride`.
  - Повернути з `saveMessage` також `sessionId`.
  - Прибрати зайві `fetchSessions()` з `createSession()` і з кожного `saveMessage(user)` (лишити легкий refresh після завершення send-flow).
  - Автозавантаження останньої сесії після refresh (щоб “нічого не зникало”).

2) Розблокувати UI: відповідь AI показувати одразу, резолв каталогу — у фоні
- `src/pages/Dilovod.tsx`
  - У `handleSend` зберігати `sessionId` один раз і передавати його у всі наступні `saveMessage`.
  - У `onDone`:
    - спочатку зберігати assistant-text (без очікування резолву),
    - одразу вимикати `isProcessing` у `finally`,
    - потім запускати `resolveDraft` у фоні і оновлювати metadata того ж assistant-повідомлення.
  - Додати жорсткий `finally` для `sendingRef/isProcessing` у всіх гілках.
  - Прибрати ризик дублю в `historyForAI` (не додавати той самий user текст двічі).

3) Зробити стрім стабільним і без “вічного крутиться”
- `src/lib/streamChat.ts`
  - Додати timeout/abort на запит і на “перший байт”.
  - Дозволити `onDone: () => Promise<void> | void` і `await onDone()`.
  - Єдиний шлях помилки: `onError(...)` + гарантоване завершення циклу.

4) Каталог-резолв не має блокувати чат
- `src/lib/draftResolver.ts`
  - Лишити короткі timeouts, але помилки класифікувати як non-blocking.
  - Якщо `searchCounterparty/searchItem` впав — не тримати спінер, а зберігати текстову відповідь + toast.
  - Додати маркер “резолв не завершено” замість зависання.

5) Прибрати шумові React warning-и про refs
- `src/components/dilovod/ChatThread.tsx`
- `src/components/dilovod/FileUpload.tsx`
  - Перевірити й прибрати передачу `ref` у функціональні компоненти (або перевести на `forwardRef`, де реально треба).
  - Для markdown-рендеру прибрати джерело ref-передачі, щоб не засмічувати консоль.

6) Підчистити побічні артефакти зламаних спроб
- `src/hooks/useChatSessions.ts` / sidebar-відображення
  - Не показувати “порожні/биті” сесії без user-повідомлень.
  - (Опційно) одноразово сховати orphan-сесії assistant-only.

Технічні деталі (зафіксовані причини)
- Є розсинхрон сесій: user та assistant інколи пишуться в різні `session_id`.
- `saveMessage()` зараз може створювати нову сесію в середині того самого send-flow.
- `onDone` асинхронний, але стрім-обгортка не чекає його завершення — це залишає спінер без cleanup при помилці.
- `resolveDraft` запускається до завершення UI cleanup і подовжує блокування інтерфейсу.
- Після refresh поточна сесія не піднімається автоматично — користувач бачить “все зникло”.

Перевірка після імплементації
- Один send => 1 user + 1 assistant в одному `session_id`.
- Після refresh відкривається остання активна розмова з історією.
- При падінні `dilovod-proxy` чат не зависає: текст AI лишається, є toast, можна одразу писати далі.
- В консолі немає warning “Function components cannot be given refs”.
