# DB migrations (run in pgAdmin, in order)

1. schema.sql
2. due-at.sql
3. grading-model.sql
4. grade-feedback.sql
5. attendance.sql
6. notification-seen.sql (optional)
7. attachments.sql, announcements.sql
8. submissions.sql
9. calendar-events.sql
10. document-chunks.sql (for AI/RAG search)
11. seed.sql
12. seed-extended.sql (optional)
13. From backend: `node db/seed-auth.js`
