const express = require('express');
const path = require('path');
const dbPromise = require('./database.js');
const bcrypt = require('bcrypt');
const session = require('express-session');
const crypto = require('crypto');
const multer = require('multer');
const csv = require('csv-parser');
const { Readable } = require('stream');

const app = express();
const PORT = 3000;
const SALT_ROUNDS = 10; // Salt rounds for bcrypt

app.use(express.json());
// Serve static files, but disable the default serving of 'index.html' for the root URL.
// This allows our custom app.get('/') route to handle it.
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

// Configure multer for in-memory file storage
const upload = multer({ storage: multer.memoryStorage() });

let needsSetup = false; // This will be set at startup

app.use(session({ // Using default MemoryStore which requires no extra setup
    secret: 'a very secret key for attendance', // Replace with a real secret in production
    resave: false,
    saveUninitialized: false,
    cookie: {
        maxAge: 1000 * 60 * 60 * 24 // 24 hours
    }
}));

// Middleware to check if the user is authenticated
const requireRole = (roles = []) => {
    return (req, res, next) => {
        if (!req.session.user || !roles.includes(req.session.user.role)) {
            return res.status(403).json({ error: 'Forbidden: Insufficient permissions' });
        }
        next();
    };
};

// A simpler middleware just to check for any authenticated user
const isAuthenticated = (req, res, next) => req.session.user ? next() : res.status(401).json({ error: 'Not authenticated' });

// Wrapper for async routes to catch errors and pass them to the error handler
const asyncHandler = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Helper to generate student code in format YYYY-XXX where XXX is a per-year sequential padded number
// Ensures uniqueness by looping until an unused code is found and commits the used sequence number atomically.
const generateStudentCode = async (db) => {
    const year = new Date().getFullYear();
    const key = `last_student_seq_${year}`;

    try {
        // Start a transaction to reduce race conditions
        await db.run('BEGIN IMMEDIATE');

        // Get current sequence for this year (0 if none)
        const row = await db.get('SELECT value FROM app_meta WHERE key = ?', key);
        let seq = row ? row.value : 0;
        let candidate;

        // Find next unused sequence
        while (true) {
            seq += 1;
            const seqStr = String(seq).padStart(3, '0');
            candidate = `${year}-${seqStr}`;
            const exists = await db.get('SELECT 1 FROM student_details WHERE student_code = ?', candidate);
            if (!exists) break; // found a free code
        }

        // Update the sequence value in app_meta
        await db.run('INSERT OR REPLACE INTO app_meta (key, value) VALUES (?, ?)', [key, seq]);

        await db.run('COMMIT');
        return candidate;
    } catch (err) {
        try { await db.run('ROLLBACK'); } catch (e) { /* ignore rollback errors */ }
        throw err;
    }
};

// --- Audit Log Helper ---
const logAction = async (userId, username, action, details = {}) => {
    try {
        const db = await dbPromise;
        const detailsJson = JSON.stringify(details);
        await db.run('INSERT INTO audit_logs (user_id, username, action, details) VALUES (?, ?, ?, ?)', [userId, username, action, detailsJson]);
    } catch (err) {
        console.error('Failed to write to audit log:', err);
    }
};
// --- API Endpoints ---

const fs = require('fs');

// Serve icons directory at /icons
app.use('/icons', express.static(path.join(__dirname, 'icons')));

// Handle favicon requests by serving the school icon if available, otherwise return 204
app.get('/favicon.ico', (req, res) => {
    const icoPath = path.join(__dirname, 'icons', 'school-icon.jpeg');
    if (fs.existsSync(icoPath)) {
        return res.sendFile(icoPath);
    }
    res.status(204).send();
});

// Teacher Login (using bcrypt for password hashing)
app.post('/api/login', asyncHandler(async (req, res) => {
    const { username, password } = req.body;
    const db = await dbPromise;
    const user = await db.get(`
        SELECT u.*, sd.student_code, sd.room
        FROM users u
        LEFT JOIN student_details sd ON u.id = sd.user_id
        WHERE u.username = ?
    `, username);

    if (!user) {
        await logAction(null, username, 'LOGIN_FAIL', { reason: 'User not found' });
        return res.status(401).json({ error: 'Invalid credentials.' });
    }

    const passwordMatch = await bcrypt.compare(password, user.password);

    if (passwordMatch) {
        req.session.user = {
            id: user.id,
            username: user.username,
            name: user.name,
            role: user.role,
            student_code: user.student_code,
            room: user.room
        };
        res.json({ success: true });
        await logAction(user.id, user.username, 'LOGIN_SUCCESS');
    } else {
        res.status(401).json({ error: 'Invalid credentials.' });
        await logAction(user.id, username, 'LOGIN_FAIL', { reason: 'Invalid password' });
    }
}));

app.post('/api/setup', asyncHandler(async (req, res) => {
    // This route should only work if no admin exists
    if (!needsSetup) {
        return res.status(403).json({ error: 'Setup has already been completed.' });
    }

    const { name, username, password } = req.body;
    if (!name || !username || !password) {
        return res.status(400).json({ error: 'All fields are required.' });
    }

    const db = await dbPromise;
    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

    await db.run(
        "INSERT INTO users (username, password, role, name) VALUES (?, ?, 'admin', ?)",
        [username, hashedPassword, name]
    );

    needsSetup = false; // Flip the flag now that an admin is created
    console.log('--- ADMIN ACCOUNT CREATED ---');
    console.log(`Username: ${username}`);
    console.log('Application is now in normal operating mode.');
    console.log('-----------------------------');
    res.status(201).json({ success: true, message: 'Admin account created successfully.' });
    await logAction(null, username, 'CREATE_ADMIN', { name });
}));

