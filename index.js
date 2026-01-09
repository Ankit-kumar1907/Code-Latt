import express from "express";
import bodyParser from "body-parser";
import pg from "pg";
import bcrypt from "bcrypt";
import path from "path";
import { fileURLToPath } from "url";

// 1. Setup for EJS views folder
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = 3000;
const saltRounds = 10;

// 2. Database Configuration
const db = new pg.Client({
  user: "postgres",
  host: "localhost",
  database: "latt_db",
  password: "1234", // <--- Make sure this matches your working password
  port: 5432,
});

// 3. Middleware & View Engine
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views")); // Looks for files in 'views' folder
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static("public")); // Looks for images/css in 'public' folder

db.connect();

// Temporary User ID
const currentUserId = 1;

// ---------------------------------------------------------
// ROUTE 1: The Dashboard (GET)
// Renders the visual UI instead of raw JSON
// ---------------------------------------------------------
app.get("/", async (req, res) => {
  try {
    const result = await db.query(`
      SELECT 
        subscriptions.custom_price,
        services.name AS service_name, 
        services.logo_url
      FROM subscriptions
      JOIN services ON subscriptions.service_id = services.service_id
      WHERE subscriptions.user_id = $1
      ORDER BY subscriptions.renewal_date ASC
    `, [currentUserId]);

    const subs = result.rows;

    // Calculate Total Spending
    let totalSpending = 0;
    subs.forEach(sub => {
        totalSpending += parseFloat(sub.custom_price);
    });

    // Render the EJS file
    res.render("dashboard.ejs", { 
        userName: "Ankit", 
        subscriptions: subs,
        total: totalSpending.toFixed(0)
    });

  } catch (err) {
    console.error("Dashboard Error:", err);
    res.status(500).send("Error fetching dashboard");
  }
});

// ---------------------------------------------------------
// ROUTE 2: Add a Subscription (POST)
// ---------------------------------------------------------
app.post("/add", async (req, res) => {
  const serviceName = req.body.serviceName;
  const category = req.body.category;
  const planName = req.body.planName;
  const price = req.body.price;
  const cycle = req.body.billingCycle;
  const date = req.body.renewalDate;

  try {
    let serviceId;
    const checkService = await db.query("SELECT service_id FROM services WHERE name = $1", [serviceName]);

    if (checkService.rows.length > 0) {
      serviceId = checkService.rows[0].service_id;
    } else {
      const newService = await db.query(
        "INSERT INTO services (name, category, logo_url) VALUES ($1, $2, 'default.png') RETURNING service_id",
        [serviceName, category]
      );
      serviceId = newService.rows[0].service_id;
    }

    await db.query(`
      INSERT INTO subscriptions 
      (user_id, service_id, renewal_date, custom_price, plan_name, billing_cycle, status)
      VALUES ($1, $2, $3, $4, $5, $6, 'Active')
    `, [currentUserId, serviceId, date, price, planName, cycle]);

    res.redirect("/");

  } catch (err) {
    console.error("Add Error:", err);
    res.status(500).send("Error adding subscription");
  }
});

// ---------------------------------------------------------
// ROUTE 3: Register User (Sign Up)
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
      // Go to Permission Page after signup
      res.redirect("/permission.html");
    }
  } catch (err) {
    console.error(err);
    res.status(500).send("Error registering user");
  }
});

// ---------------------------------------------------------
// ROUTE 4: Login User (Sign In)
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
        res.redirect("/"); // Go to Dashboard
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

app.listen(port, () => {
  console.log(`Latt server running on port ${port}`);
});