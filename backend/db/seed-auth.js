/**
 * Seed auth users into the database.
 * Run: node db/seed-auth.js (from backend folder)
 *
 * Creates:
 * - admin@school.com / admin123 (role: admin)
 * - sarah@school.com / teacher123 (role: teacher, linked to teacher Sarah Johnson)
 * - james@school.com / student123 (role: student, linked to student James Smith)
 */

import pg from 'pg';
import bcrypt from 'bcrypt';
import dotenv from 'dotenv';

dotenv.config();

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/lms_school',
});

async function run() {
  const client = await pool.connect();

  try {
    const users = [
      { email: 'admin@school.com', password: 'admin123', role: 'admin' },
      { email: 'sarah@school.com', password: 'teacher123', role: 'teacher' },
      { email: 'james@school.com', password: 'student123', role: 'student' },
    ];

    for (const u of users) {
      const hash = await bcrypt.hash(u.password, 10);
      await client.query(
        `INSERT INTO users (email, password_hash, role) VALUES ($1, $2, $3)
         ON CONFLICT (email) DO UPDATE SET password_hash = $2, role = $3`,
        [u.email, hash, u.role]
      );
      console.log(`User ${u.email} (${u.role}) created/updated`);
    }

    // Link teacher Sarah (id 1) to sarah@school.com
    await client.query(
      `UPDATE teachers SET user_id = (SELECT id FROM users WHERE email = 'sarah@school.com') WHERE id = 1`
    );
    // Link student James (id 1) to james@school.com
    await client.query(
      `UPDATE students SET user_id = (SELECT id FROM users WHERE email = 'james@school.com') WHERE id = 1`
    );
    console.log('Linked users to teachers/students');
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
