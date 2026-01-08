import express from "express";
import bodyParser from "body-parser";
import pg from "pg";

const app = express();
const port = 3000;

// 1. Database Configuration
const db = new pg.Client({
  user: "postgres",
  host: "localhost",
  database: "latt_db", 
  password: "your_password", // <--- Remember to put your real password here
  port: 5432,
});

// 2. Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static("public")); 

db.connect();

// Temporary User ID
const currentUserId = 1; 

// ---------------------------------------------------------
// ROUTE 1: The Dashboard (GET)
// ---------------------------------------------------------
app.get("/", async (req, res) => {
  try {
    const result = await db.query(`
      SELECT 
        subscriptions.id AS subscription_id,
        subscriptions.renewal_date,
        subscriptions.amount, 
        services.name AS service_name, 
        services.logo_url
      FROM subscriptions
      JOIN services ON subscriptions.service_id = services.id
      WHERE subscriptions.user_id = $1
      ORDER BY subscriptions.renewal_date ASC
    `, [currentUserId]);

    // Ideally, you will use res.render("index.ejs", { list: result.rows }) later.
    // For now, seeing the raw JSON is good for testing.
    res.json(result.rows); 
    
  } catch (err) {
    console.error(err);
    res.status(500).send("Error fetching dashboard");
  }
});

// ---------------------------------------------------------
// ROUTE 2: Add a Subscription (POST)
// ---------------------------------------------------------
app.post("/add", async (req, res) => {
  // STEP 1: Grab data using the EXACT names from your HTML form
  const serviceName = req.body.serviceName; // Matches <input name="serviceName">
  const type = req.body.subType;            // Matches <select name="subType">
  const currency = req.body.currency;       // Matches <select name="currency">
  const amount = req.body.amount;           // Matches <input name="amount">
  const paymentDate = req.body.paymentDate; // Matches <input name="paymentDate">

  try {
    // STEP 2: Handle the "Service ID" problem.
    // We have a name ("Netflix"), but we need an ID (e.g., 42).
    
    let serviceId;

    // A. Check if this service already exists in your 'services' table
    const checkService = await db.query(
      "SELECT id FROM services WHERE name = $1", 
      [serviceName]
    );

    if (checkService.rows.length > 0) {
      // It exists! Use the existing ID.
      serviceId = checkService.rows[0].id;
    } else {
      // It doesn't exist! Create it now.
      // We set a default logo for now since we don't have one yet.
      const newService = await db.query(
        "INSERT INTO services (name, category, logo_url) VALUES ($1, $2, 'default.png') RETURNING id",
        [serviceName, type]
      );
      serviceId = newService.rows[0].id;
    }

    // STEP 3: Now we have the ID, save the Subscription
    await db.query(`
      INSERT INTO subscriptions (user_id, service_id, renewal_date, amount, currency, status)
      VALUES ($1, $2, $3, $4, $5, 'active')
    `, [currentUserId, serviceId, paymentDate, amount, currency]);

    // Success! Go back to the dashboard to see it.
    res.redirect("/");

  } catch (err) {
    console.error(err);
    res.status(500).send("Error adding subscription");
  }
});

app.listen(port, () => {
  console.log(`Latt server running on port ${port}`);
});