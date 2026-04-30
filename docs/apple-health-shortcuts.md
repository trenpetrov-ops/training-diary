# Apple Health / Apple Watch -> Training Diary

Этот документ описывает, как связать Apple Watch / Apple Health с `Training Diary` через `iOS Shortcuts`.

## Что уже реализовано в проекте

- Cloud Function для приема данных: `appleHealthImport`
- HTTP endpoint через Hosting rewrite:
  - `https://training-diary-51f0f.web.app/api/apple-health/import`
- Хранение дневных метрик в Firestore:
  - `artifacts/{appId}/users/{uid}/healthDaily/{yyyy-mm-dd}`
- Генерация токена в PWA:
  - `Профиль -> Apple Health / Apple Watch -> Создать токен для Apple Health`

Сам токен показывается только один раз. В Firestore хранится только его `SHA-256 hash`.

## Что нужно сделать в приложении перед настройкой Shortcut

1. Открой `Training Diary`.
2. Перейди в профиль.
3. Найди блок `Apple Health / Apple Watch`.
4. Нажми `Создать токен для Apple Health`.
5. Сохрани токен в надежное место.

Важно:
- этот токен потом нужно вставить в Shortcut;
- повторно посмотреть старый токен нельзя;
- если токен потерян, просто создай новый.

## Архитектура

Поток данных такой:

`Apple Watch -> Apple Health -> iOS Shortcuts -> HTTP POST -> Firebase Cloud Function -> Firestore -> PWA`

PWA не читает Apple Health напрямую. Это ограничение iOS/PWA, поэтому связка через `Shortcuts` здесь нормальная и ожидаемая.

## Shortcut: базовая идея

Название команды:

`Sync Training Diary`

Команда должна:

1. Получить дневные данные из Apple Health.
2. Собрать JSON.
3. Отправить его POST-запросом в:
   - `https://training-diary-51f0f.web.app/api/apple-health/import`
4. При ручном запуске из PWA принять входной JSON с `uid` и `date`.
5. При автоматическом запуске по расписанию уметь использовать заранее сохраненный `uid` и локальную дату.

## Какие разрешения запросит iPhone

При первом запуске Shortcut может попросить доступ к данным приложения `Здоровье`.

Разреши доступ минимум к таким метрикам:

- Steps
- Active Energy
- Resting Energy
- Apple Exercise Time
- Walking + Running Distance
- Heart Rate
- Stand Hours

Если `Stand Hours` недоступны, это не критично. Поле необязательное.

## Какие данные должны уйти на сервер

Формат JSON:

```json
{
  "uid": "FIREBASE_USER_UID",
  "date": "2026-04-29",
  "metrics": {
    "steps": 12400,
    "activeKcal": 520,
    "restingKcal": 1450,
    "exerciseMinutes": 63,
    "distanceKm": 7.8,
    "heartRateAvg": 118,
    "standHours": 10
  }
}
```

## Как собрать Shortcut на iPhone

Ниже логика в том порядке, в котором удобно собирать Shortcut.

### 1. Создай новую команду

- Открой приложение `Команды`
- Нажми `+`
- Назови команду:
  - `Sync Training Diary`

### 2. Разреши входные данные

Shortcut должен уметь принимать `Text` input из PWA.

Идея такая:
- если команда запущена кнопкой из PWA, приложение передаст JSON строкой;
- если команда запущена сама по расписанию, вход может быть пустым.

Добавь действия для разбора входного текста:

1. `Получить входные данные`
2. `Если` входные данные не пустые
3. Преобразовать входной текст в `Dictionary` / JSON
4. Достать:
   - `uid`
   - `date`
5. Иначе:
   - использовать заранее сохраненный `uid`
   - использовать текущую дату

Практически это можно собрать так:

- `Get Text from Input`
- `If Provided Input has any value`
- `Get Dictionary from Input`
- `Get Dictionary Value` -> `uid`
- `Get Dictionary Value` -> `date`
- `Otherwise`
- `Text` -> вставь свой `uid`
- `Current Date`
- `Format Date`
  - формат: `yyyy-MM-dd`

Совет:
- для автоматизаций удобно сделать отдельный `Text` с твоим `uid`;
- для ручного запуска из PWA `uid` и `date` придут автоматически.

### 3. Получи данные из Apple Health

Для каждой метрики добавь отдельный блок.

#### Steps

- `Find Health Samples`
- Type: `Steps`
- Date: `Today`
- Result: `Sum`

Сохрани в переменную `steps`

#### Active Energy

- `Find Health Samples`
- Type: `Active Energy`
- Date: `Today`
- Result: `Sum`

Сохрани в `activeKcal`

#### Resting Energy

- `Find Health Samples`
- Type: `Resting Energy`
- Date: `Today`
- Result: `Sum`

Сохрани в `restingKcal`

#### Exercise Minutes

- `Find Health Samples`
- Type: `Apple Exercise Time`
- Date: `Today`
- Result: `Sum`

Сохрани в `exerciseMinutes`

#### Distance

- `Find Health Samples`
- Type: `Walking + Running Distance`
- Date: `Today`
- Result: `Sum`

Сохрани в `distanceKm`

