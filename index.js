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
const port = 3000;
const saltRounds = 10;

// 3. Database Configuration
const db = new pg.Client({
  user: "postgres",
  host: "localhost",
  database: "latt_db",
  password: process.env.DB_PASSWORD, // Securely loads from .env file
  port: 5432,
});

// 4. Middleware & View Engine
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static("assets-Code")); // Serves images

// 5. Session Setup
app.use(session({
  secret: process.env.SESSION_SECRET, // Securely loads from .env file
  resave: false,
  saveUninitialized: true,
  cookie: { maxAge: 1000 * 60 * 60 * 24 } // 1 day
}));

db.connect();

// ---------------------------------------------------------
// ROUTE 1: The Welcome Page (Root)
// ---------------------------------------------------------
app.get("/", (req, res) => {
    res.render("welcome");
});

// ---------------------------------------------------------
// ROUTE 2: The Dashboard (Protected)
// ---------------------------------------------------------
app.get("/dashboard", async (req, res) => {
  // SECURITY: Check if user is logged in
  if (!req.session.user) {
    return res.redirect("/login");
  }

  const currentUser = req.session.user;

  try {
    const result = await db.query(`
      SELECT 
        subscriptions.subscription_id, 
        subscriptions.custom_price,
        services.name AS service_name, 
        services.logo_url
      FROM subscriptions
      JOIN services ON subscriptions.service_id = services.service_id
      WHERE subscriptions.user_id = $1
      ORDER BY subscriptions.renewal_date ASC
    `, [currentUser.id || currentUser.user_id]); // Checks both ID formats

    const subs = result.rows;

    // Calculate Total Spending
    let totalSpending = 0;
    subs.forEach(sub => {
        totalSpending += parseFloat(sub.custom_price);
    });

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

// ---------------------------------------------------------
// ROUTE 3: Auth Pages (Login & Register)
// ---------------------------------------------------------
app.get("/login", (req, res) => {
    res.render("login");
});

app.get("/register", (req, res) => {
    res.render("register");
});

// ---------------------------------------------------------
// ROUTE 4: Discovery & Manual Entry
// ---------------------------------------------------------
app.get("/discover", (req, res) => {
    res.render("discover"); 
});

app.get("/manual-entry", (req, res) => {
    // If not logged in, send them to login
    if (!req.session.user) return res.redirect("/login");

    res.render("manual-entry", { 
        name: req.query.name, 
        price: req.query.price 
    });
});

// ---------------------------------------------------------
// ROUTE 5: POST - Add a Subscription
// ---------------------------------------------------------
app.post("/add", async (req, res) => {
  if (!req.session.user) return res.redirect("/login");
  
  const currentUser = req.session.user;
  // Handle both 'id' and 'user_id' column names
  const currentUserId = currentUser.id || currentUser.user_id;

  const { serviceName, category, planName, price, billingCycle, renewalDate } = req.body;

  try {
    let serviceId;
    
    // 1. Check if Service Exists
    const checkService = await db.query("SELECT * FROM services WHERE name = $1", [serviceName]);

    if (checkService.rows.length > 0) {
      // Handle 'id' OR 'service_id'
      serviceId = checkService.rows[0].id || checkService.rows[0].service_id;
    } else {
      // 2. Create New Service
      const newService = await db.query(
        "INSERT INTO services (name, category, logo_url) VALUES ($1, $2, 'default.png') RETURNING *",
        [serviceName, category]
      );
      serviceId = newService.rows[0].id || newService.rows[0].service_id;
    }

    // 3. Insert Subscription
    await db.query(`
      INSERT INTO subscriptions 
      (user_id, service_id, renewal_date, custom_price, plan_name, billing_cycle, status)
      VALUES ($1, $2, $3, $4, $5, $6, 'Active')
    `, [currentUserId, serviceId, renewalDate, price, planName, billingCycle]);

    res.redirect("/dashboard");

  } catch (err) {
    console.error("Add Error:", err.message);
    res.status(500).send("Error adding subscription");
  }
});

// ---------------------------------------------------------
// ROUTE 6: POST - Register User
// ---------------------------------------------------------
app.post("/register", async (req, res) => {
  const email = req.body.email;
  const password = req.body.password;
  const fullName = req.body.fullName; 

  try {
    const checkResult = await db.query("SELECT * FROM users WHERE email = $1", [email]);

    if (checkResult.rows.length > 0) {
      res.send("Email already exists. Try logging in.");
    } else {
      const hash = await bcrypt.hash(password, saltRounds);
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

// ---------------------------------------------------------
// ROUTE 7: POST - Login User
// ---------------------------------------------------------
app.post("/login", async (req, res) => {
  const email = req.body.email;
  const loginPassword = req.body.password;

  try {
    const result = await db.query("SELECT * FROM users WHERE email = $1", [email]);

    if (result.rows.length > 0) {
      const user = result.rows[0];
      const valid = await bcrypt.compare(loginPassword, user.password_hash);

      if (valid) {
        // --- SESSION SAVE ---
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

// ---------------------------------------------------------
// ROUTE 8: Logout
// ---------------------------------------------------------
app.get("/logout", (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return console.log(err);
    }
    res.redirect("/"); // Go back to Welcome page
  });
});

// ---------------------------------------------------------
// ROUTE 9: Delete Subscription (POST)
// ---------------------------------------------------------
app.post("/delete", async (req, res) => {
  const idToDelete = req.body.deleteItemId;
  
  try {
    await db.query("DELETE FROM subscriptions WHERE subscription_id = $1", [idToDelete]);
    res.redirect("/dashboard"); // Refresh the page
  } catch (err) {
    console.log(err);
    res.status(500).send("Error deleting item");
  }
});

app.listen(port, () => {
  console.log(`Latt server running on port ${port}`);
});