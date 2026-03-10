# LMS — Docker PostgreSQL (pgvector)

PostgreSQL с pgvector в Docker. Backend и frontend запускаются как раньше (`npm run dev`).

---

## Вариант A: Миграция с локальной PostgreSQL

### 1. Создать дамп из текущей базы

**PowerShell** (подставьте свой пароль):

```powershell
$env:PGPASSWORD = "ваш_пароль"
& "C:\Program Files\PostgreSQL\17\bin\pg_dump.exe" -U postgres -d lms_school -F c -f backup.dump
```

Или через pgAdmin: правый клик по `lms_school` → Backup → Format: Custom → сохранить `backup.dump`.

### 2. Запустить PostgreSQL в Docker

```bash
cd c:\Users\Админ\Desktop\LMS
docker-compose up -d
```

Подождите 5–10 секунд, пока контейнер поднимется.

### 3. Восстановить дамп в Docker

Дамп должен лежать в `LMS/backup.dump` (или укажите полный путь):

```powershell
docker cp backup.dump lms-postgres:/tmp/backup.dump
docker exec -it lms-postgres pg_restore -U postgres -d lms_school --clean --if-exists /tmp/backup.dump
```

При предупреждениях «role does not exist» можно игнорировать.

### 4. Включить pgvector и колонку embedding

```powershell
docker exec -it lms-postgres psql -U postgres -d lms_school -c "CREATE EXTENSION IF NOT EXISTS vector; ALTER TABLE document_chunks ADD COLUMN IF NOT EXISTS embedding vector(1536);"
```

### 5. Обновить .env

В `backend/.env`:

```
DATABASE_URL=postgres://postgres:postgres@localhost:5433/lms_school
```

Порт **5433** — проброс из Docker.

### 6. Перезапустить backend

```bash
cd backend
npm run dev
```

---

## Вариант B: Чистая установка (без миграции)

### Автоматически (PowerShell)

```powershell
cd c:\Users\Админ\Desktop\LMS
.\scripts\docker-fresh-install.ps1
```

Скрипт запустит Docker, применит схему, seed и создаст пользователей.

### Вручную

1. Запустить: `docker-compose up -d`
2. Подождать 5 секунд
3. В папке `LMS` выполнить:

```powershell
Get-Content backend\db\schema.sql -Raw | docker exec -i lms-postgres psql -U postgres -d lms_school
Get-Content backend\db\init-all.sql -Raw | docker exec -i lms-postgres psql -U postgres -d lms_school
Get-Content backend\db\document-chunks.sql -Raw | docker exec -i lms-postgres psql -U postgres -d lms_school
Get-Content backend\db\seed.sql -Raw | docker exec -i lms-postgres psql -U postgres -d lms_school
docker exec -i lms-postgres psql -U postgres -d lms_school -c "CREATE EXTENSION IF NOT EXISTS vector; ALTER TABLE document_chunks ADD COLUMN IF NOT EXISTS embedding vector(1536);"
$env:DATABASE_URL="postgres://postgres:postgres@localhost:5433/lms_school"; cd backend; npm run seed-auth
```

### Обновить .env

В `backend/.env`:

```
DATABASE_URL=postgres://postgres:postgres@localhost:5433/lms_school
```

Тестовый вход: **admin@school.com** / **admin123**

---

## Полезные команды

```bash
# Остановить
docker-compose down

# Удалить данные (сброс)
docker-compose down -v

# Логи
docker-compose logs -f postgres
```

---

## Порты

- **5433** (хост) → 5432 (контейнер) — PostgreSQL
- Локальная PostgreSQL 17 на 5432 продолжит работать, Docker использует 5433.