app.post('/api/request-password-reset', asyncHandler(async (req, res) => {
    const { username } = req.body;
    if (!username) {
        return res.status(400).json({ error: 'Username is required.' });
    }

    const db = await dbPromise;
    const user = await db.get('SELECT username FROM users WHERE username = ?', username);

    if (user) {
        const token = crypto.randomBytes(32).toString('hex');
        const expiry = Date.now() + 3600000; // 1 hour from now

        await db.run('UPDATE users SET reset_token = ?, reset_token_expiry = ? WHERE username = ?', [token, expiry, username]);

        // --- IMPORTANT ---
        // In a real application, you would send an email here.
        // For this demo, we will log the reset link to the server console.
        const resetLink = `http://localhost:${PORT}/reset-password.html?token=${token}`;
        console.log('--- PASSWORD RESET ---');
        console.log(`A password reset was requested for user: ${username}`);
        console.log(`Reset Link (valid for 1 hour): ${resetLink}`);
        console.log('----------------------');
        await logAction(user?.id, username, 'REQUEST_PASSWORD_RESET');
    }

    // Always send a success message to prevent username enumeration
    res.json({ message: 'If an account with that username exists, a reset link has been generated. (For this demo, check the server console for the link.)' });
}));

app.post('/api/reset-password', asyncHandler(async (req, res) => {
    const { token, newPassword } = req.body;
    if (!token || !newPassword) {
        return res.status(400).json({ error: 'Token and new password are required.' });
    }

    const db = await dbPromise;
    const user = await db.get('SELECT * FROM users WHERE reset_token = ? AND reset_token_expiry > ?', [token, Date.now()]);

    if (!user) {
        return res.status(400).json({ error: 'Invalid or expired password reset token.' });
    }

    const hashedPassword = await bcrypt.hash(newPassword, SALT_ROUNDS);
    await db.run('UPDATE users SET password = ?, reset_token = NULL, reset_token_expiry = NULL WHERE username = ?', [hashedPassword, user.username]);

    res.json({ message: 'Password has been reset successfully.' });
    await logAction(user.id, user.username, 'COMPLETE_PASSWORD_RESET');
}));

app.post('/api/student-setup/validate', asyncHandler(async (req, res) => {
    const { student_code } = req.body;
    if (!student_code) {
        return res.status(400).json({ error: 'Student ID is required.' });
    }

    const db = await dbPromise;
    const student = await db.get(`
        SELECT u.name, u.username
        FROM users u
        JOIN student_details sd ON u.id = sd.user_id
        WHERE sd.student_code = ? AND u.role = 'student'
    `, student_code);

    if (!student) {
        return res.status(404).json({ error: 'Student ID not found.' });
    }

    if (student.username) { // If username is not NULL, account is already set up
        return res.status(409).json({ error: 'This account has already been set up. Please log in or use "Forgot Password".' });
    }

    res.json({ success: true, name: student.name });
}));

app.post('/api/student-setup/complete', asyncHandler(async (req, res) => {
    const { student_code, username, password } = req.body;
    if (!student_code || !username || !password) {
        return res.status(400).json({ error: 'Student ID, username, and password are required.' });
    }

    const db = await dbPromise;

    // Check if the target student record is valid for setup
    const student = await db.get(`
        SELECT u.id, u.username
        FROM users u
        JOIN student_details sd ON u.id = sd.user_id
        WHERE sd.student_code = ? AND u.role = 'student'
    `, student_code);
    if (!student || student.username) {
        return res.status(403).json({ error: 'This account is not eligible for setup.' });
    }

    // Check if the desired username is already taken by anyone
    const existingUser = await db.get('SELECT id FROM users WHERE username = ?', username);
    if (existingUser) {
        return res.status(409).json({ error: 'This username is already taken. Please choose another.' });
    }

    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

    await db.run(
        'UPDATE users SET username = ?, password = ? WHERE id = ?',
        [username, hashedPassword, student.id]
    );

    res.status(200).json({ success: true, message: 'Account setup complete! You can now log in.' });
}));

app.post('/api/logout', async (req, res, next) => {
    if (req.session.user) {
        await logAction(req.session.user.id, req.session.user.username, 'LOGOUT');
    }
    req.session.destroy((err) => {
        if (err) {
            // If there's an error destroying the session, pass it to the error handler
            return next(err);
        }
        // The session cookie is typically cleared automatically by `destroy`. We can send a no-content response to signify success.
        res.status(204).send();
    });
});

// Endpoint for the frontend to check session status
app.get('/api/session', (req, res) => {
    if (needsSetup) {
        // If in setup mode, always report as unauthenticated
        // and include a flag for the client to redirect.
        return res.json({ authenticated: false, needsSetup: true });
    }
    if (req.session.user) {
        res.json({ authenticated: true, user: req.session.user });
    } else {
        res.json({ authenticated: false });
    }
});

