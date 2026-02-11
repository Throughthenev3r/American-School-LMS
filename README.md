# LMS – American School

React + Node.js + PostgreSQL

## First-time setup

### 1. Database

In **pgAdmin**: connect to your PostgreSQL server, open Query Tool, run in order:

1. `backend/db/schema.sql` — creates tables
2. `backend/db/attachments.sql` — creates assignment_attachments table
3. `backend/db/announcements.sql` — creates announcements table
4. `backend/db/seed.sql` — inserts 3 classes, 9 students, sample assignments
5. `npm run seed-auth` (from backend) — creates login users

### 2. Backend

```bash
cd backend
npm install
npm run dev
```

API runs at http://localhost:4000

### 3. Frontend

```bash
cd frontend
npm install
npm run dev
```

App runs at http://localhost:5173

## Usage

- **Login** — admin@school.com / admin123 | sarah@school.com / teacher123 | james@school.com / student123
- **Classes** — view 3 demo classes, click a class to see students and assignments
- **Students** — list of all students

## Push to GitHub

1. Create a new repository on GitHub (e.g. `LMS` or `lms-school`). Do **not** add README, .gitignore, or license.

2. In a terminal, open the project folder and run:

```bash
cd "C:\Users\Админ\Desktop\LMS"
git init
git add .
git commit -m "Initial commit: LMS American School"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO_NAME.git
git push -u origin main
```

Replace `YOUR_USERNAME` and `YOUR_REPO_NAME` with your GitHub username and repository name. If GitHub asks for auth, use a Personal Access Token instead of a password.