#### Average Heart Rate

- `Find Health Samples`
- Type: `Heart Rate`
- Date: `Today`
- Result: `Average`

Сохрани в `heartRateAvg`

#### Stand Hours

- `Find Health Samples`
- Type: `Stand Hours`
- Date: `Today`
- Result: `Sum`

Сохрани в `standHours`

Если этот шаг неудобен или на твоем устройстве метрика недоступна, можно временно не отправлять `standHours`.

### 4. Собери Dictionary для запроса

Создай `Dictionary` такого вида:

```json
{
  "uid": "uid",
  "date": "date",
  "metrics": {
    "steps": "steps",
    "activeKcal": "activeKcal",
    "restingKcal": "restingKcal",
    "exerciseMinutes": "exerciseMinutes",
    "distanceKm": "distanceKm",
    "heartRateAvg": "heartRateAvg",
    "standHours": "standHours"
  }
}
```

Важно:
- поля должны называться именно так;
- `date` должна быть в формате `YYYY-MM-DD`;
- `standHours` можно не передавать, если его нет.

### 5. Отправь POST запрос

Добавь `Get Contents of URL`.

Параметры:

- URL:
  - `https://training-diary-51f0f.web.app/api/apple-health/import`
- Method:
  - `POST`
- Headers:
  - `Content-Type: application/json`
  - `Authorization: Bearer YOUR_TOKEN`
- Request Body:
  - `JSON`
  - как тело используй собранный `Dictionary`

`YOUR_TOKEN` — это токен, который ты получил в PWA в профиле.

## Как работает ручная кнопка в приложении

В `Training Diary` уже есть кнопка:

- `Получить данные Apple Watch`

Она пытается открыть Shortcut по URL-схеме:

- `shortcuts://x-callback-url/run-shortcut`

Что передается внутрь команды:

```json
{
  "uid": "CURRENT_FIREBASE_UID",
  "date": "YYYY-MM-DD",
  "source": "manual_button"
}
```

Поэтому для ручного запуска из PWA Shortcut должен уметь:

- принять входной `Text`;
- распарсить его как JSON;
- взять оттуда `uid` и `date`.

После завершения команда вернет пользователя обратно в PWA.

## Автоматизации

Можно начать с двух сценариев:

### Вариант 1. Минимальный старт

- ручная кнопка из PWA
- одна автоматизация:
  - `23:55` каждый день

### Вариант 2. Более частое обновление

- `08:00`
- `12:00`
- `18:00`
- `23:55`

Если захочешь, можно отдельно сделать Shortcut для `вчерашнего дня`, но для первого этапа это не обязательно.

## Что сохраняется в Firestore

Документ за день:

`healthDaily/{date}`

Пример полей:

```json
{
  "date": "2026-04-29",
  "steps": 12400,
  "activeKcal": 520,
  "restingKcal": 1450,
  "exerciseMinutes": 63,
  "distanceKm": 7.8,
  "heartRateAvg": 118,
  "standHours": 10,
  "source": "apple_shortcuts",
  "updatedAt": "serverTimestamp"
}
```

Повторная отправка за тот же день просто обновит документ.

## Как проверить руками без iPhone Shortcut

### curl

```bash
curl -X POST "https://training-diary-51f0f.web.app/api/apple-health/import" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer TOKEN" \
  -d '{
    "uid": "USER_UID",
    "date": "2026-04-29",
    "metrics": {
      "steps": 12345,
      "activeKcal": 500,
      "restingKcal": 1400,
      "exerciseMinutes": 60,
      "distanceKm": 7.5,
      "heartRateAvg": 118,
      "standHours": 10
    }
  }'
```

### Windows PowerShell

```powershell
$headers = @{
  "Content-Type" = "application/json"
  "Authorization" = "Bearer TOKEN"
}

$body = @{
  uid = "USER_UID"
  date = "2026-04-29"
  metrics = @{
    steps = 12345
    activeKcal = 500
    restingKcal = 1400
    exerciseMinutes = 60
    distanceKm = 7.5
    heartRateAvg = 118
    standHours = 10
  }
} | ConvertTo-Json -Depth 5

Invoke-RestMethod `
  -Uri "https://training-diary-51f0f.web.app/api/apple-health/import" `
  -Method Post `
  -Headers $headers `
  -Body $body
```

## Ожидаемый ответ сервера

Успех:

```json
{
  "ok": true,
  "date": "2026-04-29"
}
```

Ошибка:

```json
{
  "ok": false,
  "error": "..."
}
```

## Частые причины, если данные не приходят

- токен в Shortcut не совпадает с токеном из приложения
- в Shortcut передается неправильный `uid`
- `date` не в формате `YYYY-MM-DD`
- не выдан доступ Shortcut к `Здоровью`
- в `Get Contents of URL` не выбран `POST`
- тело отправляется не как JSON
- отсутствует заголовок `Authorization: Bearer ...`

## Рекомендуемый порядок запуска

1. Сначала создать токен в PWA
2. Потом собрать Shortcut
3. Потом проверить `curl` или `Invoke-RestMethod`
4. Потом проверить ручной запуск кнопкой из PWA
5. Потом включить автоматизацию по расписанию