// Student Management (now protected)
app.get('/api/students', isAuthenticated, asyncHandler(async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10; // Default to 10 students per page
    const search = req.query.search || '';
    const offset = (page - 1) * limit;

    try {
        const db = await dbPromise;
        const searchTerm = `%${search}%`;

        // Get total count for pagination, considering the search term
        const totalResult = await db.get(
            "SELECT COUNT(*) as count FROM users WHERE role = 'student' AND name LIKE ?",
            [searchTerm]
        );
        const totalStudents = totalResult.count;
        const totalPages = Math.ceil(totalStudents / limit);

        // Get students for the current page
        const students = await db.all(
            `SELECT u.username, u.name, sd.student_code, sd.age, sd.gender, sd.room
             FROM users u
             JOIN student_details sd ON u.id = sd.user_id
             WHERE u.role = 'student' AND u.name LIKE ?
             ORDER BY sd.student_code LIMIT ? OFFSET ?`,
            [searchTerm, limit, offset]
        );

        res.json({
            students,
            pagination: {
                currentPage: page,
                totalPages,
                totalStudents,
            },
        });
    } catch (err) {
        // This catch is now handled by the asyncHandler wrapper
        throw err;
    }
}));

app.post('/api/students', requireRole(['admin', 'registrar']), asyncHandler(async (req, res) => {
    const { name, age, gender, room, student_code: manualCode } = req.body;
    if (!name || !age || !gender || !room) {
        return res.status(400).json({ error: 'Name, age, gender, and room are required.' });
    }

    const db = await dbPromise;
    await db.run('BEGIN');
    try {
        let studentCode = manualCode ? manualCode.trim() : null;

        if (studentCode) {
            // Check if manual code is already taken
            const existing = await db.get('SELECT user_id FROM student_details WHERE student_code = ?', studentCode);
            if (existing) {
                await db.run('ROLLBACK');
                return res.status(409).json({ error: 'This Student ID is already in use.' });
            }
        } else {
                // Generate a new code with year-prefix and per-year sequence
                studentCode = await generateStudentCode(db);
        }

        // 1. Insert into users table
        const userResult = await db.run(
            "INSERT INTO users (role, name) VALUES ('student', ?)",
            [name]
        );
        const userId = userResult.lastID;

        // 2. Insert into student_details table
        await db.run(
            "INSERT INTO student_details (user_id, student_code, age, gender, room) VALUES (?, ?, ?, ?, ?)",
            [userId, studentCode, age, gender, room]
        );

        await db.run('COMMIT');
        await logAction(req.session.user.id, req.session.user.username, 'CREATE_STUDENT', { student_code: studentCode, name });
        res.status(201).json({ id: userId, student_code: studentCode, ...req.body });
    } catch (err) {
        await db.run('ROLLBACK');
        throw err;
    }
}));

app.delete('/api/students/:code', requireRole(['admin', 'registrar']), asyncHandler(async (req, res) => {
    try {
        const db = await dbPromise;
        const student = await db.get('SELECT user_id FROM student_details WHERE student_code = ?', req.params.code);
        if (!student) {
            return res.status(404).json({ error: 'Student not found.' });
        }
        const result = await db.run('DELETE FROM users WHERE id = ?', student.user_id);
        if (result.changes > 0) {
            await logAction(req.session.user.id, req.session.user.username, 'DELETE_STUDENT', { student_code: req.params.code });
            res.json({ message: 'Student deleted successfully.' });
        } else {
            res.status(404).json({ error: 'Student not found.' });
        }
    } catch (err) {
        throw err;
    }
}));

app.put('/api/students/:code', requireRole(['admin', 'registrar']), asyncHandler(async (req, res) => {
    const { code } = req.params;
    const { name, age, gender, room, student_code: newStudentCode } = req.body;

    if (!name || !age || !gender || !room) {
        return res.status(400).json({ error: 'All fields are required.' });
    }

    const db = await dbPromise;
    try {
        await db.run('BEGIN');

        const student = await db.get('SELECT user_id FROM student_details WHERE student_code = ?', code);
        if (!student) {
            await db.run('ROLLBACK');
            return res.status(404).json({ error: 'Student not found.' });
        }

        // Update the two tables
        await db.run('UPDATE users SET name = ? WHERE id = ?', [name, student.user_id]);

        // If a new student code is provided, update it.
        if (newStudentCode && newStudentCode !== code) {
            const existing = await db.get('SELECT user_id FROM student_details WHERE student_code = ?', newStudentCode);
            if (existing) {
                await db.run('ROLLBACK');
                return res.status(409).json({ error: 'The new Student ID is already in use.' });
            }
            await db.run('UPDATE student_details SET student_code = ?, age = ?, gender = ?, room = ? WHERE user_id = ?', [newStudentCode, age, gender, room, student.user_id]);
        } else {
            await db.run('UPDATE student_details SET age = ?, gender = ?, room = ? WHERE user_id = ?', [age, gender, room, student.user_id]);
        }

        await db.run('COMMIT');
        await logAction(req.session.user.id, req.session.user.username, 'UPDATE_STUDENT', { student_code: code, name });
        res.json({ message: 'Student updated successfully.' });
    } catch (err) {
        await db.run('ROLLBACK');
        throw err;
    }
}));

