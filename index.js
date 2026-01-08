import express from "express";
import bodyParser from "body-parser";
import bcrypt from "bcrypt";
import pg from "pg";

const app = express();
const port = 3000;

// 1. Database Configuration
const db = new pg.Client({
  user: "postgres",
  host: "localhost",
  database: "latt_db", // <--- CHANGE THIS from "world" to "latt_db"
  password: "your_password", // <--- Make sure this is your real password
  port: 5432,
});

// 2. Middleware (To read form data)
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static("public")); // If you have CSS/Images in a folder named "public"

db.connect();

// Temporary: We pretend User #1 is logged in
const currentUserId = 1; 

// ---------------------------------------------------------
// ROUTE 1: The Dashboard (GET)
// Goal: Show all subscriptions with the service logo and name
// ---------------------------------------------------------
app.get("/", async (req, res) => {
  try {
    // The SQL JOIN: Combines "My Dates" (Subscriptions) with "The Logo" (Services)
    const result = await db.query(`
      SELECT 
        subscriptions.subscription_id,
        subscriptions.renewal_date,
        subscriptions.custom_price, 
        services.name AS service_name, 
        services.logo_url
      FROM subscriptions
      JOIN services ON subscriptions.service_id = services.service_id
      WHERE subscriptions.user_id = $1
      ORDER BY subscriptions.renewal_date ASC
    `, [currentUserId]);

    // Send the data to the browser (or render your EJS/HTML file)
    // For now, let's just see the data to confirm it works:
    res.json(result.rows); 
    
  } catch (err) {
    console.error(err);
    res.status(500).send("Error fetching dashboard");
  }
});

// ---------------------------------------------------------
// ROUTE 2: Add a Subscription (POST)
// Goal: Take data from a form and save it to the DB
// ---------------------------------------------------------
app.post("/add", async (req, res) => {
  // In your HTML form, the inputs must be named: "serviceId", "date", "price"
  const serviceId = req.body.serviceId; 
  const renewalDate = req.body.date;
  const price = req.body.price;

  try {
    await db.query(`
      INSERT INTO subscriptions (user_id, service_id, renewal_date, custom_price, status)
      VALUES ($1, $2, $3, $4, 'active')
    `, [currentUserId, serviceId, renewalDate, price]);

    // Success! Go back to the dashboard
    res.redirect("/");

  } catch (err) {
    console.error(err);
    res.status(500).send("Error adding subscription");
  }
});

app.post("/login", async (req, res) => {
  const email = req.body.email;     // Matches name="email"
  const password = req.body.password; // Matches name="password"

  // TODO: Check database if user exists...
  console.log("Login attempt:", email); 
});

app.listen(port, () => {
  console.log(`Latt server running on port ${port}`);
});