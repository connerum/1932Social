const express = require('express');
const bodyParser = require('body-parser');
const session = require('express-session');
const PocketBase = require('pocketbase/cjs');
const expressWs = require('express-ws');
const EventSource = require('eventsource');

const app = express();
expressWs(app);  // Initialize express-ws
const pb = new PocketBase('https://db.conbackend.com');

global.EventSource = EventSource; // Polyfill EventSource

app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());
app.use(express.static('public'));  // Serve static files

// Set the view engine to EJS
app.set('view engine', 'ejs');
app.set('views', 'views');  // Set the views directory

// Use sessions to store user authentication state
app.use(session({
    secret: 'your-secret-key',
    resave: false,
    saveUninitialized: false
}));

// Middleware to check authentication
function checkAuth(req, res, next) {
    if (req.session && req.session.userId) {
        next();
    } else {
        res.redirect('/login');
    }
}

// Routes
app.get('/', (req, res) => {
    res.render('index');
});

app.get('/login', (req, res) => {
    res.render('login');
});

app.get('/chat', checkAuth, (req, res) => {
    const user = req.session.user;
    res.render('chat', { user });
});

app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const authData = await pb.collection('users').authWithPassword(email, password);
        req.session.userId = authData.record.id;
        req.session.user = authData.record;  // Store the user information in the session
        res.redirect('/');
    } catch (err) {
        res.render('login', { error: 'Login failed: ' + err.message });
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
        req.session.user = user;  // Store the user information in the session
        res.redirect('/login');
    } catch (err) {
        res.render('login', { error: 'Registration failed: ' + err.message });
    }
});

// WebSocket endpoint for real-time updates
app.ws('/updates', (ws, req) => {
    console.log('Client connected');

    // Subscribe to the PocketBase collection for real-time updates
    pb.collection('1932Messages').subscribe('*', function (e) {
        if (e.action === 'create') {
            ws.send(JSON.stringify(e.record));
        }
    });

    ws.on('close', () => {
        console.log('Client disconnected');
    });
});

app.get('/api/messages', checkAuth, async (req, res) => {
    try {
        const messages = await pb.collection('1932Messages').getFullList({
            sort: '-created'
        });
        res.json(messages);
    } catch (err) {
        res.status(500).json({ error: err.message });
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