app.post('/api/students/upload-csv', requireRole(['admin', 'registrar']), upload.single('studentCsv'), asyncHandler(async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No CSV file uploaded.' });
    }

    const db = await dbPromise;
    const results = [];
    const errors = [];

    // Create a readable stream from the buffer provided by multer's memoryStorage
    const bufferStream = new Readable();
    bufferStream.push(req.file.buffer);
    bufferStream.push(null);

    bufferStream.pipe(csv())
        .on('data', (data) => results.push(data))
        .on('end', async () => {
            let successfulUploads = 0;

            for (const student of results) {
                const { name, age, gender, room, student_code: manualCode } = student;

                // Basic validation for required fields in the CSV row
                if (!name || !age || !gender || !room) {
                    errors.push({ student: name || 'Unknown Row', error: 'Missing required fields (name, age, gender, room).' });
                    continue;
                }

                await db.run('BEGIN');
                try {
                    let studentCode = manualCode ? manualCode.trim() : null;

                    if (studentCode) {
                        const existing = await db.get('SELECT user_id FROM student_details WHERE student_code = ?', studentCode);
                        if (existing) {
                            throw new Error(`Student ID ${studentCode} is already in use.`);
                        }
                    } else {
                        // Generate a per-year student code like YYYY-XXX
                        studentCode = await generateStudentCode(db);
                    }

                    const userResult = await db.run("INSERT INTO users (role, name) VALUES ('student', ?)", [name]);
                    const userId = userResult.lastID;

                    await db.run("INSERT INTO student_details (user_id, student_code, age, gender, room) VALUES (?, ?, ?, ?, ?)", [userId, studentCode, age, gender, room]);
                    await db.run('COMMIT');
                    successfulUploads++;
                    await logAction(req.session.user.id, req.session.user.username, 'BULK_CREATE_STUDENT', { student_code: studentCode, name });
                } catch (err) {
                    await db.run('ROLLBACK');
                    errors.push({ student: name, error: err.message });
                }
            }

            res.json({ message: `Bulk upload complete. Successfully added ${successfulUploads} of ${results.length} students.`, errors, totalRows: results.length });
        });
}));

// --- Staff Management (Admin Only) ---
app.use('/api/staff', requireRole(['admin']));

app.get('/api/staff', asyncHandler(async (req, res) => {
    const db = await dbPromise;
    // Get all users who are not students or the current admin to prevent self-deletion in UI
    const staff = await db.all(
        "SELECT id, username, name, role FROM users WHERE role IN ('registrar', 'teacher') ORDER BY name"
    );
    res.json(staff);
}));

app.post('/api/staff', asyncHandler(async (req, res) => {
    const { name, username, password, role } = req.body;
    if (!name || !username || !password || !role) {
        return res.status(400).json({ error: 'Name, username, password, and role are required.' });
    }
    if (!['teacher', 'registrar'].includes(role)) {
        return res.status(400).json({ error: 'Invalid role specified.' });
    }

    const db = await dbPromise;
    // Check if username is taken
    const existing = await db.get('SELECT id FROM users WHERE username = ?', username);
    if (existing) {
        return res.status(409).json({ error: 'Username is already taken.' });
    }

    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
    const result = await db.run(
        'INSERT INTO users (name, username, password, role) VALUES (?, ?, ?, ?)',
        [name, username, hashedPassword, role]
    );

    await logAction(req.session.user.id, req.session.user.username, 'CREATE_STAFF', { new_user_id: result.lastID, new_username: username, role });
    res.status(201).json({ id: result.lastID, message: 'Staff user created.' });
}));

app.delete('/api/staff/:id', asyncHandler(async (req, res) => {
    const { id } = req.params;
    const db = await dbPromise;
    const result = await db.run("DELETE FROM users WHERE id = ? AND role IN ('teacher', 'registrar')", id);

    if (result.changes > 0) {
        await logAction(req.session.user.id, req.session.user.username, 'DELETE_STAFF', { deleted_user_id: id });
        res.json({ message: 'Staff user deleted successfully.' });
    } else {
        res.status(404).json({ error: 'Staff user not found or you are not allowed to delete this user.' });
    }
}));

app.post('/api/staff/:id/reset-password', requireRole(['admin']), asyncHandler(async (req, res) => {
    const { id } = req.params;
    const db = await dbPromise;
    const user = await db.get('SELECT id, username FROM users WHERE id = ?', id);

    if (!user) {
        return res.status(404).json({ error: 'User not found.' });
    }

    const token = crypto.randomBytes(32).toString('hex');
    const expiry = Date.now() + 3600000; // 1 hour

    await db.run('UPDATE users SET reset_token = ?, reset_token_expiry = ? WHERE id = ?', [token, expiry, id]);

    const resetLink = `http://localhost:${PORT}/reset-password.html?token=${token}`;
    console.log('--- ADMIN-INITIATED PASSWORD RESET ---');
    console.log(`Reset link generated for user: ${user.username} (ID: ${user.id})`);
    console.log(`Link (valid for 1 hour): ${resetLink}`);
    console.log('------------------------------------');

    await logAction(req.session.user.id, req.session.user.username, 'ADMIN_RESET_PASSWORD', { target_user_id: user.id, target_username: user.username });
    res.json({ message: `Password reset link for ${user.username} has been generated.`, resetLink });
}));

