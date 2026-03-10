# LMS — Learning Management System for School

LMS system for school with AI assistant for students. Manages classes, assignments, grades, attendance, and calendar. Students can ask the assistant questions about course materials — it guides them to relevant excerpts without giving direct answers.

## Stack

- **Frontend:** React, Vite, React Router, Chart.js, TipTap (rich text)
- **Backend:** Node.js, Express
- **Database:** PostgreSQL (pgvector for semantic search)
- **AI:** OpenAI / Anthropic — RAG over course PDFs, intent classification, short replies for greetings/thanks

## Features

- Classes, students, teachers, assignments, grades (US letter grading)
- Assignment submissions (text + files)
- Attendance, calendar events
- PDF upload to assignments — indexed for AI search
- Study Assistant: students ask questions → assistant points to exact place in materials (assignment, file, excerpt)
- Teacher/Admin: view AI ask analytics (topics, questions)
- Docker support for PostgreSQL + pgvector
