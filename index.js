import express from "express";
import bodyParser from "body-parser";
import pg from "pg";
import bcrypt from "bcrypt";
import path from "path";
import { fileURLToPath } from "url";
import session from "express-session";
import env from "dotenv";

// 1. Setup Environment Variables
env.config();

// 2. Setup for EJS views folder
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 3000;
const saltRounds = 10;

// 3. Database Configuration (Smart Switch)
let db;
if (process.env.DATABASE_URL) {
  // CLOUD (Render)
  db = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
} else {
  // LOCAL (Laptop)
  db = new pg.Client({
    user: "postgres",
    host: "localhost",
    database: "latt_db",
    password: process.env.DB_PASSWORD, 
    port: 5432,
  });
}

db.connect();

// 4. Middleware
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static("assets-Code")); 

// 5. Session Setup
app.use(session({
  secret: process.env.SESSION_SECRET || "secret_key",
  resave: false,
  saveUninitialized: true,
  cookie: { maxAge: 1000 * 60 * 60 * 24 } // 1 day
}));

// ================= ROUTES ================= //

// HOME
app.get("/", (req, res) => {
    res.render("welcome");
});

// LOGIN & REGISTER PAGES
app.get("/login", (req, res) => res.render("login"));
app.get("/register", (req, res) => res.render("register"));

// REGISTER LOGIC (Matches 'users' table)
app.post("/register", async (req, res) => {
  const { email, password, fullName } = req.body;

  try {
    const checkResult = await db.query("SELECT * FROM users WHERE email = $1", [email]);
    if (checkResult.rows.length > 0) {
      res.send("Email already exists. Try logging in.");
    } else {
      const hash = await bcrypt.hash(password, saltRounds);
      // Matches 'password_hash' and 'full_name' columns
      await db.query(
        "INSERT INTO users (email, password_hash, full_name) VALUES ($1, $2, $3)",
        [email, hash, fullName]
      );
      res.redirect("/login");
    }
  } catch (err) {
    console.error(err);
    res.status(500).send("Error registering user");
  }
});

// LOGIN LOGIC
app.post("/login", async (req, res) => {
  const { email, password } = req.body;

  try {
    const result = await db.query("SELECT * FROM users WHERE email = $1", [email]);
    if (result.rows.length > 0) {
      const user = result.rows[0];
      const valid = await bcrypt.compare(password, user.password_hash);
      if (valid) {
        req.session.user = user;
        res.redirect("/dashboard");
      } else {
        res.send("Incorrect Password");
      }
    } else {
      res.send("User not found");
    }
  } catch (err) {
    console.error(err);
    res.status(500).send("Error logging in");
  }
});

// LOGOUT
app.get("/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/"));
});

// DASHBOARD (Matches 'subscriptions' & 'services' tables)
app.get("/dashboard", async (req, res) => {
  if (!req.session.user) return res.redirect("/login");

  const currentUser = req.session.user;
  // Handle ID whether it's 'id' or 'user_id'
  const userId = currentUser.user_id || currentUser.id;

  try {
    const result = await db.query(`
      SELECT 
        subscriptions.subscription_id, 
        subscriptions.custom_price,
        subscriptions.renewal_date,
        subscriptions.billing_cycle,
        services.name AS service_name, 
        services.logo_url
      FROM subscriptions
      JOIN services ON subscriptions.service_id = services.service_id
      WHERE subscriptions.user_id = $1
      ORDER BY subscriptions.renewal_date ASC
    `, [userId]);

    const subs = result.rows;
    let totalSpending = 0;
    subs.forEach(sub => totalSpending += parseFloat(sub.custom_price));

    res.render("dashboard", { 
        userName: currentUser.full_name, 
        subscriptions: subs,
        total: totalSpending.toFixed(0)
    });

  } catch (err) {
    console.error("Dashboard Error:", err);
    res.status(500).send("Error fetching dashboard");
  }
});

// DISCOVERY PAGE
app.get("/discover", (req, res) => res.render("discover"));

// MANUAL ENTRY PAGE
app.get("/manual-entry", (req, res) => {
    if (!req.session.user) return res.redirect("/login");
    res.render("manual-entry", { 
        name: req.query.name, 
        price: req.query.price 
    });
});

// ADD SUBSCRIPTION LOGIC
app.post("/add", async (req, res) => {
  if (!req.session.user) return res.redirect("/login");
  
  const currentUser = req.session.user;
  const userId = currentUser.user_id || currentUser.id;
  const { serviceName, category, planName, price, billingCycle, renewalDate } = req.body;

  try {
    let serviceId;
    
    // 1. Find or Create Service
    const checkService = await db.query("SELECT * FROM services WHERE name = $1", [serviceName]);
    if (checkService.rows.length > 0) {
      serviceId = checkService.rows[0].service_id;
    } else {
      const newService = await db.query(
        "INSERT INTO services (name, category, logo_url) VALUES ($1, $2, 'default.png') RETURNING service_id",
        [serviceName, category]
      );
      serviceId = newService.rows[0].service_id;
    }

    // 2. Add Subscription
    await db.query(`
      INSERT INTO subscriptions 
      (user_id, service_id, renewal_date, custom_price, plan_name, billing_cycle, status)
      VALUES ($1, $2, $3, $4, $5, $6, 'Active')
    `, [userId, serviceId, renewalDate, price, planName, billingCycle]);

    res.redirect("/dashboard");

  } catch (err) {
    console.error("Add Error:", err.message);
    res.status(500).send("Error adding subscription");
  }
});

// DELETE SUBSCRIPTION
app.post("/delete", async (req, res) => {
  const idToDelete = req.body.deleteItemId;
  try {
    await db.query("DELETE FROM subscriptions WHERE subscription_id = $1", [idToDelete]);
    res.redirect("/dashboard");
  } catch (err) {
    console.log(err);
    res.status(500).send("Error deleting item");
  }
});

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