// --- Student History ---
app.get('/api/students-list', requireRole(['admin', 'teacher']), asyncHandler(async (req, res) => {
    const db = await dbPromise;
    const students = await db.all(`
        SELECT u.name, sd.student_code
        FROM users u
        JOIN student_details sd ON u.id = sd.user_id
        WHERE u.role = 'student'
        ORDER BY u.name
    `);
    res.json(students);
}));

app.get('/api/student-history', requireRole(['admin', 'teacher']), asyncHandler(async (req, res) => {
    const { student_code, startDate, endDate } = req.query;
    if (!student_code || !startDate || !endDate) {
        return res.status(400).json({ error: 'Student, start date, and end date are required.' });
    }
    const db = await dbPromise;
    const records = await db.all(`
        SELECT a.date, a.time, a.status
        FROM attendance a
        JOIN users u ON a.user_id = u.id
        JOIN student_details sd ON u.id = sd.user_id
        WHERE sd.student_code = ? AND a.date BETWEEN ? AND ?
        ORDER BY a.date DESC
    `, [student_code, startDate, endDate]);
    res.json(records);
}));

// --- Student Profile ---
app.get('/api/student-profile/:student_code', requireRole(['admin', 'teacher']), asyncHandler(async (req, res) => {
    const { student_code } = req.params;
    const db = await dbPromise;

    // 1. Get student details
    const student = await db.get(`
        SELECT u.id, u.name, sd.student_code, sd.age, sd.gender, sd.room
        FROM users u
        JOIN student_details sd ON u.id = sd.user_id
        WHERE sd.student_code = ?
    `, student_code);

    if (!student) {
        return res.status(404).json({ error: 'Student not found.' });
    }

    const { id: userId, ...details } = student;

    // 2. Get last 30 days of attendance
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const startDate = thirtyDaysAgo.toISOString().split('T')[0];
    const today = new Date().toISOString().split('T')[0];

    const attendance = await db.all(`
        SELECT date, time, status
        FROM attendance
        WHERE user_id = ? AND date BETWEEN ? AND ?
        ORDER BY date DESC
    `, [userId, startDate, today]);

    // 3. Get all excuses
    const excuses = await db.all(`
        SELECT date, reason, status
        FROM excuses
        WHERE user_id = ?
        ORDER BY date DESC
    `, userId);

    res.json({ details, attendance, excuses });
}));

// --- Dashboard Summary ---
app.get('/api/dashboard-summary', isAuthenticated, asyncHandler(async (req, res) => {
    const db = await dbPromise;
    const today = new Date().toISOString().split('T')[0];

    // 1. Total students
    const totalStudentsResult = await db.get("SELECT COUNT(*) as count FROM users WHERE role = 'student'");
    const totalStudents = totalStudentsResult.count;

    // 2. Pending excuses
    const pendingExcusesResult = await db.get("SELECT COUNT(*) as count FROM excuses WHERE status = 'Pending'");
    const pendingExcuses = pendingExcusesResult.count;

    // 3. Today's attendance summary
    // First, ensure today's attendance records exist.
    const allStudents = await db.all("SELECT id FROM users WHERE role = 'student'");
    if (allStudents.length > 0) {
        const studentsWithRecords = await db.all('SELECT user_id FROM attendance WHERE date = ?', today);
        const studentsWithRecordsIds = new Set(studentsWithRecords.map(r => r.user_id));
        const missingStudents = allStudents.filter(s => !studentsWithRecordsIds.has(s.id));

        if (missingStudents.length > 0) {
            await db.run('BEGIN');
            const stmt = await db.prepare('INSERT OR IGNORE INTO attendance (user_id, date, time, status) VALUES (?, ?, ?, ?)');
            for (const student of missingStudents) {
                await stmt.run(student.id, today, '--', 'Absent');
            }
            await stmt.finalize();
            await db.run('COMMIT');
        }
    }

    const attendanceRows = await db.all(
        `SELECT status, COUNT(status) as count FROM attendance WHERE date = ? GROUP BY status`,
        [today]
    );

    const todaysSummary = { Present: 0, Late: 0, Absent: 0, Excused: 0 };
    attendanceRows.forEach(row => {
        if (todaysSummary.hasOwnProperty(row.status)) {
            todaysSummary[row.status] = row.count;
        }
    });

    res.json({
        totalStudents,
        pendingExcuses,
        todaysSummary
    });
}));
// --- PUBLIC API Endpoints (Student and Teacher) ---

app.get('/api/attendance/:date', asyncHandler(async (req, res) => {
    const { date } = req.params;
    const db = await dbPromise;
    try {
        // This logic ensures that all students have an attendance record for the given date.
        // It's more robust than a cron job as it runs on-demand.

        // 1. Get all student IDs
        const allStudents = await db.all("SELECT id FROM users WHERE role = 'student'");
        if (allStudents.length > 0) {
            // 2. Get IDs of students who already have an attendance record for this date
            const studentsWithRecords = await db.all('SELECT user_id FROM attendance WHERE date = ?', date);
            const studentsWithRecordsIds = new Set(studentsWithRecords.map(r => r.user_id));

            // 3. Find students who are missing a record
            const missingStudents = allStudents.filter(s => !studentsWithRecordsIds.has(s.id));

            // 4. Insert 'Absent' records for them if any are missing
            if (missingStudents.length > 0) {
                await db.run('BEGIN');
                // Use INSERT OR IGNORE to be safe in case of race conditions
                const stmt = await db.prepare('INSERT OR IGNORE INTO attendance (user_id, date, time, status) VALUES (?, ?, ?, ?)');
                for (const student of missingStudents) {
                    await stmt.run(student.id, date, '--', 'Absent');
                }
                await stmt.finalize();
                await db.run('COMMIT');
            }
        }

        // Now, fetch the complete list which is guaranteed to be populated
        const attendanceList = await db.all(`
            SELECT a.id, a.date, a.time, a.status, sd.student_code, u.name
            FROM attendance a
            JOIN users u ON u.id = a.user_id
            JOIN student_details sd ON u.id = sd.user_id
            WHERE a.date = ?
            ORDER BY sd.student_code
        `, date);

        res.json(attendanceList);
    } catch (err) {
        // In case of error during transaction, attempt a rollback
        try { await db.run('ROLLBACK'); } catch (e) { /* ignore if no transaction was active */ }
        throw err;
    }
}));

