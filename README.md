# COI // Factory OS

Инженерный веб-калькулятор производственных цепочек, генератор/декодер игровых чертежей (`B...`) и дашборд живой телеметрии для **Captain of Industry** (`v0.8.x`).

Engineering production chain calculator, native blueprint (`B...`) generator/decoder, and live telemetry dashboard for **Captain of Industry** (`v0.8.x`).

> **Language navigation / Навигация по языкам:** [Русский](#-русский) · [English](#-english)

---

## 🇷🇺 Русский

### Что делает приложение

- **Точный солвер производственных цепочек**:
  - Охватывает **222 продукта**, **179 зданий**, **1587 рецептов**, **56 торговых контрактов** и **878 официальных иконок** (данные уже включены в репозиторий, интернет для работы расчётов не требуется).
  - Поддерживает циклические замкнутые контуры (двухфазный DFS-поиск циклов и топологический расчёт спроса), расчёт по темпу выпуска (`/60с`, `/мин`, `/сек`) или фиксированному числу зданий, ускорение (`Edicts / Boost`), персонал, обслуживание (`Maintenance I–III`), вычислительную мощность (`TFlops`), единство (`Unity`), стоимость постройки (`BOM`) и подбор конвейеров/труб (`T1–T4` и желоба расплава).
  - Полная русская локализация из файлов игры и двуязычный поиск (`Ctrl+K`).
- **Интерактивный граф потоков и компактная схема шин**:
  - Режим **Поштучно / Группой**: каждый узел разворачивается в отдельные плитки цехов (`#1..#N`) с загрузкой `%` каждого здания и параллельными магистралями, либо схлопывается в сводные блоки.
  - Свободное перетаскивание плиток мышью с сохранением позиций в `localStorage` и кнопкой «Авто-выравнивание».
  - Кнопка `+` прямо на выходах узлов для мгновенного продления цепочки вниз по переделу, переключатель источника на входе (карьер / пиролиз / рецепт / контракт).
  - Вкладка **«Компактная схема шин»** для планирования общих магистралей и загрузки лент/труб.
- **Советник по побочным продуктам («Что сжигать, а что хранить»)**:
  - Автоматически анализирует избытки и отходы (`Факел`, `Дымовая труба`, `Сливная труба`, `Твердотопливная горелка`, хранилища ядерных отходов), считает время заполнения буферных складов III тира (`3000` ед.) и предлагает рецепты переработки.
- **Нативные игровые чертежи (`B<len>:H4sI...`)**:
  - **Экспорт**: превращает рассчитанную схему (включая установки утилизации и буферные склады) в готовую строку чертежа, которую можно вставить прямо в **Captain of Industry**.
  - **Импорт**: декодирует любой игровой чертёж `B...` обратно в интерактивный план фабрики с пересчётом узлов и баланса.
- **Уровни развития и живая синхронизация с игрой (`Mafi.Core.WebApi`)**:
  - Переключатель **«Уровень: Этап I–IV / Все / ⚡ Из игры»**: автоматически перестраивает всю схему и скрывает недоступные рецепты (с возможностью раскрыть закрытые тиры кнопкой `Показать закрытые рецепты (+N)`).
  - Вкладка **«Телеметрия и Игра»**: подключается без сторонних модов к встроенному Web API игры (`127.0.0.1:3073`), показывает реальные запасы, дефициты с кнопкой **«+ X /60с в план»** (добавляет недостаток прямо в калькулятор), энергосеть и баланс пара, доступные по науке здания, 24-месячные графики и камеру острова. При отсутствии запущенной игры доступен встроенный демонстрационный снимок базы (`Демо-база`).

### Установка и запуск

**Требования:** [Node.js](https://nodejs.org/) версии `18` или выше и `npm`.

```bash
# 1. Клонировать репозиторий
git clone https://github.com/MrTwisterKRR/COI-Factory-OS.git
cd COI-Factory-OS

# 2. Установить зависимости
npm install

# 3. Запустить в режиме разработки (по умолчанию http://localhost:5173/)
npm run dev
```

Дополнительные команды:

```bash
# Сборка production-версии (TypeScript + Vite) в папку dist/
npm run build

# Предпросмотр собранной production-версии
npm run preview

# Проверка корректности солвера на стартовых пресетах и циклических цепочках
npm run verify-solver

# Проверка кодека чертежей (B...) и советника побочных продуктов
npx tsx scripts/verify-blueprint.ts
```

### Как подключить к запущенной игре (Live Telemetry)

В **Captain of Industry** (`0.8.4+`) встроен собственный локальный HTTP-сервер статистики — установка модов не требуется:

1. Запустите игру и загрузите ваше сохранение.
2. Откройте внутриигровую консоль (клавиша `~` / `` ` ``) и выполните:
   ```text
   web_api_start isPersistent:true allowOtherOriginsPost:true
   ```
3. В приложении перейдите на вкладку **«Телеметрия и Игра»** и нажмите **«Подключить игру»** (порт по умолчанию `http://127.0.0.1:3073`, проксируется через `/coi-live-api` в `npm run dev`).

> ⚠️ Примечание: в режиме `npm run dev` работает встроенный Vite-прокси `/coi-live-api`, снимающий CORS-ограничения. Для прямых запросов из `npm run preview` обязательно запускайте сервер в игре с флагом `allowOtherOriginsPost:true` (или `allowOtherOrigins:true`).

---

## 🇬🇧 English

### Overview & Features

- **Production Chain Solver**:
  - Bundled dataset of **222 products**, **179 buildings**, **1,587 recipes**, **56 trade contracts**, and **878 official PNG icons** (works completely offline).
  - Handles circular feedback loops via 2-phase DFS cycle detection & topological demand propagation. Computes exact & ceiling machine counts, target rates (`/60s`, `/1m`, `/1s`) or fixed building counts, Edict/Boost multipliers, workers, power, `Maintenance I–III`, `TFlops`, `Unity`, construction BOM, and conveyor/pipe tiers (`T1–T4` & molten channels).
  - Full Russian & English search (`Ctrl+K`).
- **Interactive Flow Graph & Bus Matrix**:
  - **Per-Building Tiles (`Поштучно`) vs Grouped (`Группой`)**: expand multi-building steps into individual `#1..#N` units with per-machine utilization `%`, or group them cleanly.
  - Drag-and-drop node positioning persisted to `localStorage` with 1-click auto-layout reset.
  - Downstream `+` extension directly from output ports and upstream raw/recipe/contract source switching.
  - Compact **Bus Matrix** view highlighting trunk throughput & remaining belt/pipe headroom.
- **Byproduct & Storage Advisor**:
  - Automatically classifies surplus & waste streams into disposal (`Flare`, `Smoke Stack`, `Liquid/Waste Dump`, `Solid Burner`, `Nuclear Waste Storage`) vs buffer storage with exact building counts, fill time estimates (for Tier III `3000`-cap storages), and 1-click recycling suggestions.
- **Native In-Game Blueprint (`B...`) Encoder & Decoder**:
  - **Export**: encodes solved production chains (optionally including disposal & buffer storage buildings) into copyable `B<len>:H4sI...` strings you can paste directly into **Captain of Industry**.
  - **Import**: decodes any in-game `B...` blueprint string back into an editable factory plan.
- **Tech Progression Stage Switcher & Live Game Sync (`Mafi.Core.WebApi`)**:
  - **Stage Switcher (`Этап I–IV` / `All` / `⚡ Live Game Sync`)**: automatically adapts machine tiers, default recipes, and dropdown filters to your chosen progression stage or live save.
  - **Telemetry & Game Tab**: connects natively to Captain of Industry (`v0.8.4+`) local Web API (`127.0.0.1:3073`) with zero mods — tracks stocks, deficits with 1-click injection into the active plan, steam/power grid balance, unlocked machines, 24-month SVG history charts, and live island camera feed (`/screenshot`). Includes a built-in mid-game demo snapshot (`Демо-база`) when the game is not running.

### Installation & Running

**Prerequisites:** [Node.js](https://nodejs.org/) `>= 18` and `npm`.

```bash
# 1. Clone the repository
git clone https://github.com/MrTwisterKRR/COI-Factory-OS.git
cd COI-Factory-OS

# 2. Install dependencies
npm install

# 3. Start the development server (default: http://localhost:5173/)
npm run dev
```

Useful scripts:

```bash
# Build production bundle (TypeScript + Vite) into dist/
npm run build

# Preview production bundle locally
npm run preview

# Run automated production chain solver tests
npm run verify-solver

# Verify native B... blueprint codec and byproduct advisor
npx tsx scripts/verify-blueprint.ts
```

### Connecting Live Game Telemetry (CoI `0.8.4+`)

Captain of Industry includes a built-in local HTTP API server (no third-party mods required):

1. Launch **Captain of Industry** and load your savegame.
2. Open the in-game console (`~` / `` ` ``) and execute:
   ```text
   web_api_start isPersistent:true allowOtherOriginsPost:true
   ```
3. Open the **«Телеметрия и Игра»** tab and click **«Подключить игру»** (defaults to `http://127.0.0.1:3073`, proxied cleanly via `/coi-live-api` when running `npm run dev`).

---

## 📁 Project Structure

```text
├── public/assets/        # Official game PNG icons (products, buildings, transport, categories)
├── scripts/              # Data fetchers, localization extractor & solver/blueprint verification scripts
├── src/
│   ├── components/       # UI components (FlowGraphView, ChainTableView, GameTelemetryView, CodexView, Modals)
│   ├── data/             # Processed JSON datasets, RU dictionary, presets & transport tiers
│   ├── engine/           # Solver, byproduct advisor, B... blueprint codec, and game Web API client
│   └── types/            # TypeScript interfaces
├── index.html
├── package.json
└── vite.config.ts        # Vite server & /coi-live-api proxy configuration
```
