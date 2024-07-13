const express = require('express');
const bodyParser = require('body-parser');
const session = require('express-session');
const PocketBase = require('pocketbase/cjs');
const expressWs = require('express-ws');
const EventSource = require('eventsource');
const path = require('path');
const favicon = require('serve-favicon');

const app = express();
expressWs(app);
const pb = new PocketBase('https://db.conbackend.com');

global.EventSource = EventSource;

app.use(favicon(path.join(__dirname, '../public/imgs/favicon', 'favicon.ico')));
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, '../public')));  // Serve static files

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '../views'));

app.use(session({
    secret: 'your-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 60000 }  // Set cookie max age
}));

// Middleware to check authentication
function checkAuth(req, res, next) {
    if (req.session && req.session.userId) {
        req.user = req.session.user;
        next();
    } else {
        res.redirect('/login');
    }
}

// Middleware to check if user is not authenticated
function checkNotAuth(req, res, next) {
    if (req.session && req.session.userId) {
        res.redirect('/');
    } else {
        next();
    }
}

// Routes
app.get('/', async (req, res) => {
    const user = req.session.user || null;
    res.render('index', { user });
});

app.get('/login', checkNotAuth, (req, res) => {
    res.render('login', { user: null });
});

app.get('/reservation', checkAuth, (req, res) => {
    const user = req.user;
    res.render('reservation', { user });
});

app.get('/unlock', checkAuth, (req, res) => {
    const user = req.user;
    res.render('unlock', { user });
});

app.get('/chat', checkAuth, (req, res) => {
    const user = req.user;
    res.render('chat', { user });
});

app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const authData = await pb.collection('users').authWithPassword(email, password);
        req.session.userId = authData.record.id;
        req.session.user = authData.record;
        res.redirect('/');
    } catch (err) {
        res.render('login', { user: null, error: 'Login failed: ' + err.message });
    }
});

app.post('/register', async (req, res) => {
    const { username, name, email, password } = req.body;
    try {
        const user = await pb.collection('users').create({
            username: username,
            name: name,
            email: email,
            password: password,
            passwordConfirm: password
        });
        req.session.user = user;
        res.redirect('/login');
    } catch (err) {
        res.render('login', { user: null, error: 'Registration failed: ' + err.message });
    }
});

app.ws('/updates', (ws, req) => {
    console.log('Client connected');
    pb.collection('1932Messages').subscribe('*', function (e) {
        if (e.action === 'create') {
            ws.send(JSON.stringify(e.record));
        }
    });

    ws.on('close', () => {
        console.log('Client disconnected');
    });
});

const adminEmail = 'contact@brewsocial.club'; // Replace with actual admin email
const adminPassword = 'PatchWork22!!';  // Replace with actual admin password

async function adminLogin() {
    const authData = await pb.admins.authWithPassword(adminEmail, adminPassword);
    return authData.token;
}

app.get('/api/messages', checkAuth, async (req, res) => {
    try {
        // Authenticate as admin
        const adminToken = await adminLogin();
        pb.authStore.save(adminToken);

        const messages = await pb.collection('1932Messages').getFullList({
            sort: '-created'
        });

        // Create a set to store unique userIds
        const uniqueUserIds = [...new Set(messages.map(message => message.userId))];

        // Fetch all unique user details
        const users = await Promise.all(uniqueUserIds.map(async userId => {
            try {
                const user = await pb.collection('users').getOne(userId);
                return { userId, name: user.name || 'Unknown' };
            } catch (err) {
                console.error(`Error fetching user details for userId ${userId}:`, err.message);
                return { userId, name: 'Unknown' };
            }
        }));

        // Create a userId to name mapping
        const userIdToNameMap = users.reduce((acc, user) => {
            acc[user.userId] = user.name;
            return acc;
        }, {});

        // Map messages to include full names
        const messagesWithFullNames = messages.map(message => ({
            ...message,
            fullName: userIdToNameMap[message.userId] || 'Unknown'
        }));

        console.log(messagesWithFullNames);
        res.json(messagesWithFullNames);
    } catch (err) {
        console.error('Error fetching messages:', err.message);
        res.status(500).json({ error: err.message });
    } finally {
        pb.authStore.clear(); // Clear admin authentication
    }
});

app.post('/chat', checkAuth, async (req, res) => {
    const { message } = req.body;
    try {
        const newMessage = await pb.collection('1932Messages').create({
            content: message,
            userId: req.session.userId
        });
        res.json({ success: true, message: newMessage });
    } catch (err) {
        res.json({ success: false, error: err.message });
    }
});

app.listen(3000, () => {
    console.log('Server is running on http://localhost:3000');
});
