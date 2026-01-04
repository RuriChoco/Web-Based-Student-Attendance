const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const bcrypt = require('bcrypt');

// This holds the promise that resolves to the database connection
const dbPromise = open({
    filename: './attendance.db',
    driver: sqlite3.Database
});

async function initDb() {
    const db = await dbPromise;
    const SALT_ROUNDS = 10;
    // Drop all tables for a clean slate. In production, you would use a migration system.
    await db.exec(`
        DROP TABLE IF EXISTS audit_logs;
        DROP TABLE IF EXISTS excuses;
        DROP TABLE IF EXISTS attendance;
        DROP TABLE IF EXISTS student_details;
        DROP TABLE IF EXISTS users;
        DROP TABLE IF EXISTS app_meta;
        DROP TABLE IF EXISTS students;
    `);

    await db.exec(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE,
            password TEXT,
            role TEXT NOT NULL CHECK(role IN ('admin', 'registrar', 'teacher', 'student')),
            name TEXT NOT NULL,
            reset_token TEXT,
            reset_token_expiry INTEGER
        );

        CREATE TABLE IF NOT EXISTS student_details (
            user_id INTEGER PRIMARY KEY,
            student_code TEXT UNIQUE NOT NULL,
            age INTEGER NOT NULL,
            gender TEXT NOT NULL,
            room TEXT NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS attendance (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            date TEXT NOT NULL,
            time TEXT,
            status TEXT NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
            UNIQUE(user_id, date)
        );

        CREATE TABLE IF NOT EXISTS excuses (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            date TEXT NOT NULL,
            reason TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'Pending',
            FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
            UNIQUE(user_id, date)
        );

        CREATE TABLE IF NOT EXISTS audit_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            username TEXT,
            action TEXT NOT NULL,
            details TEXT,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL
        );

        CREATE TABLE IF NOT EXISTS app_meta (
            key TEXT PRIMARY KEY,
            value INTEGER
        );
    `);
    await db.run(`INSERT OR IGNORE INTO app_meta (key, value) VALUES ('last_student_code', 0);`);
    console.log('Database tables initialized successfully.');

    // Create default non-admin staff users. The first admin is created via the setup page.
    const defaultPassword = await bcrypt.hash('1234', SALT_ROUNDS);
    const staffUsers = [
        { username: 'registrar', name: 'Registrar User', role: 'registrar' },
        { username: 'teacher', name: 'Teacher User', role: 'teacher' }
    ];

    const stmt = await db.prepare('INSERT OR IGNORE INTO users (username, password, role, name) VALUES (?, ?, ?, ?)');
    for (const user of staffUsers) {
        await stmt.run(user.username, defaultPassword, user.role, user.name);
    }
    await stmt.finalize();
    console.log('Default staff users (registrar, teacher) created or already exist.');
}

// Idempotent schema creation to be used by the server on startup when needed.
async function ensureSchema() {
    const db = await dbPromise;
    const SALT_ROUNDS = 10;

    await db.exec(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE,
            password TEXT,
            role TEXT NOT NULL CHECK(role IN ('admin', 'registrar', 'teacher', 'student')),
            name TEXT NOT NULL,
            reset_token TEXT,
            reset_token_expiry INTEGER
        );

        CREATE TABLE IF NOT EXISTS student_details (
            user_id INTEGER PRIMARY KEY,
            student_code TEXT UNIQUE NOT NULL,
            age INTEGER NOT NULL,
            gender TEXT NOT NULL,
            room TEXT NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS attendance (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            date TEXT NOT NULL,
            time TEXT,
            status TEXT NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
            UNIQUE(user_id, date)
        );

        CREATE TABLE IF NOT EXISTS excuses (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            date TEXT NOT NULL,
            reason TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'Pending',
            FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
            UNIQUE(user_id, date)
        );

        CREATE TABLE IF NOT EXISTS audit_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            username TEXT,
            action TEXT NOT NULL,
            details TEXT,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL
        );

        CREATE TABLE IF NOT EXISTS app_meta (
            key TEXT PRIMARY KEY,
            value INTEGER
        );
    `);

    await db.run(`INSERT OR IGNORE INTO app_meta (key, value) VALUES ('last_student_code', 0);`);

    // Ensure default staff exist without overwriting existing users
    const defaultPassword = await bcrypt.hash('1234', SALT_ROUNDS);
    const stmt = await db.prepare('INSERT OR IGNORE INTO users (username, password, role, name) VALUES (?, ?, ?, ?)');
    await stmt.run('registrar', defaultPassword, 'registrar', 'Registrar User');
    await stmt.run('teacher', defaultPassword, 'teacher', 'Teacher User');
    await stmt.finalize();
    console.log('Schema checked/ensured.');
}

// When running `node database.js`, initialize and close.
if (require.main === module) {
    initDb().then(() => {
        console.log('Manual DB initialization complete.');
        dbPromise.then(db => db.close());
    });
}

module.exports = dbPromise;
// Export helper for ensuring schema exists without truncating data
module.exports.ensureSchema = ensureSchema;