app.put('/api/attendance', requireRole(['admin', 'teacher']), asyncHandler(async (req, res) => {
    const { date, student_code, status } = req.body;
    if (!date || !student_code || !status) {
        return res.status(400).json({ error: 'Date, student code, and status are required.' });
    }
    try {
        const db = await dbPromise;
        const now = new Date();
        const time = (status === 'Present' || status === 'Late') 
            ? `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`
            : '--';
        
        const user = await db.get(`
            SELECT u.id FROM users u
            JOIN student_details sd ON u.id = sd.user_id
            WHERE sd.student_code = ?
        `, student_code);
        if (!user) {
            return res.status(404).json({ error: 'Student not found.' });
        }
        const result = await db.run('UPDATE attendance SET status = ?, time = ? WHERE date = ? AND user_id = ?', [status, time, date, user.id]);

        if (result.changes > 0) {
            await logAction(req.session.user.id, req.session.user.username, 'UPDATE_ATTENDANCE', { student_code, date, status });
            res.json({ message: 'Attendance updated.' });
        } else {
            res.status(404).json({ error: 'Attendance record not found.' });
        }
    } catch (err) {
        throw err;
    }
}));

// Export attendance to CSV
app.get('/api/attendance/:date/csv', requireRole(['admin', 'teacher']), asyncHandler(async (req, res) => {
    const { date } = req.params;
    try {
        const db = await dbPromise;
        const records = await db.all(`
            SELECT sd.student_code, u.name, a.time, a.status
            FROM attendance a
            JOIN users u ON u.id = a.user_id
            JOIN student_details sd ON u.id = sd.user_id
            WHERE a.date = ? ORDER BY sd.student_code
        `, date);

        if (records.length === 0) {
            // Send a CSV with only headers if no records are found
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', `attachment; filename="attendance-${date}.csv"`);
            return res.status(200).send('"Code","Name","Time","Status"\n');
        }

        // CSV header
        const csvHeader = '"Code","Name","Time","Status"\n';
        // CSV rows
        const csvRows = records.map(r => `"${r.student_code}","${r.name}","${r.time}","${r.status}"`).join('\n');

        const csvData = csvHeader + csvRows;

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="attendance-${date}.csv"`);
        res.status(200).send(csvData);
    } catch (err) {
        throw err;
    }
}));

// Excuse Management (viewing pending is protected)
app.get('/api/excuses', requireRole(['admin', 'teacher']), asyncHandler(async (req, res) => {
    try {
        const db = await dbPromise;
        const excuses = await db.all(`
            SELECT e.id, e.date, e.reason, e.status, sd.student_code, u.name
            FROM excuses e
            JOIN users u ON u.id = e.user_id
            JOIN student_details sd ON u.id = sd.user_id
            WHERE e.status = 'Pending'
        `);
        res.json(excuses);
    } catch (err) {
        throw err;
    }
}));

// This route is now replaced by the student-specific one below
/*
app.post('/api/excuses', requireRole(['student']), async (req, res) => {
    const { code, reason, date } = req.body;
    if (!code || !reason || !date) {
        return res.status(400).json({ error: 'Student code, date, and reason are required.' });
    }

    // Server-side validation to prevent submitting for past dates
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const excuseDate = new Date(date);

    if (excuseDate < today) {
        return res.status(400).json({ error: 'Cannot submit an excuse for a past date.' });
    }

    try {
        const db = await dbPromise;
        const student = await db.get("SELECT name FROM users WHERE student_code = ? AND role = 'student'", req.session.user.student_code);
        if (!student) {
            return res.status(404).json({ error: 'Student code not found.' });
        }
        const result = await db.run('INSERT INTO excuses (student_code, name, date, reason) VALUES (?, ?, ?, ?)', [req.session.user.student_code, req.session.user.name, date, reason]);
        res.status(201).json({ id: result.lastID, message: 'Excuse submitted.' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
*/

// Approving/denying is protected
app.put('/api/excuses/:id/approve', requireRole(['admin', 'teacher']), asyncHandler(async (req, res) => {
    const { id } = req.params;
    const db = await dbPromise;
    try {
        const excuse = await db.get('SELECT user_id, date FROM excuses WHERE id = ?', id);
        if (!excuse) {
            return res.status(404).json({ error: 'Excuse not found.' });
        }

        // Use the date from the excuse record itself, not from the request body
        const { user_id, date } = excuse;

        await db.run('BEGIN');
        await db.run("UPDATE excuses SET status = 'Approved' WHERE id = ?", id);
        await db.run(`
            INSERT INTO attendance (user_id, date, time, status)
            VALUES (?, ?, '--', 'Excused')
            ON CONFLICT(user_id, date) DO UPDATE SET
            status = 'Excused', time = '--';
        `, [user_id, date]);
        await db.run('COMMIT');

        await logAction(req.session.user.id, req.session.user.username, 'APPROVE_EXCUSE', { excuse_id: id, student_user_id: user_id });
        res.json({ message: 'Excuse approved and attendance updated.' });
    } catch (err) {
        await db.run('ROLLBACK');
        throw err;
    }
}));

app.put('/api/excuses/:id/deny', requireRole(['admin', 'teacher']), asyncHandler(async (req, res) => {
    try {
        const db = await dbPromise;
        const result = await db.run("UPDATE excuses SET status = 'Denied' WHERE id = ?", req.params.id);
        if (result.changes > 0) {
            await logAction(req.session.user.id, req.session.user.username, 'DENY_EXCUSE', { excuse_id: req.params.id });
            res.json({ message: 'Excuse denied.' });
        } else {
            res.status(404).json({ error: 'Excuse not found.' });
        }
    } catch (err) {
        throw err;
    }
}));

app.put('/api/excuses/:id', requireRole(['admin', 'teacher']), asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { reason, date } = req.body;
    if (!reason || !date) {
        return res.status(400).json({ error: 'Reason and date are required.' });
    }

    const db = await dbPromise;
    // Only allow updating excuses that are still 'Pending'
    const result = await db.run(
        "UPDATE excuses SET reason = ?, date = ? WHERE id = ? AND status = 'Pending'",
        [reason, date, id]
    );

    if (result.changes > 0) {
        await logAction(req.session.user.id, req.session.user.username, 'UPDATE_EXCUSE', { excuse_id: id, new_date: date });
        res.json({ message: 'Excuse updated successfully.' });
    } else {
        res.status(404).json({ error: 'Excuse not found or it has already been processed.' });
    }
}));

app.delete('/api/excuses/:id', requireRole(['admin', 'teacher']), asyncHandler(async (req, res) => {
    const { id } = req.params;
    const db = await dbPromise;
    const result = await db.run("DELETE FROM excuses WHERE id = ?", id);

    if (result.changes > 0) {
        await logAction(req.session.user.id, req.session.user.username, 'DELETE_EXCUSE', { excuse_id: id });
        res.json({ message: 'Excuse deleted successfully.' });
    } else {
        res.status(404).json({ error: 'Excuse not found.' });
    }
}));

// Get attendance summary for a student (public)
app.get('/api/summary/:student_code', asyncHandler(async (req, res) => {
    const { student_code } = req.params;
    const { start, end } = req.query;

    if (!start || !end) {
        return res.status(400).json({ error: 'Start and end dates are required.' });
    }

    try {
        const db = await dbPromise;

        const student = await db.get(`
            SELECT u.id, u.name, sd.student_code, sd.room FROM users u
            JOIN student_details sd ON u.id = sd.user_id
            WHERE sd.student_code = ? AND u.role = 'student'
        `, student_code);

        if (!student) {
            return res.status(404).json({ error: 'Student not found.' });
        }

        const rows = await db.all(
            `SELECT status, COUNT(status) as count
             FROM attendance
             WHERE user_id = ? AND date BETWEEN ? AND ?
             GROUP BY status`,
            [student.id, start, end]
        );

        const summary = { Present: 0, Late: 0, Absent: 0, Excused: 0 };

        rows.forEach(row => {
            if (summary.hasOwnProperty(row.status)) {
                summary[row.status] = row.count;
            }
        });

        res.json({ name: student.name, student_code: student.student_code, room: student.room, summary });
    } catch (err) {
        throw err;
    }
}));

// New public endpoint to validate a student code and get their name
app.get('/api/public/student/:code', asyncHandler(async (req, res) => {
    const { code } = req.params;
    const db = await dbPromise;
    const student = await db.get(`
        SELECT u.name, sd.student_code
        FROM users u
        JOIN student_details sd ON u.id = sd.user_id
        WHERE sd.student_code = ? AND u.role = 'student'
    `, code);
    if (student) {
        res.json(student);
    } else {
        res.status(404).json({ error: 'Student code not found.' });
    }
}));

// --- Student-Specific Protected API Endpoints ---
app.use('/api/student', requireRole(['student']));

app.post('/api/student/excuse', asyncHandler(async (req, res) => {
    const { reason, date } = req.body;
    const { id: user_id } = req.session.user;

    if (!reason || !date) {
        return res.status(400).json({ error: 'Date and reason are required.' });
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (new Date(date) < today) {
        return res.status(400).json({ error: 'Cannot submit an excuse for a past date.' });
    }

    const db = await dbPromise;
    // Use INSERT ON CONFLICT to allow students to update their excuse reason if it's still pending.
    // This prevents duplicate excuses for the same day and handles the new UNIQUE constraint.
    const result = await db.run(`
        INSERT INTO excuses (user_id, date, reason)
        VALUES (?, ?, ?)
        ON CONFLICT(user_id, date) DO UPDATE SET
        reason = excluded.reason,
        status = 'Pending'
        WHERE excuses.status = 'Pending'
    `, [user_id, date, reason]);

    if (result.changes > 0) {
        res.status(201).json({ message: 'Excuse submitted or updated successfully.' });
    } else {
        // This happens if the student tries to update an already approved/denied excuse.
        res.status(403).json({ error: 'Cannot update an excuse that has already been processed.' });
    }
}));

app.get('/api/student/summary', asyncHandler(async (req, res) => {
    const { id: user_id } = req.session.user;
    const { start, end } = req.query;
    if (!start || !end) {
        return res.status(400).json({ error: 'Start and end dates are required.' });
    }
    try {
        const db = await dbPromise;
        const rows = await db.all(`SELECT status, COUNT(status) as count FROM attendance WHERE user_id = ? AND date BETWEEN ? AND ? GROUP BY status`, [user_id, start, end]);
        const summary = { Present: 0, Late: 0, Absent: 0, Excused: 0 };
        rows.forEach(row => { if (summary.hasOwnProperty(row.status)) summary[row.status] = row.count; });
        res.json(summary);
    } catch (err) {
        throw err;
    }
}));

// Audit Log (admin only)
app.get('/api/audit-logs', requireRole(['admin']), asyncHandler(async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = 20; // Fixed limit for logs
    const offset = (page - 1) * limit;

    const db = await dbPromise;
    const logs = await db.all(
        'SELECT * FROM audit_logs ORDER BY timestamp DESC LIMIT ? OFFSET ?',
        [limit, offset]
    );
    const totalResult = await db.get('SELECT COUNT(*) as count FROM audit_logs');
    const totalLogs = totalResult.count;
    const totalPages = Math.ceil(totalLogs / limit);

    res.json({
        logs,
        pagination: {
            currentPage: page,
            totalPages,
            totalLogs,
        },
    });
}));

// --- Generic Authenticated User Actions ---

app.post('/api/user/change-password', isAuthenticated, asyncHandler(async (req, res) => {
    const { currentPassword, newPassword } = req.body;
    const { id: userId, username } = req.session.user;

    if (!currentPassword || !newPassword) {
        return res.status(400).json({ error: 'Current and new passwords are required.' });
    }

    const db = await dbPromise;
    const user = await db.get('SELECT password FROM users WHERE id = ?', userId);

    // This should not happen if the user is logged in, but as a safeguard
    if (!user) {
        return res.status(404).json({ error: 'User not found.' });
    }

    const passwordMatch = await bcrypt.compare(currentPassword, user.password);

    if (!passwordMatch) {
        await logAction(userId, username, 'CHANGE_PASSWORD_FAIL', { reason: 'Incorrect current password' });
        return res.status(403).json({ error: 'Incorrect current password.' });
    }

    const hashedNewPassword = await bcrypt.hash(newPassword, SALT_ROUNDS);
    await db.run('UPDATE users SET password = ? WHERE id = ?', [hashedNewPassword, userId]);

    await logAction(userId, username, 'CHANGE_PASSWORD_SUCCESS');
    res.json({ success: true, message: 'Password changed successfully.' });
}));

// --- Serve Frontend ---

// Redirect root to login or dashboard
app.get('/', (req, res) => {
    if (needsSetup) {
        return res.sendFile(path.join(__dirname, 'public', 'setup.html'));
    }
    if (req.session.user) {
        // If user is logged in, redirect to their respective dashboard
        const dashboard = req.session.user.role === 'student' ? '/student-dashboard.html' : '/dashboard.html';
        res.redirect(dashboard);
    } else {
        // If not logged in, serve the login page as the default
        res.sendFile(path.join(__dirname, 'public', 'login.html'));
    }
});

// Protect dashboard page
app.get('/dashboard.html', (req, res, next) => {
    if (!req.session.user) return res.redirect('/login.html');
    if (req.session.user.role === 'student') return res.status(403).send('Access Denied');
    next();
});

app.get('/student-dashboard.html', (req, res, next) => {
    if (!req.session.user || req.session.user.role !== 'student') return res.redirect('/login.html');
    next();
});

// --- Start Server ---
async function startServer() {
    try {
        // Wait for the database connection to be established
        const db = await dbPromise;
        console.log('Database connection established.');

        // Ensure schema exists (idempotent) before running queries that rely on tables
        if (typeof dbPromise.ensureSchema === 'function') {
            await dbPromise.ensureSchema();
        }

        // Check if an admin user exists
        const adminUser = await db.get("SELECT username FROM users WHERE role = 'admin'");
        if (!adminUser) {
            needsSetup = true;
            console.log('!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');
            console.log('!!! NO ADMIN USER FOUND. RUNNING IN SETUP MODE.');
            console.log('!!! Visit http://localhost:3000 to create an admin account.');
            console.log('!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');
        }

        app.listen(PORT, () => {
            console.log(`Server running on http://localhost:${PORT}`);
        });
    } catch (err) {
        console.error('Failed to start server:', err);
        process.exit(1);
    }
}

startServer();

// Centralized error handler
app.use((err, req, res, next) => {
    console.error(err.stack);

    // Handle specific SQLite constraint errors, like for unique usernames
    if (err.code === 'SQLITE_CONSTRAINT') {
        return res.status(409).json({ error: 'A record with this identifier already exists.' });
    }

    res.status(500).json({
        error: 'An internal server error occurred.'
    });
});